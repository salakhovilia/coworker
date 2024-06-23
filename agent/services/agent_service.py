import datetime

from langfuse import Langfuse

from pipelines.query_pipeline import QueryPipeline
from pipelines.suggest_pipeline import SuggestPipeline

langfuse = Langfuse()


class AgentService:
    async def query(self, question:str, companyId: int, meta:dict, optional_answer=False):
        queryPrompt = langfuse.get_prompt(name='Query')

        llm = QueryPipeline.get_component('llm')
        llm.system_prompt = queryPrompt.prompt

        date = datetime.datetime.fromtimestamp(round(datetime.datetime.now().timestamp()) - 6 * 60 * 60)

        result = QueryPipeline.run({
            "embedder": {"text": question},
            "embedding_retriever": {
                "filters": {
                    "operator": "AND",
                    "conditions": [
                        {"field": "meta.companyId", "operator": "==", "value": str(companyId)},
                        {"field": "content", "operator": "!=", "value": question},
                    ],
                }
            },
            "keyword_retriever": {
                "query": question,
                "filters": {
                    "operator": "AND",
                    "conditions": [
                        {"field": "meta.companyId", "operator": "==", "value": str(companyId)},
                        {"field": "content", "operator": "!=", "value": question},
                    ],
                }
            },
            "context_retriever": {
                "filters": {
                    "operator": "AND",
                    "conditions": [
                        {"field": "meta.companyId", "operator": "==", "value": str(companyId)},
                        {"field": "content", "operator": "!=", "value": question},
                        {"field": "meta.date", "operator": ">", "value": date.isoformat()},
                    ],
                }
            },
            "prompt_builder": {"question": question, 'meta': meta, 'optional_answer': optional_answer},
        })

        if len(result['llm']['replies']) == 0 or not result['llm']['replies'][0]:
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
            return await self.query(message, companyId, {}, optional_answer=True)
