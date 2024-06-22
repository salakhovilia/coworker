from dotenv import load_dotenv
from haystack.components.embedders import OpenAIDocumentEmbedder, OpenAITextEmbedder
from haystack.utils import Secret

load_dotenv()

TextEmbedder = OpenAITextEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY"))
DocumentEmbedder = OpenAIDocumentEmbedder(api_key=Secret.from_env_var("OPEN_API_KEY"))