from dotenv import load_dotenv
from llama_index.core import Settings
from llama_index.embeddings.openai import OpenAIEmbedding

load_dotenv()

embed_model = OpenAIEmbedding(
    model="text-embedding-3-small",
)

Settings.embed_model = embed_model
