"""Phase 5 document extraction, normalization, chunking and embeddings."""
from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path
from typing import Any

from app.services.embedding_service import generate_embedding

MAX_FILE_BYTES = 10 * 1024 * 1024
DEFAULT_CHUNK_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 180


class KnowledgeIngestionError(ValueError):
    """Raised when a source document cannot be safely ingested."""


def _extract_text(file_name: str, raw: bytes) -> str:
    suffix = Path(file_name).suffix.lower()
    if not raw:
        raise KnowledgeIngestionError("The uploaded file is empty.")
    if len(raw) > MAX_FILE_BYTES:
        raise KnowledgeIngestionError("The uploaded file exceeds the 10 MiB limit.")

    if suffix in {".txt", ".md"}:
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise KnowledgeIngestionError("Text files must be UTF-8 encoded.") from exc

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except Exception as exc:
            raise KnowledgeIngestionError("Unable to extract text from this PDF.") from exc

    if suffix == ".docx":
        try:
            from docx import Document
            doc = Document(io.BytesIO(raw))
            return "\n".join(p.text for p in doc.paragraphs)
        except Exception as exc:
            raise KnowledgeIngestionError("Unable to extract text from this DOCX.") from exc

    raise KnowledgeIngestionError("Unsupported file type. Use TXT, MD, PDF, or DOCX.")


def normalize_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(
    text: str,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[str]:
    if chunk_chars < 200 or chunk_chars > 4000:
        raise ValueError("chunk_chars must be between 200 and 4000.")
    if overlap_chars < 0 or overlap_chars >= chunk_chars:
        raise ValueError("overlap_chars must be non-negative and smaller than chunk_chars.")

    normalized = normalize_text(text)
    if not normalized:
        raise KnowledgeIngestionError(
            "No extractable text was found. Scanned PDFs need OCR before upload."
        )

    chunks: list[str] = []
    start = 0
    length = len(normalized)
    while start < length:
        end = min(start + chunk_chars, length)
        if end < length:
            boundary = normalized.rfind("\n", start + chunk_chars // 2, end)
            if boundary == -1:
                boundary = normalized.rfind(" ", start + chunk_chars // 2, end)
            if boundary > start:
                end = boundary
        piece = normalized[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= length:
            break
        start = max(end - overlap_chars, start + 1)
    return chunks


def prepare_document(file_name: str, raw: bytes) -> dict[str, Any]:
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
    if len(values) != 1024:
        raise KnowledgeIngestionError(
            f"Embedding dimension mismatch: expected 1024, received {len(values)}."
        )
    return values


def ingest_document(file_name: str, raw: bytes) -> dict[str, Any]:
    prepared = prepare_document(file_name, raw)
    for chunk in prepared["chunks"]:
        chunk["embedding"] = embed_text(chunk["content"])
    return prepared
