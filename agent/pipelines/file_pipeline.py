from haystack import Pipeline
from haystack.components.converters import TextFileToDocument, MarkdownToDocument, PyPDFToDocument
from haystack.components.joiners import DocumentJoiner
from haystack.components.preprocessors import DocumentCleaner, DocumentSplitter
from haystack.components.routers import FileTypeRouter
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DuplicatePolicy

from pipelines.store import DocumentStore
from pipelines.text_embeder import DocumentEmbedder

MIMETYPES = ["text/plain", "application/pdf", "text/markdown"]

file_type_router = FileTypeRouter(mime_types=MIMETYPES)
text_file_converter = TextFileToDocument()
markdown_converter = MarkdownToDocument()
pdf_converter = PyPDFToDocument()
document_joiner = DocumentJoiner()
document_cleaner = DocumentCleaner()
document_splitter = DocumentSplitter(split_by="sentence", split_length=150, split_overlap=50)
document_writer = DocumentWriter(DocumentStore, policy=DuplicatePolicy.SKIP)

FilePipeline = Pipeline()
FilePipeline.add_component(instance=file_type_router, name="file_type_router")
FilePipeline.add_component(instance=text_file_converter, name="text_file_converter")
FilePipeline.add_component(instance=markdown_converter, name="markdown_converter")
FilePipeline.add_component(instance=pdf_converter, name="pypdf_converter")
FilePipeline.add_component(instance=document_joiner, name="document_joiner")
FilePipeline.add_component(instance=document_cleaner, name="document_cleaner")
FilePipeline.add_component(instance=document_splitter, name="document_splitter")
FilePipeline.add_component(instance=DocumentEmbedder, name="document_embedder")
FilePipeline.add_component(instance=document_writer, name="document_writer")

FilePipeline.connect("file_type_router.text/plain", "text_file_converter.sources")
FilePipeline.connect("file_type_router.application/pdf", "pypdf_converter.sources")
FilePipeline.connect("file_type_router.text/markdown", "markdown_converter.sources")
FilePipeline.connect("text_file_converter", "document_joiner")
FilePipeline.connect("pypdf_converter", "document_joiner")
FilePipeline.connect("markdown_converter", "document_joiner")
FilePipeline.connect("document_joiner", "document_cleaner")
FilePipeline.connect("document_cleaner", "document_splitter")
FilePipeline.connect("document_splitter", "document_embedder")
FilePipeline.connect("document_embedder", "document_writer")

