from typing import Any, Dict, List, Optional

from llama_index.core.bridge.pydantic import Field
from llama_index.core.callbacks import CBEventType, EventPayload, CallbackManager
from llama_index.core.instrumentation.events.synthesis import SynthesizeStartEvent, SynthesizeEndEvent
from llama_index.core.llms import ChatMessage
from llama_index.core.query_pipeline import CustomQueryComponent
from llama_index.core.schema import NodeWithScore, MetadataMode
from llama_index.core.settings import callback_manager_from_settings_or_context, Settings
from llama_index.llms.openai import OpenAI


class ResponseWithChatHistory(CustomQueryComponent):
    llm: OpenAI = Field(description="OpenAI LLM")
    system_prompt: Optional[str] = Field(
        default=None, description="System prompt to use for the LLM"
    )
    context_prompt: str = Field(
        description="Context prompt to use for the LLM",
    )
    callback_manager: CallbackManager = Field(
        default=None,
        description="callback_manager",
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self.callback_manager = callback_manager_from_settings_or_context(Settings, None)
        self.llm.callback_manager = self.callback_manager

    def _validate_component_inputs(
            self, input: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate component inputs during run_component."""
        # NOTE: this is OPTIONAL but we show you where to do validation as an example
        return input

    @property
    def _input_keys(self) -> set:
        """Input keys dict."""
        # NOTE: These are required inputs. If you have optional inputs please override
        # `optional_input_keys_dict`
        return {"chat_history", "nodes", "query_str"}

    @property
    def _output_keys(self) -> set:
        return {"output"}

    def _prepare_context(
            self,
            chat_history: List[ChatMessage],
            nodes: List[NodeWithScore],
            query_str: str,
    ) -> List[ChatMessage]:
        node_context = ""
        for node in nodes:
            for key in node.metadata:
                if key.startswith("_"):
                    continue

                node_context += f"{key}: {node.metadata[key]}\n"
            node_context += f"\n{node.get_content(metadata_mode=MetadataMode.LLM)}\n\n"

        formatted_context = self.context_prompt.format(
            node_context=node_context, query_str=query_str
        )
        user_message = ChatMessage(role="user", content=formatted_context)

        chat_history.append(user_message)

        if self.system_prompt is not None:
            chat_history = [
                               ChatMessage(role="system", content=self.system_prompt)
                           ] + chat_history

        return chat_history

    def _run_component(self, **kwargs) -> Dict[str, Any]:
        """Run the component."""
        chat_history = kwargs["chat_history"]
        nodes = kwargs["nodes"]
        query_str = kwargs["query_str"]

        prepared_context = self._prepare_context(
            chat_history, nodes, query_str
        )

        response = self.llm.chat(prepared_context)

        return {"output": response.message.content}

    async def _arun_component(self, **kwargs: Any) -> Dict[str, Any]:
        """Run the component asynchronously."""
        # NOTE: Optional, but async LLM calls are easy to implement
        chat_history = kwargs["chat_history"]
        nodes = kwargs["nodes"]
        query_str = kwargs["query_str"]

        with self.callback_manager.event(
                CBEventType.SYNTHESIZE,
                payload={EventPayload.QUERY_STR: query_str},
        ) as event:
            prepared_context = self._prepare_context(
                chat_history, nodes, query_str
            )

            response = await self.llm.achat(prepared_context)

            event.on_end(payload={EventPayload.RESPONSE: response})

        return {"output": response.message.content}
