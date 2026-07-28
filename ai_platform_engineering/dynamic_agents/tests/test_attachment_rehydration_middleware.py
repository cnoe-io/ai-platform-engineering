# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Coverage for the attachment write path + rehydration middleware.

Two halves of the same invariant: **bytes never enter the checkpoint**.

- Write path (``_build_user_content`` with a store): a surviving file's block
  carries a ``source: {"store_key": ...}`` reference and no inline base64.
- Rehydration middleware: on the outgoing model call it re-inflates that
  reference into an inline base64 block, optionally appends a ``cachePoint``
  marker, and mutates only the request — the persisted message list is untouched.
"""

from __future__ import annotations

import base64
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage

from dynamic_agents.models import InputFile
from dynamic_agents.services.agent_runtime import _build_user_content
from dynamic_agents.services.attachment_store import LocalAttachmentStore
from dynamic_agents.services.middleware import AttachmentRehydrationMiddleware

# --- Write path: reference blocks, no inline bytes ---------------------------


def test_write_path_stores_bytes_and_emits_reference(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    raw = b"\x89PNG image payload"
    files = [InputFile(mime_type="image/png", data=base64.b64encode(raw).decode(), name="a.png")]

    content, skipped = _build_user_content("look", files, store=store)

    assert isinstance(content, list)
    block = content[1]
    assert block["type"] == "image"
    assert "base64" not in block  # bytes did NOT ride inline
    assert block["source"]["store_key"]
    assert skipped == []
    # Bytes actually landed in the store and are retrievable by the key.
    assert store.get(block["source"]["store_key"]) == raw


def test_write_path_without_store_keeps_inline_base64(tmp_path):
    # Legacy behavior: no store -> inline base64 exactly as before.
    files = [InputFile(mime_type="image/png", data="aW1n", name="a.png")]
    content, _ = _build_user_content("look", files)  # store=None
    assert content[1]["base64"] == "aW1n"
    assert "source" not in content[1]


def test_write_path_store_failure_falls_back_to_inline(tmp_path):
    class _BoomStore:
        backend_name = "boom"

        def put(self, data: bytes, *, content_type: str) -> str:
            raise RuntimeError("s3 down")

        def get(self, key: str) -> bytes:  # pragma: no cover - unused here
            raise KeyError(key)

        def readiness_check(self) -> None:  # pragma: no cover - unused here
            return None

    files = [InputFile(mime_type="image/png", data="aW1n", name="a.png")]
    content, skipped = _build_user_content("look", files, store=_BoomStore())

    # Storage hiccup degrades to inline base64 (today's behavior); file not lost.
    assert content[1]["base64"] == "aW1n"
    assert "source" not in content[1]
    assert skipped == []


# --- Rehydration middleware --------------------------------------------------


def _ref_message(store_key: str, *, block_type: str = "image", mime: str = "image/png"):
    return HumanMessage(
        content=[
            {"type": "text", "text": "describe"},
            {"type": block_type, "mime_type": mime, "source": {"store_key": store_key}},
        ]
    )


def test_rehydrate_reference_to_inline_base64(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    raw = b"rehydrate me"
    key = store.put(raw, content_type="image/png")
    mw = AttachmentRehydrationMiddleware(store)

    messages = [_ref_message(key)]
    rebuilt, changed = mw._rehydrate_messages(messages)

    assert changed
    block = rebuilt[0].content[1]
    assert "source" not in block
    assert base64.b64decode(block["base64"]) == raw
    # The text block is preserved untouched.
    assert rebuilt[0].content[0] == {"type": "text", "text": "describe"}


def test_rehydrate_does_not_mutate_input_messages(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    key = store.put(b"bytes", content_type="image/png")
    mw = AttachmentRehydrationMiddleware(store)

    original = _ref_message(key)
    messages = [original]
    rebuilt, _ = mw._rehydrate_messages(messages)

    # Persisted-state invariant: the source message still holds the reference,
    # only the returned copy is inflated.
    assert original.content[1]["source"] == {"store_key": key}
    assert "base64" not in original.content[1]
    assert rebuilt[0] is not original


def test_rehydrate_uses_lru_cache_no_refetch(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    key = store.put(b"cached bytes", content_type="image/png")

    calls = {"n": 0}
    real_get = store.get

    def counting_get(k: str) -> bytes:
        calls["n"] += 1
        return real_get(k)

    store.get = counting_get  # type: ignore[method-assign]
    mw = AttachmentRehydrationMiddleware(store)

    mw._rehydrate_messages([_ref_message(key)])
    mw._rehydrate_messages([_ref_message(key)])

    assert calls["n"] == 1  # second replay served from the in-process LRU


def test_rehydrate_fetch_failure_leaves_block_as_reference(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store)

    # store_key that was never written -> get() raises -> block passes through.
    messages = [_ref_message("attachments/zz/does-not-exist")]
    rebuilt, changed = mw._rehydrate_messages(messages)

    block = rebuilt[0].content[1]
    assert "base64" not in block
    assert block["source"]["store_key"] == "attachments/zz/does-not-exist"


def test_plain_text_messages_pass_through_unchanged(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store)
    messages = [HumanMessage(content="just text"), AIMessage(content="reply")]
    rebuilt, changed = mw._rehydrate_messages(messages)
    assert not changed
    assert rebuilt == messages


# --- cachePoint insertion ----------------------------------------------------


def test_cache_point_appended_to_stable_prefix(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store, enable_cache_point=True)

    messages = [
        HumanMessage(content=[{"type": "text", "text": "turn 1"}]),
        AIMessage(content=[{"type": "text", "text": "answer 1"}]),
        HumanMessage(content=[{"type": "text", "text": "turn 2 (newest)"}]),
    ]
    patched = mw._append_cache_point(messages)

    # Marker lands on the last message of the stable prefix (index len-2),
    # not the newest turn.
    marked = patched[1].content
    assert marked[-1] == {"cachePoint": {"type": "default"}}
    assert patched[2].content == messages[2].content  # newest turn untouched


def test_cache_point_noop_with_fewer_than_two_messages(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store, enable_cache_point=True)
    messages = [HumanMessage(content=[{"type": "text", "text": "only one"}])]
    assert mw._append_cache_point(messages) == messages


def test_cache_point_not_duplicated(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store, enable_cache_point=True)
    messages = [
        HumanMessage(content=[{"type": "text", "text": "a"}, {"cachePoint": {"type": "default"}}]),
        HumanMessage(content=[{"type": "text", "text": "newest"}]),
    ]
    patched = mw._append_cache_point(messages)
    markers = [b for b in patched[0].content if isinstance(b, dict) and "cachePoint" in b]
    assert len(markers) == 1


def test_cache_point_promotes_string_content_to_blocks(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store, enable_cache_point=True)
    messages = [
        HumanMessage(content="plain string prefix"),
        HumanMessage(content="newest"),
    ]
    patched = mw._append_cache_point(messages)
    blocks = patched[0].content
    assert isinstance(blocks, list)
    assert {"type": "text", "text": "plain string prefix"} in blocks
    assert {"cachePoint": {"type": "default"}} in blocks


# --- awrap_model_call integration -------------------------------------------


class _FakeRequest:
    def __init__(self, messages: list[Any]) -> None:
        self.messages = messages
        self.overridden_with: list[Any] | None = None

    def override(self, *, messages: list[Any]) -> "_FakeRequest":
        clone = _FakeRequest(messages)
        clone.overridden_with = messages
        return clone


async def test_awrap_overrides_request_when_rehydrated(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    raw = b"inference bytes"
    key = store.put(raw, content_type="image/png")
    mw = AttachmentRehydrationMiddleware(store)

    seen: dict[str, Any] = {}

    async def handler(request: _FakeRequest) -> str:
        seen["messages"] = request.messages
        return "ok"

    req = _FakeRequest([_ref_message(key)])
    result = await mw.awrap_model_call(req, handler)  # type: ignore[arg-type]

    assert result == "ok"
    block = seen["messages"][0].content[1]
    assert base64.b64decode(block["base64"]) == raw
    assert "source" not in block


async def test_awrap_passes_request_through_when_no_change(tmp_path):
    store = LocalAttachmentStore(str(tmp_path))
    mw = AttachmentRehydrationMiddleware(store)  # cache point disabled

    captured: dict[str, Any] = {}

    async def handler(request: _FakeRequest) -> str:
        captured["req"] = request
        return "ok"

    req = _FakeRequest([HumanMessage(content="no attachments here")])
    await mw.awrap_model_call(req, handler)  # type: ignore[arg-type]

    # Nothing to rehydrate and no cache point -> original request, no override.
    assert captured["req"] is req
    assert req.overridden_with is None
