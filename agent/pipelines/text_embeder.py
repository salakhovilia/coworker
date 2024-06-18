from haystack.components.embedders import OpenAITextEmbedder, OpenAIDocumentEmbedder
from haystack.utils import Secret

TextEmbedder = OpenAITextEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY"))
DocumentEmbedder = OpenAIDocumentEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY"))