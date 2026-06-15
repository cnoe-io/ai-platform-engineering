"""Tests for local file upload ingestion helpers.

# assisted-by Codex Codex-sonnet-4-6
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter

from server import restapi


def _upload(filename: str, content_type: str | None = None):
    return SimpleNamespace(filename=filename, content_type=content_type)


def test_local_file_datasource_id_is_stable_and_content_addressed() -> None:
    one = restapi._local_file_datasource_id("Runbook.md", b"# hello")
    two = restapi._local_file_datasource_id("Runbook.md", b"# hello")
    three = restapi._local_file_datasource_id("Runbook.md", b"# changed")

    assert one == two
    assert one.startswith("src_file_runbook_")
    assert one != three


def test_local_files_datasource_id_is_stable_for_same_file_set() -> None:
    one = restapi._local_files_datasource_id(
        [
            ("one.md", b"# one"),
            ("two.txt", b"two"),
        ],
    )
    two = restapi._local_files_datasource_id(
        [
            ("one.md", b"# one"),
            ("two.txt", b"two"),
        ],
    )
    changed = restapi._local_files_datasource_id(
        [
            ("one.md", b"# one"),
            ("two.txt", b"changed"),
        ],
    )

    assert one == two
    assert one.startswith("src_file_one_2_files_")
    assert one != changed


def test_validate_local_file_upload_accepts_markdown_text_and_pdf() -> None:
    assert restapi._validate_local_file_upload(_upload("guide.md", "text/markdown"), b"# guide") == "guide.md"
    assert restapi._validate_local_file_upload(_upload("notes.txt", "text/plain"), b"notes") == "notes.txt"
    assert restapi._validate_local_file_upload(_upload("paper.pdf", "application/pdf"), b"%PDF-1.4\n%%EOF") == "paper.pdf"


def test_validate_local_file_upload_rejects_unsupported_type() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(_upload("archive.zip", "application/zip"), b"PK")

    assert exc.value.status_code == 415


def test_validate_local_file_upload_rejects_extension_mime_mismatch() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(_upload("invoice.pdf", "text/plain"), b"%PDF-1.4\n%%EOF")

    assert exc.value.status_code == 415


def test_validate_local_file_upload_rejects_spoofed_pdf_content() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(_upload("invoice.pdf", "application/pdf"), b"not really a pdf")

    assert exc.value.status_code == 415


def test_validate_local_file_upload_rejects_html_disguised_as_markdown() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(
            _upload("notes.md", "text/markdown"),
            b"<!doctype html><script>alert('xss')</script>",
        )

    assert exc.value.status_code == 415


def test_validate_local_file_upload_rejects_oversized_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(restapi, "max_local_file_upload_bytes", 4)

    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(_upload("notes.txt", "text/plain"), b"12345")

    assert exc.value.status_code == 413


def test_validate_local_file_batch_rejects_too_many_files(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(restapi, "max_documents_per_ingest", 1)

    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_batch([("one.md", b"1"), ("two.md", b"2")])

    assert exc.value.status_code == 413


def test_validate_local_file_batch_rejects_total_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(restapi, "max_local_file_total_upload_bytes", 4)

    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_batch([("one.md", b"12"), ("two.md", b"345")])

    assert exc.value.status_code == 413


def test_extract_local_file_text_decodes_markdown() -> None:
    text, document_type = restapi._extract_local_file_text(
        "guide.md",
        "text/markdown",
        "# Title\n\nBody".encode(),
    )

    assert document_type == "markdown"
    assert "Title" in text


def test_extract_local_file_text_rejects_pdf_without_text() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._extract_local_file_text("empty.pdf", "application/pdf", b"%PDF-1.4\n%%EOF")

    assert exc.value.status_code == 400


def test_extract_local_file_text_rejects_encrypted_pdf() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.encrypt("secret")
    output = restapi.BytesIO()
    writer.write(output)

    with pytest.raises(HTTPException) as exc:
        restapi._extract_local_file_text("secret.pdf", "application/pdf", output.getvalue())

    assert exc.value.status_code == 400
    assert "encrypted" in str(exc.value.detail).lower()


def test_extract_local_file_text_rejects_pdf_with_too_many_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    output = restapi.BytesIO()
    writer.write(output)
    monkeypatch.setattr(restapi, "max_local_file_pdf_pages", 1)

    with pytest.raises(HTTPException) as exc:
        restapi._extract_local_file_text("large.pdf", "application/pdf", output.getvalue())

    assert exc.value.status_code == 413
