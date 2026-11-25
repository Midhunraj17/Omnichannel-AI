from app.services.cohere_client import cohere_client
from app.core.config import settings


def rerank_documents(query, documents):

    response = cohere_client.rerank(

        model=settings.COHERE_RERANK_MODEL,

        query=query,

        documents=documents,

        top_n=min(3, len(documents))

    )

    results = []

    for item in response.results:

        results.append({

            "index": item.index,

            "relevance_score": item.relevance_score,

            "document": documents[item.index]

        })

    return results