import langfuse
from langfuse import Langfuse

from pipelines.query_pipeline import QueryPipeline
from pipelines.suggest_pipeline import SuggestPipeline

langfuse = Langfuse()


class AgentService:
    async def query(self, question:str, companyId: int, meta:dict):
        queryPrompt = langfuse.get_prompt(name='Query')

        llm = QueryPipeline.get_component('llm')
        llm.system_prompt = queryPrompt.prompt

        result = QueryPipeline.run({
            "embedder": {"text": question},
            "retriever": {
                "filters": {
                    "operator": "AND",
                    "conditions": [
                        {"field": "meta.companyId", "operator": "==", "value": str(companyId)},
                    ],
                }
            },
            "prompt_builder": {"question": question, 'meta': meta},
        })

        if len(result['llm']['replies']) == 0:
            return None

        return result['llm']['replies'][0]

    async def suggest(self, message: str, companyId: int):
        suggested_result = SuggestPipeline.run({
            "embedder": {"text": message},
            "retriever": {
                "filters": {
                    "operator": "AND",
                    "conditions": [
                        {"field": "meta.companyId", "operator": "==", "value": str(companyId)},
                    ],
                }
            },
        })

        docs = suggested_result['retriever']['documents']

        if len(docs) and 0.85 < docs[0].score:
            return await self.query(message, companyId, {})
