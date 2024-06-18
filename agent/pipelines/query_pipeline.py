from haystack import Pipeline
from haystack.components.builders import PromptBuilder
from haystack.components.generators import OpenAIGenerator
from pipelines.text_embeder import TextEmbedder
from .store import Retriever
from haystack.utils import Secret


f = open("./prompts/main.txt", "r")
mainPrompt = f.read()

f = open("./prompts/query-template.txt", "r")
queryTemplate = f.read()

QueryPipeline = Pipeline()
QueryPipeline.add_component("embedder", TextEmbedder)
QueryPipeline.add_component("retriever", Retriever)
QueryPipeline.add_component("prompt_builder", PromptBuilder(template=queryTemplate))
QueryPipeline.add_component(
    "llm",
    OpenAIGenerator(model='gpt-4o', api_key=Secret.from_env_var("OPEN_API_KEY"), system_prompt=mainPrompt),
)

QueryPipeline.connect("embedder.embedding", "retriever.query_embedding")
QueryPipeline.connect("retriever", "prompt_builder.documents")
QueryPipeline.connect("prompt_builder", "llm")