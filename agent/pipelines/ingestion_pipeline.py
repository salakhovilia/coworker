import tree_sitter_languages
from llama_index.core.ingestion import IngestionPipeline, DocstoreStrategy, IngestionCache
from llama_index.core.node_parser import SemanticSplitterNodeParser, CodeSplitter
from llama_index.embeddings.openai import OpenAIEmbedding


from pipelines.base.db import vector_store


splitter = SemanticSplitterNodeParser(
    buffer_size=1, breakpoint_percentile_threshold=98,
    embed_model=OpenAIEmbedding(model="text-embedding-3-small"),
    include_metadata=False,
)

TextIngestionPipeline = IngestionPipeline(
    name='TextIngestion',
    transformations=[
        splitter,
        OpenAIEmbedding(model="text-embedding-3-small")
    ],
    vector_store=vector_store,
    docstore_strategy=DocstoreStrategy.UPSERTS
)


def build_code_ingestion_pipeline(language: str):
    parser = tree_sitter_languages.get_parser(language)
    return IngestionPipeline(transformations=[
        CodeSplitter(language=language, parser=parser),
        OpenAIEmbedding(model="text-embedding-3-small"),
    ], vector_store=vector_store, docstore_strategy=DocstoreStrategy.UPSERTS)
