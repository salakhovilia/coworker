import tree_sitter_languages
from llama_index.core.ingestion import IngestionPipeline, DocstoreStrategy
from llama_index.core.node_parser import SemanticSplitterNodeParser, CodeSplitter, SentenceSplitter

from pipelines.base.db import vector_store
from pipelines.base.embedding import embed_model

sentence_splitter = SentenceSplitter()
splitter = SemanticSplitterNodeParser(
    buffer_size=1, breakpoint_percentile_threshold=95, embed_model=embed_model,
    sentence_splitter=lambda text: sentence_splitter.split_text(text)
)

TextIngestionPipeline = IngestionPipeline(name='TextIngestion',
                                          transformations=[
                                              splitter,
                                              embed_model
                                          ],
                                          vector_store=vector_store,
                                          docstore_strategy=DocstoreStrategy.UPSERTS
                                          )


def build_code_ingestion_pipeline(language: str):
    parser = tree_sitter_languages.get_parser(language)
    return IngestionPipeline(transformations=[
        CodeSplitter(language=language, parser=parser),
        embed_model,
    ], vector_store=vector_store, docstore_strategy=DocstoreStrategy.UPSERTS)
