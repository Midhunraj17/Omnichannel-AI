import hashlib
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


def test_chunk_text_rejects_invalid_chunk_size():
    with pytest.raises(ValueError):
        chunk_text("some content", chunk_chars=100, overlap_chars=10)


def test_chunk_text_rejects_invalid_overlap():
    with pytest.raises(ValueError):
        chunk_text("some content", chunk_chars=300, overlap_chars=300)


def test_prepare_document_rejects_empty_text():
    with pytest.raises(KnowledgeIngestionError):
        prepare_document("empty.txt", b"   ")


def test_prepare_document_extracts_utf8_text_and_hashes():
    raw = b"Hello support"
    result = prepare_document("faq.txt", raw)
    assert result["file_name"] == "faq.txt"
    assert result["content_hash"] == hashlib.sha256(raw).hexdigest()
    assert result["chunks"][0]["content"] == "Hello support"


def test_prepare_document_rejects_path_traversal():
    with pytest.raises(KnowledgeIngestionError):
        prepare_document("../faq.txt", b"Hello")


def test_prepare_document_rejects_unsupported_extension():
    with pytest.raises(KnowledgeIngestionError):
        prepare_document("malware.exe", b"Hello")


def test_chunk_text_preserves_all_non_whitespace_content():
    text = "Paragraph one. " * 100 + "\n\n" + "Paragraph two. " * 100
    chunks = chunk_text(text, chunk_chars=400, overlap_chars=60)
    joined = " ".join(chunks)
    assert "Paragraph one." in joined
    assert "Paragraph two." in joined
