from app.services.cohere_client import cohere_client
from app.core.config import settings


def generate_embedding(text):

    response = cohere_client.embed(

        model=settings.COHERE_EMBED_MODEL,

        texts=[text],

        input_type="search_document",

        embedding_types=["float"],

        output_dimension=settings.COHERE_EMBED_DIMENSION

    )

    embedding = response.embeddings.float[0]

    return embedding