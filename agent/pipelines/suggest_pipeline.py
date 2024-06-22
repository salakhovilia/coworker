from dotenv import load_dotenv
from haystack import Pipeline
from haystack.components.embedders import OpenAITextEmbedder
from haystack.utils import Secret
from haystack_integrations.components.connectors.langfuse import LangfuseConnector
from haystack_integrations.components.retrievers.pgvector import PgvectorEmbeddingRetriever

from pipelines.store import DocumentStore

load_dotenv()

SuggestPipeline = Pipeline()
SuggestPipeline.add_component("tracer", LangfuseConnector("Suggest pipeline"))
SuggestPipeline.add_component("embedder", OpenAITextEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY")))
SuggestPipeline.add_component("retriever", PgvectorEmbeddingRetriever(document_store=DocumentStore, top_k=1))

SuggestPipeline.connect("embedder.embedding", "retriever.query_embedding")
