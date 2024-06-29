from dotenv import load_dotenv
from haystack import Pipeline
from haystack.components.generators import OpenAIGenerator
from haystack.components.retrievers import FilterRetriever
from haystack.utils import Secret
from haystack_integrations.components.connectors.langfuse import LangfuseConnector

from pipelines.query_pipeline import CustomPromptBuilder
from pipelines.store import DocumentStore

load_dotenv()

f = open("./prompts/add_calendar_event_user.txt", "r")
userQueryTemplate = f.read()

f = open("./prompts/add_calendar_event_system.txt", "r")
systemQueryTemplate = f.read()

CalendarsEventsPipeline = Pipeline()
CalendarsEventsPipeline.add_component("tracer", LangfuseConnector("CalendarsEventsPipeline"))
CalendarsEventsPipeline.add_component("context_retriever", FilterRetriever(document_store=DocumentStore))
CalendarsEventsPipeline.add_component("prompt_builder",
                                      CustomPromptBuilder(template=userQueryTemplate, trim_blocks=True))
CalendarsEventsPipeline.add_component(
    "llm",
    OpenAIGenerator(model='gpt-4o', system_prompt=systemQueryTemplate, api_key=Secret.from_env_var("OPEN_API_KEY"),
                    generation_kwargs={
                        'response_format': {"type": "json_object"}
                    }
                    ),
)

CalendarsEventsPipeline.connect("context_retriever", "prompt_builder.context_documents")
CalendarsEventsPipeline.connect("prompt_builder", "llm")
