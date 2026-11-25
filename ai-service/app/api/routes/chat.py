from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.llm_service import (
    generate_response_with_metadata,
    LLMServiceError
)

router = APIRouter()


class ChatRequest(BaseModel):

    message: str = Field(
        min_length=1,
        max_length=10000
    )


@router.post("/chat/generate")
def chat_generate(request: ChatRequest):

    try:

        result = generate_response_with_metadata(
            request.message
        )

        return {
            "success": True,
            "response": result["response"],
            "model": result["model"],
            "finish_reason": result["finish_reason"],
            "usage": result["usage"],
            "service": "Cohere LLM"
        }

    except LLMServiceError as error:

        print("AI Generation Error:", str(error))

        raise HTTPException(
            status_code=502,
            detail="AI response generation failed"
        )

    except Exception as error:

        print("Unexpected AI Error:", str(error))

        raise HTTPException(
            status_code=500,
            detail="Internal AI service error"
        )