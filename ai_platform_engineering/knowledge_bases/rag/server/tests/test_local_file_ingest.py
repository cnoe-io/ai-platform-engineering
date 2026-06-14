"""Tests for local file upload ingestion helpers.

# assisted-by Codex Codex-sonnet-4-6
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

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


def test_validate_local_file_upload_accepts_markdown_text_and_pdf() -> None:
    assert restapi._validate_local_file_upload(_upload("guide.md", "text/markdown"), b"# guide") == "guide.md"
    assert restapi._validate_local_file_upload(_upload("notes.txt", "text/plain"), b"notes") == "notes.txt"
    assert restapi._validate_local_file_upload(_upload("paper.pdf", "application/pdf"), b"%PDF") == "paper.pdf"


def test_validate_local_file_upload_rejects_unsupported_type() -> None:
    with pytest.raises(HTTPException) as exc:
        restapi._validate_local_file_upload(_upload("archive.zip", "application/zip"), b"PK")

    assert exc.value.status_code == 415


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
