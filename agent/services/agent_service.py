import datetime
import logging
from enum import Enum
from typing import Optional, List, Any

from llama_index.core import ChatPromptTemplate, SimpleDirectoryReader, PromptTemplate, Document
from llama_index.core.llms import ChatMessage, MessageRole
from llama_index.core.postprocessor import SimilarityPostprocessor
from llama_index.core.query_pipeline import InputComponent, QueryPipeline, ArgPackComponent
from llama_index.core.response_synthesizers import TreeSummarize, Generation
from llama_index.core.vector_stores import MetadataFilters, MetadataFilter
# from llama_index.readers.github import GithubClient, GithubRepositoryReader
from llama_index.llms.openai import OpenAI
from llama_index.core.types import BaseModel
# from llama_index.readers.github import GithubRepositoryReader, GithubClient
from pydantic.v1 import Field

from pipelines.base.chat_history_response import ResponseWithChatHistory
from pipelines.base.db import index, pool
from pipelines.base.video_audio_reader import AudioReader
from pipelines.ingestion_pipeline import TextIngestionPipeline, build_code_ingestion_pipeline
from prompts.calendar_prompts import SYSTEM_PROMPT_CALENDAR, USER_PROMPT_CALENDAR
from prompts.git_prompt import SYSTEM_GIT_DIFF_SUMMARY
from prompts.main_prompt import SYSTEM_SUGGESTION_PROMPT, USER_SUGGESTION_PROMPT, SYSTEM_PROMPT, USER_QUERY_PROMPT, \
    USER_REWRITE_QUERY_PROMPT, SYSTEM_REWRITE_QUERY_PROMPT
from utils.ext_to_lang import EXTENSION_TO_LANGUAGE

FILE_EXTRACTOR = {
    ".flac": AudioReader(),
    ".mp3": AudioReader(),
    ".mp4": AudioReader(),
    ".mpeg": AudioReader(),
    ".mpga": AudioReader(),
    ".m4a": AudioReader(),
    ".ogg": AudioReader(),
    ".oga": AudioReader(),
    ".wav": AudioReader(),
    ".webm": AudioReader()
}


class Query(BaseModel):
    """Data model for an answer."""

    score: int = Field(description='the score from 1 to 10 CoWorker was mentioned')
    relevance: int = Field(description='the score from 1 to 10 the correctness, useful and relevance of the answer')
    message: str


class CalendarEventActionEnum(str, Enum):
    insert = 'insert',
    update = 'update',
    delete = 'delete'


class CalendarEventDate(BaseModel):
    """Data model for a calendar event date"""
    date: Optional[str]
    dateTime: Optional[datetime.datetime]
    timeZone: Optional[str]


class CalendarEventRequestBody(BaseModel):
    """Data model for a calendar event request body."""
    summary: str
    description: str
    start: CalendarEventDate
    end: CalendarEventDate


class CalendarEvent(BaseModel):
    """Data model for a calendar event."""
    calendarId: str
    eventId: Optional[str]
    requestBody: Optional[CalendarEventRequestBody]


class CalendarEventRoot(BaseModel):
    """Data model for a calendar action."""

    action: CalendarEventActionEnum
    event: CalendarEvent
    telegramUsernames: List[str]
    message: str


logger = logging.getLogger(__name__)


class AgentService:

    async def process_file(self, id, file_path, companyId: str, meta: dict):
        extension = '.' + file_path.split('.')[-1]

        supported_files = SimpleDirectoryReader.supported_suffix_fn()
        if extension not in supported_files and extension not in FILE_EXTRACTOR:
            logger.warning(f'Extension {extension} is not supported')
            return

        reader = SimpleDirectoryReader(
            input_files=[file_path],
            file_extractor=FILE_EXTRACTOR
        )

        [doc] = await reader.aload_data(show_progress=True)

        doc.doc_id = id
        doc.metadata = {
            **meta,
            'companyId': companyId,
            **doc.metadata
        }

        extension = file_path.split('.')[-1]

        if extension in EXTENSION_TO_LANGUAGE:
            try:
                pipeline = build_code_ingestion_pipeline(EXTENSION_TO_LANGUAGE[extension][0])
                await pipeline.arun(documents=[doc])
            except Exception as e:
                logging.warning(e)
                await TextIngestionPipeline.arun(documents=[doc])
        else:
            await TextIngestionPipeline.arun(documents=[doc])

    async def query(self, question: str, companyId: int, meta: dict):
        llm = OpenAI(model="gpt-4o", temperature=0.5)

        filters = MetadataFilters(
            filters=[
                MetadataFilter(key="companyId", value=companyId, operator="=="),
                MetadataFilter(key="role", value='assistant', operator="!="),
            ],
        )

        retriever = index.as_retriever(filters=filters, llm=llm, similarity_top_k=5)
        messages = await self.get_last_messages(companyId, meta.get('chatId'), 25)

        p = QueryPipeline(verbose=False)
        p.add_modules(
            {
                "input": InputComponent(),
                "retriever": retriever,
                "post_processor": SimilarityPostprocessor(similarity_cutoff=0.75),
                "response": ResponseWithChatHistory(llm=llm, system_prompt=SYSTEM_PROMPT, context_prompt=USER_QUERY_PROMPT)
            }
        )
        p.add_link("input", "retriever", src_key='query_str')
        p.add_link("retriever", "post_processor", dest_key="nodes")
        p.add_link("post_processor", "response", dest_key="nodes")
        p.add_link("input", "response", src_key='query_str', dest_key="query_str")
        p.add_link("input", "response", src_key='chat_history', dest_key="chat_history")

        response = await p.arun(
            query_str=await self.format_query(question, meta),
            chat_history=await self.convert_messages(messages)
        )

        return response

    async def suggest(self, message: str, companyId: int, meta: dict):
        llm = OpenAI(model="gpt-4o-mini", temperature=0.5)

        filters = MetadataFilters(
            filters=[
                MetadataFilter(key="companyId", value=companyId, operator="=="),
                MetadataFilter(key="role", value='assistant', operator="!="),
            ],
        )

        retriever = index.as_retriever(filters=filters, llm=llm, similarity_top_k=8)

        message_templates = [
            ChatMessage(content=SYSTEM_SUGGESTION_PROMPT, role=MessageRole.SYSTEM),
            ChatMessage(content=USER_SUGGESTION_PROMPT, role=MessageRole.USER)
        ]

        prompt_tmpl = ChatPromptTemplate(message_templates=message_templates)

        messages = await self.get_last_messages(companyId, meta.get('chatId'))
        prompt_tmpl = prompt_tmpl.partial_format(messages_str=await self.format_messages(messages))

        summarizer = Generation(llm=llm, simple_template=prompt_tmpl, output_cls=Query)
        p = QueryPipeline(verbose=False)
        p.add_modules(
            {
                "input": InputComponent(),
                "retriever": retriever,
                "summarizer": summarizer,
            }
        )
        p.add_link("input", "retriever")
        p.add_link("input", "summarizer", dest_key="query_str")
        p.add_link("retriever", "summarizer", dest_key="nodes")

        response = await p.arun(input=await self.format_query(message, meta))

        if response.score < 9 or response.relevance < 7:
            return None

        return response.message

    async def generate_event(self, calendars, events, command: str, companyId: int, meta: dict):
        llm = OpenAI(model="gpt-4o", temperature=0.5)

        filters = MetadataFilters(
            filters=[
                MetadataFilter(key="companyId", value=companyId, operator="=="),
            ],
        )

        retriever = index.as_retriever(filters=filters, llm=llm, similarity_top_k=8)

        message_templates = [
            ChatMessage(content=SYSTEM_PROMPT_CALENDAR, role=MessageRole.SYSTEM),
            ChatMessage(content=USER_PROMPT_CALENDAR, role=MessageRole.USER)
        ]

        prompt_tmpl = ChatPromptTemplate(message_templates=message_templates)

        messages = await self.get_last_messages(companyId, meta['chatId'])

        prompt_tmpl = prompt_tmpl.partial_format(messages_str=await self.format_messages(messages),
                                                 calendars_str=await self.format_calendars(calendars),
                                                 events_str=await self.format_events(events),
                                                 now=datetime.datetime.now().isoformat())

        summarizer = TreeSummarize(llm=llm, summary_template=prompt_tmpl, output_cls=CalendarEventRoot)
        p = QueryPipeline(verbose=False)
        p.add_modules(
            {
                "input": InputComponent(),
                "retriever": retriever,
                "summarizer": summarizer,
            }
        )
        p.add_link("input", "retriever")
        p.add_link("input", "summarizer", dest_key="query_str")
        p.add_link("retriever", "summarizer", dest_key="nodes")

        response = await p.arun(input=await self.format_query(command, meta))
        return response.response

    async def summaryGitDiff(self, diff: str, companyId):
        llm = OpenAI(model="gpt-4o-mini", temperature=0.5, system_prompt=SYSTEM_GIT_DIFF_SUMMARY)

        response = await llm.acomplete(diff)

        return response.text

    # async def download_repo(self):
    #     github_client = GithubClient(github_token='52575622')
    #     reader = GithubRepositoryReader(
    #         github_client=github_client,
    #         owner='salakhovilia',
    #         repo='coworker',
    #         use_parser=False,
    #         verbose=False,
    #     )
    #
    #     docs = await reader.aload_data(branch='master')
    #     print(docs)

    async def get_last_messages(self, companyId:int, chatId: str, limit=5):
        async with pool.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT text, metadata_ FROM data_documents "
                                     "WHERE metadata_->>'companyId'=%s"
                                     " and metadata_->>'chatId'=%s "
                                     "ORDER BY metadata_->>'date' DESC "
                                     "LIMIT %s", [str(companyId), str(chatId), str(limit)])
                results = await cursor.fetchall()
                return results

    async def convert_messages(self, messages):
        chat_history: List[ChatMessage] = []

        for message in messages:
            content = ''
            for key in message[1]:
                if key.startswith("_"):
                    continue

                content += f"{key}: {message[1][key]}\n"
            content += f"\n{message[0]}"

            chat_history.append(ChatMessage(
                content=content,
                role=MessageRole.ASSISTANT if message[1].get('role') == 'assistant' else MessageRole.USER)
            )

        return chat_history

    async def format_messages(self, messages):
        messages_str = "Context:\n\n"

        for message in messages:
            for key in message[1]:
                if key.startswith("_"):
                    continue

                messages_str += f"{key}: {message[1][key]}\n"
            messages_str += f"\n{message[0]}\n\n"

        return messages_str

    async def format_calendars(self, calendars):
        calendars_str = ""

        for calendar in calendars:
            for key in calendar.model_fields_set:
                calendars_str += f"{key}: {getattr(calendar, key)}\n"
            calendars_str += "\n"

        return calendars_str

    async def format_events(self, events):
        events_str = ""

        for event in events:
            for key in event.model_fields_set:
                events_str += f"{key}: {getattr(event, key)}\n"
            events_str += "\n"

        return events_str

    async def format_query(self, query: str, meta: dict[str, Any]):
        query_str = ""

        for key in meta:
            if key.startswith("_"):
                continue

            query_str += f"{key}: {meta[key]}\n"
        query_str += f"\n{query}\n\n"

        return query_str
