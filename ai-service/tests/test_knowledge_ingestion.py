import pytest

from app.services.knowledge_ingestion import (
    KnowledgeIngestionError,
    chunk_text,
    normalize_text,
    prepare_document,
)


def test_normalize_text_removes_nulls_and_excess_whitespace():
    assert normalize_text("A\x00  B\r\n\r\n\r\nC") == "A B\n\nC"


def test_chunk_text_returns_multiple_overlapping_chunks():
    text = "support information " * 180
    chunks = chunk_text(text, chunk_chars=500, overlap_chars=80)
    assert len(chunks) > 1
    assert all(chunk.strip() for chunk in chunks)
    assert chunks[0][:50] in text


def test_chunk_text_rejects_invalid_overlap():
    with pytest.raises(ValueError):
        chunk_text("some content", chunk_chars=300, overlap_chars=300)


def test_prepare_document_rejects_empty_text():
    with pytest.raises(KnowledgeIngestionError):
        prepare_document("empty.txt", b"   ")


def test_prepare_document_extracts_utf8_text_and_hashes():
    result = prepare_document("faq.txt", "Hello support".encode())
    assert result["file_name"] == "faq.txt"
    assert len(result["content_hash"]) == 64
    assert result["chunks"][0]["content"] == "Hello support"
