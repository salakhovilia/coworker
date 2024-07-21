import logging
import mimetypes
import os
import sys
from contextlib import asynccontextmanager
from tempfile import NamedTemporaryFile
import urllib.request
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile
from langfuse.llama_index import LlamaIndexCallbackHandler
from llama_index.core import Document, Settings, SimpleDirectoryReader
from llama_index.core.callbacks import CallbackManager
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from pipelines.base.db import pool
from pipelines.ingestion_pipeline import TextIngestionPipeline, build_code_ingestion_pipeline
from services.agent_service import AgentService
from utils.ext_to_lang import EXTENSION_TO_LANGUAGE

load_dotenv()



@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open()
    yield
    await pool.close()
    langfuse_callback_handler.flush()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

langfuse_callback_handler = LlamaIndexCallbackHandler(
    public_key=os.environ.get('LANGFUSE_PUBLIC_KEY'),
    secret_key=os.environ.get('LANGFUSE_SECRET_KEY'),
    host=os.environ.get('LANGFUSE_HOST')
)
Settings.callback_manager = CallbackManager([langfuse_callback_handler])

logging.basicConfig(stream=sys.stdout, level=logging.INFO)
logging.getLogger().addHandler(logging.StreamHandler(stream=sys.stdout))


class AddMessageRequest(BaseModel):
    content: str
    companyId: int
    meta: dict


class AddFileLinkRequest(BaseModel):
    companyId: int
    link: str
    meta: dict


class QueryRequest(BaseModel):
    question: str
    companyId: int
    meta: dict


class SuggestRequest(BaseModel):
    message: str
    companyId: int
    meta: dict


class SummaryGitDiffRequest(BaseModel):
    diff: str
    companyId: int


class CalendarRequest(BaseModel):
    id: str
    name: str
    timeZone: str


class CalendarEventRequest(BaseModel):
    id: str
    summary: str
    description: str


class GenerateCalendarEventRequest(BaseModel):
    companyId: int
    calendars: List[CalendarRequest]
    events: List[CalendarEventRequest]
    command: str
    meta: dict


agentService = AgentService()


@app.post('/api/agent/github/repo')
async def download_repo():
    await agentService.download_repo()

@app.post("/api/agent/text")
async def add_message(request: AddMessageRequest):
    await TextIngestionPipeline.arun(documents=[
        Document(text=request.content, metadata={**request.meta, 'companyId': request.companyId})
    ])

    return {'status': 'ok'}


@app.post("/api/agent/files")
async def add_file(file: UploadFile):
    # if file.mimetype not in MIMETYPES:
    #     raise HTTPException(status_code=400, detail="Invalid mimetype")
    #
    # extension = mimetypes.guess_extension(file.mimetype)
    #
    # with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
    #     file.save(temp_file.name)
    #     file_path = temp_file.name

    meta = {}
    # for arg in request.args:
    #     meta[arg] = int(request.args[arg]) if request.args[arg].isdecimal() else request.args[arg]
    #
    # FilePipeline.run({
    #     "file_type_router": {"sources": [file_path]},
    #     "pypdf_converter": {"meta": meta},
    #     "text_file_converter": {"meta": meta},
    #     "markdown_converter": {"meta": meta},
    # })
    #
    # os.remove(file_path)


@app.post("/api/agent/files/link")
async def add_file_via_link(file: AddFileLinkRequest):
    [mtype, _] = mimetypes.guess_type(file.link)

    extension = mimetypes.guess_extension(mtype)

    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        urllib.request.urlretrieve(file.link, temp_file.name)
        file_path = temp_file.name

    meta = {
        **file.meta,
        'companyId': file.companyId
    }

    reader = SimpleDirectoryReader(
        input_files=[file_path],
    )

    docs = await reader.aload_data()

    for doc in docs:
        doc.metadata = {
            **meta,
            **doc.metadata
        }

    validated_extension = extension.lstrip('.')

    if validated_extension in EXTENSION_TO_LANGUAGE:
        try:
            pipeline = build_code_ingestion_pipeline(EXTENSION_TO_LANGUAGE[validated_extension][0])
            await pipeline.arun(documents=docs)
        except Exception as e:
            logging.warning(e)
            await TextIngestionPipeline.arun(documents=docs)
    else:
        await TextIngestionPipeline.arun(documents=docs)

    os.remove(file_path)

    return {'status': 'ok'}


@app.post("/api/agent/query")
async def query(request: Request, query: QueryRequest):
    result = await agentService.query(query.question, query.companyId, query.meta)

    return {"response": result}


@app.post("/api/agent/suggest")
async def suggest(request: SuggestRequest):
    result = await agentService.suggest(request.message, request.companyId, request.meta)

    return {"response": result}


@app.post("/api/agent/git/diff/summary")
async def summary_git_diff(request: SummaryGitDiffRequest):
    result = await agentService.summaryGitDiff(request.diff, request.companyId)

    return {"response": result}


@app.post("/api/agent/calendars/event")
async def generate_event(request: GenerateCalendarEventRequest):
    result = await agentService.generate_event(request.calendars, request.events, request.command, request.companyId,
                                               request.meta)

    return {"response": result}
