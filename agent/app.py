import mimetypes
import os
from tempfile import NamedTemporaryFile
import urllib.request

from dotenv import load_dotenv
from flask import Flask, request, Response
from flask_cors import CORS
from haystack import Document
from haystack.document_stores.types import DuplicatePolicy

from pipelines.file_pipeline import FilePipeline, MIMETYPES
from pipelines.query_pipeline import QueryPipeline
from pipelines.store import DocumentStore
from pipelines.text_embeder import TextEmbedder

if os.environ.get('ENV') != 'production':
    load_dotenv()

app = Flask(__name__)
cors = CORS(app)

app.config['MAX_CONTENT_LENGTH'] = 100000000


@app.post("/api/agent/text")
def add_message():
    embedding = TextEmbedder.run(request.json['content'])

    DocumentStore.write_documents([
        Document(
            content=request.json['content'],
            embedding=embedding['embedding'],
            meta=request.json['meta']
        )
    ], policy=DuplicatePolicy.SKIP)
    return Response(status=201)


@app.post("/api/agent/files")
def add_file():
    file = request.files.get('file')

    if not file:
        return Response(
            "file is required",
            status=400,
        )

    if file.mimetype not in MIMETYPES:
        return Response(
            "Invalid mimetype",
            status=400,
        )

    extension = mimetypes.guess_extension(file.mimetype)

    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        file.save(temp_file.name)
        file_path = temp_file.name

    meta = {}
    for arg in request.args:
        meta[arg] = int(request.args[arg]) if request.args[arg].isdecimal() else request.args[arg]

    FilePipeline.run({
        "file_type_router": {"sources": [file_path]},
        "pypdf_converter": {"meta": meta},
        "text_file_converter": {"meta": meta},
        "markdown_converter": {"meta": meta},
    })

    os.remove(file_path)

    return Response(status=201)


@app.post("/api/agent/files/link")
def add_file_via_link():
    companyId = request.json['companyId']
    link = request.json['link']

    [mtype, _] = mimetypes.guess_type(link)

    if mtype not in MIMETYPES:
        return Response(
            "Invalid mimetype",
            status=400,
        )

    extension = mimetypes.guess_extension(mtype)

    with NamedTemporaryFile(delete=False, dir='uploads', suffix=extension) as temp_file:
        urllib.request.urlretrieve(link, temp_file.name)
        file_path = temp_file.name

    meta = {
        'companyId': companyId
    }

    FilePipeline.run({
        "file_type_router": {"sources": [file_path]},
        "pypdf_converter": {"meta": meta},
        "text_file_converter": {"meta": meta},
        "markdown_converter": {"meta": meta},
    })

    os.remove(file_path)

    return Response(status=201)


@app.post("/api/agent/query")
def query():
    question = request.json['question']
    companyId = request.json['companyId']

    result = QueryPipeline.run({
        "embedder": {"text": question},
        "retriever": {
            "filters": {
                "operator": "AND",
                "conditions": [
                    {"field": "meta.companyId", "operator": "==", "value": companyId},
                ],
            }
        },
        "prompt_builder": {"question": question},
    })

    print(result)

    if len(result['llm']['replies']) == 0:
        return {"response": None}

    return {"response": result['llm']['replies'][0]}