import json
import logging
import mimetypes
import os
import sys
from contextlib import asynccontextmanager
from tempfile import NamedTemporaryFile
import urllib.request
from typing import List, Annotated

import aiofiles
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, Form
from langfuse.llama_index import LlamaIndexCallbackHandler
from llama_index.core import Document, Settings
from llama_index.core.callbacks import CallbackManager
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request

from pipelines.base.db import pool
from pipelines.ingestion_pipeline import TextIngestionPipeline
from services.agent_service import AgentService

load_dotenv()

mimetypes.add_type('audio/x-m4a', '.m4a')


logger = logging.getLogger(__name__)

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
    id: str
    content: str
    companyId: int
    meta: dict


class DocumentRequest(BaseModel):
    id: str
    content: str
    meta: dict


class AddDocumentsRequest(BaseModel):
    companyId: int
    documents: List[DocumentRequest]


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
        Document(doc_id=request.id, text=request.content, metadata={**request.meta, 'companyId': request.companyId})
    ])

    return {'status': 'ok'}


@app.post("/api/agent/documents")
async def add_documents(request: AddDocumentsRequest):
    documents = []

    for doc in request.documents:
        documents.append(Document(doc_id=doc.id, text=doc.content, metadata={**doc.meta, 'companyId': request.companyId}))

    await TextIngestionPipeline.arun(documents=documents)

    return {'status': 'ok'}


@app.post("/api/agent/files")
async def add_file(id: Annotated[str, Form()], file: UploadFile, companyId: Annotated[str, Form()], meta: Annotated[str, Form()]):
    extension = mimetypes.guess_extension(file.content_type)

    if not extension:
        logger.warning(f'Extension {extension} is not supported')
        return

    file_path = ''
    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        file_path = temp_file.name
        async with aiofiles.open(file_path, 'wb') as f:
            while content := await file.read(1000000):
                await f.write(content)
            await f.flush()

    meta = json.loads(meta)

    try:
        await agentService.process_file(id, file_path, companyId, meta)
    except Exception as e:
        raise e
    finally:
        os.remove(file_path)

    return {'status': 'ok'}


@app.post("/api/agent/files/link")
async def add_file_via_link(file: AddFileLinkRequest):
    [mtype, _] = mimetypes.guess_type(file.link)

    extension = mimetypes.guess_extension(mtype)

    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        urllib.request.urlretrieve(file.link, temp_file.name)
        file_path = temp_file.name

    # await agentService.process_file()

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
