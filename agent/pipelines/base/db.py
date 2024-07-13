import os

import psycopg
from llama_index.core import VectorStoreIndex
from llama_index.vector_stores.postgres import PGVectorStore
from psycopg_pool import AsyncConnectionPool
from sqlalchemy import make_url

from pipelines.base.embedding import embed_model

url = make_url(os.environ.get('DOCUMENT_DATABASE_URL'))

pool = AsyncConnectionPool(os.environ.get('DOCUMENT_DATABASE_URL'), open=False)


vector_store = PGVectorStore.from_params(
    database=url.database,
    host=url.host,
    password=url.password,
    port=url.port,
    user=url.username,
    table_name="documents",
    embed_dim=1536,
)

index = VectorStoreIndex.from_vector_store(vector_store, embed_model=embed_model)

query_engine = index.as_query_engine()
