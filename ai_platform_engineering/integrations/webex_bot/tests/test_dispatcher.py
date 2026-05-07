# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the Webex inbound dispatcher.

These tests are deliberately offline -- ``fetch_message`` and
``lookup_thread`` are passed as plain async callables backed by
dicts. The dispatcher's contract is "given an event + two awaitables,
produce a verdict", so an httpx transport / Mongo fake would only
add noise.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest

from webex_bot.dispatcher import (  # type: ignore[import-not-found]
    Verdict,
    dispatch_message_event,
    forward_followup,
    httpx_json_compact,
    verify_webex_signature,
    FollowUpPayload,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_message(
    *,
    msg_id: str = "msg-reply-1",
    person_id: str = "PERSON-USER",
    parent_id: str | None = "msg-task-1",
    text: str = "please retry the rollout",
    person_email: str | None = "ops@example.com",
) -> dict:
    body: dict = {
        "id": msg_id,
        "personId": person_id,
        "text": text,
    }
    if parent_id is not None:
        body["parentId"] = parent_id
    if person_email is not None:
        body["personEmail"] = person_email
    return body


def _fetch(messages: dict[str, dict]):
    """Build an async ``fetch_message`` stub backed by a dict.

    Returned coroutine function matches the dispatcher's
    ``fetch_message`` contract: ``async (id) -> dict``.
    """

    async def _impl(message_id: str) -> dict:
        return messages[message_id]

    return _impl


def _lookup(rows: dict[str, dict | None]):
    """Build an async ``lookup_thread`` stub backed by a dict.

    Returned coroutine function matches the dispatcher's
    ``lookup_thread`` contract: ``async (id) -> dict | None``.
    """

    async def _impl(parent_id: str):
        return rows.get(parent_id)

    return _impl


# ---------------------------------------------------------------------------
# Dispatcher verdicts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drops_event_authored_by_bot_via_event_personid():
    """Cheap path: event already says ``personId == bot``, so we
    short-circuit *without* calling fetch_message."""
    fetch_called = False

    async def fetch(_id: str):  # pragma: no cover - asserted not called
        nonlocal fetch_called
        fetch_called = True
        return {}

    async def lookup(_pid: str):
        return None

    event = {"data": {"id": "msg-1", "personId": "BOT"}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=fetch,
        lookup_thread=lookup,
    )

    assert result.verdict is Verdict.DROP_LOOPGUARD
    assert fetch_called is False, "loopguard pre-check must avoid fetch_message"


@pytest.mark.asyncio
async def test_drops_event_authored_by_bot_via_fetched_message():
    """Slow path: event lacks personId, fetched message's personId
    matches the bot. Still a loopguard drop."""
    msg = _make_message(person_id="BOT")
    event = {"data": {"id": msg["id"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup({}),
    )

    assert result.verdict is Verdict.DROP_LOOPGUARD


@pytest.mark.asyncio
async def test_drops_top_level_message_with_no_parent():
    msg = _make_message(parent_id=None)
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup({}),
    )

    assert result.verdict is Verdict.DROP_NOT_THREAD_REPLY


@pytest.mark.asyncio
async def test_drops_when_parent_not_in_thread_map():
    msg = _make_message(parent_id="msg-someone-else")
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup({}),  # empty map
    )

    assert result.verdict is Verdict.DROP_NO_MAPPING


@pytest.mark.asyncio
async def test_drops_when_thread_map_row_is_malformed():
    """A row missing task_id/run_id is treated as no-mapping rather
    than crashing -- protects against schema drift / dirty data."""
    msg = _make_message()
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup(
            {"msg-task-1": {"_id": "msg-task-1"}}  # missing task_id, run_id
        ),
    )

    assert result.verdict is Verdict.DROP_NO_MAPPING


@pytest.mark.asyncio
async def test_drops_when_message_text_is_empty():
    msg = _make_message(text="")
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup(
            {"msg-task-1": {"task_id": "T", "run_id": "R"}}
        ),
    )

    assert result.verdict is Verdict.DROP_NOT_THREAD_REPLY


@pytest.mark.asyncio
async def test_forwards_legitimate_followup():
    msg = _make_message(text="please retry")
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup(
            {
                "msg-task-1": {
                    "_id": "msg-task-1",
                    "task_id": "task-abc",
                    "run_id": "run-xyz",
                }
            }
        ),
    )

    assert result.verdict is Verdict.FORWARD
    assert result.payload == FollowUpPayload(
        task_id="task-abc",
        parent_run_id="run-xyz",
        user_text="please retry",
        user_ref="ops@example.com",
        transport="webex",
    )


@pytest.mark.asyncio
async def test_forward_payload_strips_whitespace_and_omits_optional_user_ref():
    msg = _make_message(text="   help   ", person_email=None)
    event = {"data": {"id": msg["id"], "personId": msg["personId"]}}

    result = await dispatch_message_event(
        event,
        bot_person_id="BOT",
        fetch_message=_fetch({msg["id"]: msg}),
        lookup_thread=_lookup(
            {"msg-task-1": {"task_id": "T", "run_id": "R"}}
        ),
    )

    assert result.verdict is Verdict.FORWARD
    assert result.payload is not None
    assert result.payload.user_text == "help"
    assert result.payload.user_ref is None
    body = result.payload.to_json()
    assert "user_ref" not in body  # optional fields omitted, not None'd


@pytest.mark.asyncio
async def test_drops_event_with_no_data_id():
    """Defensive: events without data.id should be dropped, not crash."""
    result = await dispatch_message_event(
        {"data": {}},
        bot_person_id="BOT",
        fetch_message=_fetch({}),
        lookup_thread=_lookup({}),
    )
    assert result.verdict is Verdict.DROP_NOT_THREAD_REPLY


# ---------------------------------------------------------------------------
# Webex signature verification
# ---------------------------------------------------------------------------


def _spark_sig(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha1).hexdigest()


def test_verify_webex_signature_passes_when_no_secret_configured():
    assert (
        verify_webex_signature(secret=None, body=b"{}", signature_header=None)
        is True
    )


def test_verify_webex_signature_treats_empty_string_secret_as_no_secret():
    """Regression: ``pydantic-settings`` parses ``WEBEX_WEBHOOK_SECRET=``
    (blank) as ``""`` rather than ``None``. The verifier must treat
    both the same way -- otherwise blanking the env variable to
    disable signing produces a bot that 401s every event because
    its (empty) secret never matches the (absent) header.
    """
    assert (
        verify_webex_signature(secret="", body=b"{}", signature_header=None)
        is True
    )


def test_verify_webex_signature_passes_with_valid_signature():
    body = b'{"data":{"id":"x"}}'
    sig = _spark_sig("topsecret", body)
    assert verify_webex_signature(
        secret="topsecret", body=body, signature_header=sig
    )


def test_verify_webex_signature_rejects_mismatched_signature():
    body = b'{"data":{"id":"x"}}'
    sig = _spark_sig("wrong", body)
    assert not verify_webex_signature(
        secret="topsecret", body=body, signature_header=sig
    )


def test_verify_webex_signature_rejects_missing_header_when_configured():
    assert not verify_webex_signature(
        secret="topsecret", body=b"{}", signature_header=None
    )


# ---------------------------------------------------------------------------
# Forward to /follow-up
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_forward_followup_signs_with_global_secret():
    import httpx

    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(202, json={"status": "accepted"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        resp = await forward_followup(
            FollowUpPayload(
                task_id="task-1",
                parent_run_id="run-1",
                user_text="retry",
                user_ref="ops@x.io",
            ),
            autonomous_agents_url="http://aa:8002",
            http_client=client,
            webhook_secret="hmac-secret",
        )

    assert resp.status_code == 202
    assert captured["url"] == "http://aa:8002/api/v1/hooks/task-1/follow-up"
    expected_body = httpx_json_compact(
        {
            "parent_run_id": "run-1",
            "user_text": "retry",
            "transport": "webex",
            "user_ref": "ops@x.io",
        }
    )
    assert captured["body"] == expected_body
    expected_sig = (
        "sha256="
        + hmac.new(b"hmac-secret", expected_body, hashlib.sha256).hexdigest()
    )
    assert captured["headers"]["x-hub-signature-256"] == expected_sig


@pytest.mark.asyncio
async def test_forward_followup_unsigned_when_no_secret():
    import httpx

    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        return httpx.Response(202, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        await forward_followup(
            FollowUpPayload(
                task_id="t", parent_run_id="r", user_text="x", user_ref=None
            ),
            autonomous_agents_url="http://aa:8002",
            http_client=client,
            webhook_secret=None,
        )

    assert "x-hub-signature-256" not in captured["headers"]


@pytest.mark.asyncio
async def test_forward_followup_with_timestamp_signs_ts_dot_body():
    import httpx

    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["body"] = request.content
        return httpx.Response(202, json={})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        await forward_followup(
            FollowUpPayload(
                task_id="t", parent_run_id="r", user_text="x", user_ref=None
            ),
            autonomous_agents_url="http://aa:8002",
            http_client=client,
            webhook_secret="s",
            timestamp="1700000000",
        )

    expected_signed = b"1700000000." + captured["body"]
    expected_sig = (
        "sha256="
        + hmac.new(b"s", expected_signed, hashlib.sha256).hexdigest()
    )
    assert captured["headers"]["x-hub-signature-256"] == expected_sig
    assert captured["headers"]["x-webhook-timestamp"] == "1700000000"
