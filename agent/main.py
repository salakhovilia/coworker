import mimetypes
import os
from tempfile import NamedTemporaryFile
import urllib.request
from typing import List

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, HTTPException
from haystack import Document
from haystack.document_stores.types import DuplicatePolicy
from haystack.tracing import tracer
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from pipelines.file_pipeline import FilePipeline, MIMETYPES
from pipelines.store import DocumentStore
from pipelines.text_embeder import TextEmbedder
from services.agent_service import AgentService

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

@app.post("/api/agent/text")
async def add_message(request: AddMessageRequest):
    embedding = TextEmbedder.run(request.content)

    DocumentStore.write_documents([
        Document(
            content=request.content,
            embedding=embedding['embedding'],
            meta={**request.meta, 'companyId': request.companyId}
        )
    ], policy=DuplicatePolicy.OVERWRITE)

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

    if mtype not in MIMETYPES:
        raise HTTPException(status_code=400, detail="Invalid mimetype")

    extension = mimetypes.guess_extension(mtype)

    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        urllib.request.urlretrieve(file.link, temp_file.name)
        file_path = temp_file.name

    meta = {
        **file.meta,
        'companyId': file.companyId
    }

    FilePipeline.run({
        "file_type_router": {"sources": [file_path]},
        "pypdf_converter": {"meta": meta},
        "text_file_converter": {"meta": meta},
        "markdown_converter": {"meta": meta},
    })

    os.remove(file_path)

    return {'status': 'ok'}


@app.post("/api/agent/query")
async def query(query: QueryRequest):
    result = await agentService.query(query.question, query.companyId, query.meta)

    if not result:
        return {"response": None}

    return {"response": result['message']}


@app.post("/api/agent/suggest")
async def suggest(request: SuggestRequest):
    result = await agentService.suggest(request.message, request.companyId, request.meta)

    return {"response": result}

@app.post("/api/agent/calendars/event")
async def generate_event(request: GenerateCalendarEventRequest):
    result = await agentService.generate_event(request.calendars, request.events, request.command, request.companyId, request.meta)

    return {"response": result}


@app.on_event("shutdown")
async def shutdown_event():
    tracer.actual_tracer.flush()