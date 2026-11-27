"""Safe document extraction, normalization, chunking and Cohere embeddings."""
from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.embedding_service import generate_embedding

MAX_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_CHUNK_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 180
SUPPORTED_SUFFIXES = {".txt", ".md", ".pdf", ".docx"}


class KnowledgeIngestionError(ValueError):
    """Raised when a document cannot be safely ingested."""


def _extract_text(file_name: str, raw: bytes) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise KnowledgeIngestionError(
            "Unsupported file type. Upload TXT, MD, PDF, or DOCX."
        )
    if not raw:
        raise KnowledgeIngestionError("The uploaded file is empty.")
    if len(raw) > MAX_FILE_BYTES:
        raise KnowledgeIngestionError("The uploaded file exceeds the 10 MiB limit.")

    if suffix in {".txt", ".md"}:
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise KnowledgeIngestionError(
                "Text files must use UTF-8 encoding."
            ) from exc

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw), strict=False)
            if reader.is_encrypted:
                try:
                    reader.decrypt("")
                except Exception as exc:
                    raise KnowledgeIngestionError(
                        "Password-protected PDFs are not supported."
                    ) from exc
            return "\n\n".join(page.extract_text() or "" for page in reader.pages)
        except KnowledgeIngestionError:
            raise
        except Exception as exc:
            raise KnowledgeIngestionError(
                "Unable to extract text from this PDF."
            ) from exc

    try:
        from docx import Document
        document = Document(io.BytesIO(raw))
        paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
        # Include table cell text, which is commonly used in product manuals.
        table_lines = [
            " | ".join(cell.text.strip() for cell in row.cells)
            for table in document.tables
            for row in table.rows
            if any(cell.text.strip() for cell in row.cells)
        ]
        return "\n".join(paragraphs + table_lines)
    except Exception as exc:
        raise KnowledgeIngestionError(
            "Unable to extract text from this DOCX."
        ) from exc


def normalize_text(text: str) -> str:
    if not isinstance(text, str):
        raise TypeError("text must be a string.")
    text = text.replace("\x00", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(
    text: str,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[str]:
    if not isinstance(chunk_chars, int) or not 200 <= chunk_chars <= 4000:
        raise ValueError("chunk_chars must be between 200 and 4000.")
    if (
        not isinstance(overlap_chars, int)
        or overlap_chars < 0
        or overlap_chars >= chunk_chars
    ):
        raise ValueError(
            "overlap_chars must be non-negative and smaller than chunk_chars."
        )

    normalized = normalize_text(text)
    if not normalized:
        raise KnowledgeIngestionError(
            "No extractable text was found. Scanned PDFs require OCR before upload."
        )

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        hard_end = min(start + chunk_chars, len(normalized))
        end = hard_end

        if hard_end < len(normalized):
            # Prefer paragraph, then sentence, then whitespace boundaries.
            lower_bound = start + int(chunk_chars * 0.60)
            candidates = [
                normalized.rfind("\n\n", lower_bound, hard_end),
                normalized.rfind("\n", lower_bound, hard_end),
                normalized.rfind(". ", lower_bound, hard_end),
                normalized.rfind(" ", lower_bound, hard_end),
            ]
            boundary = max(candidates)
            if boundary > start:
                end = boundary + (2 if normalized[boundary:boundary + 2] == "\n\n" else 1)

        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(normalized):
            break
        next_start = end - overlap_chars
        start = max(next_start, start + 1)

    return chunks


def prepare_document(file_name: str, raw: bytes) -> dict[str, Any]:
    if not isinstance(file_name, str) or not file_name.strip():
        raise KnowledgeIngestionError("A valid file name is required.")
    if Path(file_name).name != file_name or file_name in {".", ".."}:
        raise KnowledgeIngestionError("File name must not contain a path.")
    text = normalize_text(_extract_text(file_name, raw))
    chunks = chunk_text(text)
    return {
        "file_name": file_name,
        "content_hash": hashlib.sha256(raw).hexdigest(),
        "character_count": len(text),
        "chunks": [
            {
                "chunk_index": index,
                "content": content,
                "token_count": None,
                "metadata": {
                    "source_file": file_name,
                    "chunk_index": index,
                },
            }
            for index, content in enumerate(chunks)
        ],
    }


def embed_text(text: str) -> list[float]:
    vector = generate_embedding(text)
    values = [float(value) for value in vector]
    expected = int(settings.COHERE_EMBED_DIMENSION)
    if len(values) != expected:
        raise KnowledgeIngestionError(
            f"Embedding dimension mismatch: expected {expected}, received {len(values)}."
        )
    if not all(map(lambda value: value == value and abs(value) != float("inf"), values)):
        raise KnowledgeIngestionError("Embedding contains a non-finite value.")
    return values


def ingest_document(file_name: str, raw: bytes) -> dict[str, Any]:
    prepared = prepare_document(file_name, raw)
    for chunk in prepared["chunks"]:
        chunk["embedding"] = embed_text(chunk["content"])
    return prepared
