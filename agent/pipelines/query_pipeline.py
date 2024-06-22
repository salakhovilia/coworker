from dotenv import load_dotenv
from haystack import Pipeline
from haystack.components.builders import PromptBuilder
from haystack.components.embedders import OpenAITextEmbedder
from haystack.components.generators import OpenAIGenerator
from haystack_integrations.components.retrievers.pgvector import PgvectorEmbeddingRetriever

from .store import DocumentStore
from haystack.utils import Secret
from haystack_integrations.components.connectors.langfuse import LangfuseConnector

load_dotenv()


f = open("./prompts/query-template.txt", "r")
queryTemplate = f.read()


QueryPipeline = Pipeline()
QueryPipeline.add_component("tracer", LangfuseConnector("Query pipeline"))
QueryPipeline.add_component("embedder", OpenAITextEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY")))
QueryPipeline.add_component("retriever", PgvectorEmbeddingRetriever(document_store=DocumentStore, top_k=20))
QueryPipeline.add_component("prompt_builder", PromptBuilder(template=queryTemplate))
QueryPipeline.add_component(
    "llm",
    OpenAIGenerator(model='gpt-4o', api_key=Secret.from_env_var("OPEN_API_KEY")),
)

QueryPipeline.connect("embedder.embedding", "retriever.query_embedding")
QueryPipeline.connect("retriever", "prompt_builder.documents")
QueryPipeline.connect("prompt_builder", "llm")
