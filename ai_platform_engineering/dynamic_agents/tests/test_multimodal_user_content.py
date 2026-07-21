"""Multimodal user-turn construction for chat input.

Verifies ``_build_user_content`` builds a LangChain-standard content list:
images become ``image`` blocks and supported documents become ``file``
blocks, so the model reads every attachable file. Files Bedrock cannot
ingest are skipped, and — when the selected model declares it doesn't accept
a modality — files are dropped so a no-vision model degrades cleanly to text.
Both kinds of drop are reported in the returned ``skipped`` list so the caller
can surface a warning to the user.
"""

from __future__ import annotations

from dynamic_agents.models import InputFile
from dynamic_agents.services.agent_runtime import (
    SKIP_NOT_ACCEPTED_BY_MODEL,
    SKIP_UNSUPPORTED_BY_PROVIDER,
    _build_user_content,
)
from dynamic_agents.services.model_capabilities import ModelCapabilities


def test_single_base64_image_builds_content_list():
    files = [InputFile(mime_type="image/png", data="aGVsbG8=", name="a.png")]
    content, skipped = _build_user_content("describe this", files)

    assert isinstance(content, list)
    assert content[0] == {"type": "text", "text": "describe this"}
    assert content[1] == {"type": "image", "mime_type": "image/png", "base64": "aGVsbG8="}
    assert skipped == []


def test_multiple_images_each_get_a_block():
    files = [
        InputFile(mime_type="image/png", data="Zm9v"),
        InputFile(mime_type="image/webp", data="YmFy"),
    ]
    content, skipped = _build_user_content("compare", files)

    assert isinstance(content, list)
    # 1 text block + 2 image blocks
    assert len(content) == 3
    assert [b["type"] for b in content] == ["text", "image", "image"]
    assert skipped == []


def test_document_becomes_file_block_with_name():
    files = [InputFile(mime_type="application/pdf", data="cGRm", name="report.pdf")]
    content, skipped = _build_user_content("summarize", files)

    assert isinstance(content, list)
    assert content[1] == {
        "type": "file",
        "mime_type": "application/pdf",
        "base64": "cGRm",
        "name": "report.pdf",
    }
    assert skipped == []


def test_mixed_image_and_document_both_kept():
    files = [
        InputFile(mime_type="text/plain", data="cGxhaW4=", name="notes.txt"),
        InputFile(mime_type="image/png", data="aW1n"),
    ]
    content, skipped = _build_user_content("mixed", files)

    assert isinstance(content, list)
    # text + a document block + an image block
    assert len(content) == 3
    assert [b["type"] for b in content] == ["text", "file", "image"]
    assert skipped == []


def test_unsupported_type_is_skipped_and_degrades_to_string():
    # A lone type Bedrock cannot ingest leaves no attachable block, so we
    # fall back to the plain string rather than send a text-only list.
    files = [InputFile(mime_type="application/zip", data="emlw", name="a.zip")]
    content, skipped = _build_user_content("here", files)

    assert content == "here"
    assert len(skipped) == 1
    assert skipped[0].name == "a.zip"
    assert skipped[0].reason == SKIP_UNSUPPORTED_BY_PROVIDER


# --- Model-capability degradation (ticket 2032) ------------------------------


def test_no_vision_model_drops_image_and_reports_skip():
    # Provider supports image/png, but the agent's model declares it doesn't
    # accept images — the file is dropped and reported, and with no other file
    # the content degrades to the plain text string.
    caps = ModelCapabilities(accepts_images=False, accepts_documents=True)
    files = [InputFile(mime_type="image/png", data="aW1n", name="chart.png")]

    content, skipped = _build_user_content("what's in this?", files, caps)

    assert content == "what's in this?"
    assert len(skipped) == 1
    assert skipped[0].name == "chart.png"
    assert skipped[0].reason == SKIP_NOT_ACCEPTED_BY_MODEL


def test_no_vision_model_still_keeps_documents():
    # A model that takes documents but not images keeps the PDF and drops only
    # the image.
    caps = ModelCapabilities(accepts_images=False, accepts_documents=True)
    files = [
        InputFile(mime_type="image/png", data="aW1n", name="chart.png"),
        InputFile(mime_type="application/pdf", data="cGRm", name="report.pdf"),
    ]

    content, skipped = _build_user_content("review", files, caps)

    assert isinstance(content, list)
    assert [b["type"] for b in content] == ["text", "file"]
    assert [s.reason for s in skipped] == [SKIP_NOT_ACCEPTED_BY_MODEL]
    assert skipped[0].name == "chart.png"


def test_none_capabilities_is_permissive():
    # capabilities=None must preserve legacy behavior: everything the provider
    # supports is accepted.
    files = [InputFile(mime_type="image/png", data="aW1n", name="x.png")]
    content, skipped = _build_user_content("hi", files, None)

    assert isinstance(content, list)
    assert content[1]["type"] == "image"
    assert skipped == []
