from typing import Any

from dotenv import load_dotenv
from haystack import Pipeline
from haystack import component
from haystack.components.builders import PromptBuilder
from haystack.components.embedders import OpenAITextEmbedder
from haystack.components.generators import OpenAIGenerator
from haystack.components.rankers import TransformersSimilarityRanker
from haystack.components.retrievers import FilterRetriever
from haystack_integrations.components.retrievers.pgvector import PgvectorEmbeddingRetriever, PgvectorKeywordRetriever
from jinja2 import Template, meta
from .store import DocumentStore
from haystack.utils import Secret
from haystack_integrations.components.connectors.langfuse import LangfuseConnector

load_dotenv()


f = open("./prompts/query-template.txt", "r")
queryTemplate = f.read()


class CustomPromptBuilder(PromptBuilder):
    def __init__(self, template, required_variables=None, **kwargs):
        self._template_string = template
        self.template = Template(template, **kwargs)
        self.required_variables = required_variables or []
        ast = self.template.environment.parse(template)
        template_variables = meta.find_undeclared_variables(ast)

        for var in template_variables:
            if var in self.required_variables:
                component.set_input_type(self, var, Any)
            else:
                component.set_input_type(self, var, Any, "")

ranker = TransformersSimilarityRanker(token=Secret.from_env_var("HF_API_TOKEN"), model='BAAI/bge-reranker-v2-m3', top_k=10)
ranker.warm_up()

QueryPipeline = Pipeline()
QueryPipeline.add_component("tracer", LangfuseConnector("Query pipeline"))
QueryPipeline.add_component("embedder", OpenAITextEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY")))
QueryPipeline.add_component("embedding_retriever", PgvectorEmbeddingRetriever(document_store=DocumentStore, top_k=20))
QueryPipeline.add_component("ranker", ranker)
QueryPipeline.add_component("context_retriever", FilterRetriever(document_store=DocumentStore))
QueryPipeline.add_component("prompt_builder", CustomPromptBuilder(template=queryTemplate, trim_blocks=True))
QueryPipeline.add_component(
    "llm",
    OpenAIGenerator(model='gpt-4o', api_key=Secret.from_env_var("OPEN_API_KEY"), generation_kwargs={
        'response_format': {"type": "json_object"}
    }),
)

QueryPipeline.connect("embedder.embedding", "embedding_retriever.query_embedding")
QueryPipeline.connect("embedding_retriever", "ranker")
QueryPipeline.connect("ranker", "prompt_builder")
QueryPipeline.connect("context_retriever", "prompt_builder.context_documents")

QueryPipeline.connect("prompt_builder", "llm")
