import os

from haystack.utils import Secret
from haystack_integrations.components.retrievers.pgvector import PgvectorEmbeddingRetriever
from haystack_integrations.document_stores.pgvector import PgvectorDocumentStore

DocumentStore = PgvectorDocumentStore(
    connection_string=Secret.from_env_var('PG_CONN_STR'),
    vector_function="cosine_similarity",
    search_strategy="hnsw",
    embedding_dimension=1536,
    hnsw_recreate_index_if_exists=True
)

Retriever = PgvectorEmbeddingRetriever(document_store=DocumentStore)