from llama_index.core.ingestion import IngestionPipeline, DocstoreStrategy
from llama_index.core.node_parser import SemanticSplitterNodeParser

from pipelines.base.db import vector_store
from pipelines.base.embedding import embed_model

splitter = SemanticSplitterNodeParser(
    buffer_size=1, breakpoint_percentile_threshold=95, embed_model=embed_model
)

TextIngestionPipeline = IngestionPipeline(transformations=[
    splitter,
    embed_model,
], vector_store=vector_store, docstore_strategy=DocstoreStrategy.UPSERTS)