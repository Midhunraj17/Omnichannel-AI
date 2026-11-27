from typing import Any

from pydantic import (

    BaseModel,

    ConfigDict,

    Field,

    field_validator,

)


class RerankDocument(BaseModel):

    model_config = ConfigDict(

        extra="forbid",

    )

    chunk_id: str = Field(

        min_length=1,

        max_length=100,

    )

    document_id: str | None = Field(

        default=None,

        max_length=100,

    )

    file_name: str | None = Field(

        default=None,

        max_length=255,

    )

    chunk_index: int | None = Field(

        default=None,

        ge=0,

    )

    content: str = Field(

        min_length=1,

        max_length=4000,

    )

    metadata: dict[str, Any] = Field(

        default_factory=dict,

    )

    similarity: float | None = None

    semantic_similarity: float | None = None

    lexical_score: float | None = None

    semantic_rank: int | None = Field(

        default=None,

        ge=1,

    )

    lexical_rank: int | None = Field(

        default=None,

        ge=1,

    )

    hybrid_score: float | None = None

    @field_validator("content")

    @classmethod

    def validate_content(cls, value):

        value = value.strip()

        if not value:

            raise ValueError(

                "Document content cannot be empty."

            )

        return value


class KnowledgeRerankingRequest(BaseModel):

    model_config = ConfigDict(

        extra="forbid",

    )

    query: str = Field(

        min_length=1,

        max_length=5000,

    )

    documents: list[RerankDocument] = Field(

        max_length=20,

    )

    top_n: int = Field(

        default=8,

        ge=1,

        le=8,

    )

    min_relevance_score: float = Field(

        default=0.0,

        ge=0.0,

        le=1.0,

    )

    max_context_characters: int = Field(

        default=8000,

        ge=1,

        le=8000,

    )

    @field_validator("query")

    @classmethod

    def validate_query(cls, value):

        value = value.strip()

        if not value:

            raise ValueError(

                "Query cannot be empty."

            )

        return value


class KnowledgeRerankingResponse(BaseModel):

    success: bool

    query: str

    reranking_model: str

    candidate_count: int

    result_count: int

    results: list[dict[str, Any]]

    context: str

    context_character_count: int

    context_document_count: int

    sources: list[dict[str, Any]]

    context_truncated: bool