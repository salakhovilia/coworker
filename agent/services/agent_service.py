import datetime
import json

from langfuse import Langfuse

from pipelines.query_pipeline import QueryPipeline

langfuse = Langfuse()


class AgentService:
    async def query(self, question:str, companyId: int, meta:dict):
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
                        {"field": "meta.type", "operator": "!=", "value": 'telegram-file'},
                        {"field": "meta.chatId", "operator": "==", "value": str(meta['chatId'])},
                        {"field": "content", "operator": "!=", "value": question},
                        {"field": "meta.date", "operator": ">", "value": date.isoformat()},
                    ],
                }
            },
            "prompt_builder": {"question": question, 'meta': meta},
        })

        if len(result['llm']['replies']) == 0 or not result['llm']['replies'][0]:
            return None

        return json.loads(result['llm']['replies'][0])

    async def suggest(self, message: str, companyId: int, meta:dict):
        response = await self.query(message, companyId, meta)

        if not response or response['score'] < 7:
            return None

        return response['message']
