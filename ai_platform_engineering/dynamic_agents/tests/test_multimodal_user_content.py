"""Multimodal user-turn construction for chat input.

Verifies ``_build_user_content`` builds a LangChain-standard content list:
images become ``image`` blocks and supported documents become ``file``
blocks, so the model reads every attachable file. Files Bedrock cannot
ingest are skipped with a warning.
"""

from __future__ import annotations

from dynamic_agents.models import InputFile
from dynamic_agents.services.agent_runtime import _build_user_content


def test_single_base64_image_builds_content_list():
    files = [InputFile(mime_type="image/png", data="aGVsbG8=", name="a.png")]
    content = _build_user_content("describe this", files)

    assert isinstance(content, list)
    assert content[0] == {"type": "text", "text": "describe this"}
    assert content[1] == {"type": "image", "mime_type": "image/png", "base64": "aGVsbG8="}


def test_multiple_images_each_get_a_block():
    files = [
        InputFile(mime_type="image/png", data="Zm9v"),
        InputFile(mime_type="image/webp", data="YmFy"),
    ]
    content = _build_user_content("compare", files)

    assert isinstance(content, list)
    # 1 text block + 2 image blocks
    assert len(content) == 3
    assert [b["type"] for b in content] == ["text", "image", "image"]


def test_document_becomes_file_block_with_name():
    files = [InputFile(mime_type="application/pdf", data="cGRm", name="report.pdf")]
    content = _build_user_content("summarize", files)

    assert isinstance(content, list)
    assert content[1] == {
        "type": "file",
        "mime_type": "application/pdf",
        "base64": "cGRm",
        "name": "report.pdf",
    }


def test_mixed_image_and_document_both_kept():
    files = [
        InputFile(mime_type="text/plain", data="cGxhaW4=", name="notes.txt"),
        InputFile(mime_type="image/png", data="aW1n"),
    ]
    content = _build_user_content("mixed", files)

    assert isinstance(content, list)
    # text + a document block + an image block
    assert len(content) == 3
    assert [b["type"] for b in content] == ["text", "file", "image"]


def test_unsupported_type_is_skipped_and_degrades_to_string():
    # A lone type Bedrock cannot ingest leaves no attachable block, so we
    # fall back to the plain string rather than send a text-only list.
    files = [InputFile(mime_type="application/zip", data="emlw", name="a.zip")]
    content = _build_user_content("here", files)

    assert content == "here"
