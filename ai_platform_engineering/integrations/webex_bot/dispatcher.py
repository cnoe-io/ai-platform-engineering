# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Decide what to do with an incoming Webex ``messages.created`` event.

The dispatcher is the only piece of business logic in the bridge.
Everything else (HTTP routing, signature checks, Mongo lookups,
Webex API calls) lives in modules whose contracts are obvious. The
dispatcher takes a verified, fetched message and returns a verdict:

* ``DROP_LOOPGUARD`` -- the message was authored by the bot itself.
* ``DROP_NOT_THREAD_REPLY`` -- the message has no ``parentId``, so
  it isn't a reply to anything we'd routed.
* ``DROP_NO_MAPPING`` -- ``parentId`` isn't in our thread map; the
  bot didn't post the parent so this isn't our reply.
* ``FORWARD`` -- forward as a follow-up to the autonomous-agents
  service.

We also record the resolved follow-up payload so the caller can fire
the HTTP request without recomputing anything.
"""

from __future__ import annotations

import enum
import hashlib
import hmac
import json
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

import httpx


logger = logging.getLogger(__name__)


class Verdict(str, enum.Enum):
    DROP_LOOPGUARD = "drop_loopguard"
    DROP_NOT_THREAD_REPLY = "drop_not_thread_reply"
    DROP_NO_MAPPING = "drop_no_mapping"
    FORWARD = "forward"


@dataclass(frozen=True, slots=True)
class FollowUpPayload:
    """The body the bridge will POST to ``/api/v1/hooks/<task_id>/follow-up``."""

    task_id: str
    parent_run_id: str
    user_text: str
    user_ref: str | None
    transport: str = "webex"

    def to_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "parent_run_id": self.parent_run_id,
            "user_text": self.user_text,
            "transport": self.transport,
        }
        if self.user_ref:
            body["user_ref"] = self.user_ref
        return body


@dataclass(frozen=True, slots=True)
class DispatchResult:
    verdict: Verdict
    payload: FollowUpPayload | None = None
    reason: str | None = None  # human-readable detail for logs / responses


# A ``ThreadLookup`` is anything that takes a Webex parent message id
# and returns ``{"task_id": ..., "run_id": ...}`` (or None). We type
# it loosely so production code can pass a Motor-backed lookup and
# tests can pass a dict-backed one without subclassing.
ThreadLookup = Callable[[str], Awaitable[Mapping[str, Any] | None]]


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def verify_webex_signature(
    *, secret: str | None, body: bytes, signature_header: str | None
) -> bool:
    """Validate Webex's ``X-Spark-Signature`` header.

    Webex signs the raw request body with HMAC-SHA1 and the secret
    configured at webhook creation, then sends the lowercase hex
    digest as ``X-Spark-Signature`` (no ``sha1=`` prefix).

    Returns True if no secret is configured (signing is opt-in on
    the Webex side -- some operators ship the bridge unsigned in
    dev). Returns False on missing / mismatched headers when a
    secret IS configured.

    Note: ``pydantic-settings`` deserialises an empty ``.env`` value
    (e.g. ``WEBEX_WEBHOOK_SECRET=``) as ``""``, not ``None``. Treat
    both as "no secret" so dev operators who blank the variable to
    disable signing don't accidentally end up with a bot that 401s
    every event because the empty-string secret still triggers the
    "must verify" branch.
    """
    if not secret:
        return True
    if not signature_header:
        return False
    expected = hmac.new(
        secret.encode("utf-8"), body, hashlib.sha1
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header.lower())


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


async def dispatch_message_event(
    event: Mapping[str, Any],
    *,
    bot_person_id: str,
    fetch_message: Callable[[str], Awaitable[Mapping[str, Any]]],
    lookup_thread: ThreadLookup,
) -> DispatchResult:
    """Decide what to do with a Webex ``messages.created`` event.

    Args:
        event: the raw JSON Webex POSTs to ``/webex/events``. Must
            include ``data.id`` (the new message id) and ideally
            ``data.personId`` (so we can short-circuit the bot's own
            posts without fetching the message body, saving a Webex
            API round-trip on the common case).
        bot_person_id: the bot's own ``personId`` -- compared against
            the event's authoring person to short-circuit feedback
            loops.
        fetch_message: ``async (message_id) -> dict`` -- typically
            :meth:`WebexClient.get_message`. Injected so tests don't
            need to fake an httpx transport.
        lookup_thread: ``async (parent_message_id) -> dict | None`` --
            queries the Mongo ``webex_thread_map`` collection. Returns
            None when no autonomous task posted that parent.

    Returns:
        A :class:`DispatchResult` whose ``verdict`` is one of:

        * DROP_LOOPGUARD -- bot's own post. Common: a task just
          posted via ``post_message`` and Webex echoed it back.
        * DROP_NOT_THREAD_REPLY -- a top-level message in a room
          the bot is in. We don't route those (would require per-
          room task config; out of scope for this bridge).
        * DROP_NO_MAPPING -- a real reply, but to a message no
          autonomous task posted (e.g. someone else's announcement).
        * FORWARD -- legitimate operator follow-up; ``payload`` is
          set and ready to POST.
    """
    data = event.get("data") or {}
    message_id = data.get("id")
    if not message_id:
        # Webex never sends this in practice; defensive log + drop.
        return DispatchResult(
            verdict=Verdict.DROP_NOT_THREAD_REPLY,
            reason="event has no data.id",
        )

    # Cheap pre-check: if the event already tells us the author is
    # the bot, drop without paying for the fetch_message round-trip.
    event_person_id = data.get("personId")
    if event_person_id and event_person_id == bot_person_id:
        return DispatchResult(
            verdict=Verdict.DROP_LOOPGUARD,
            reason="event personId matches bot",
        )

    message = await fetch_message(message_id)

    # Authoritative loop guard: even if the event lacked personId,
    # the fetched message always has it.
    if message.get("personId") == bot_person_id:
        return DispatchResult(
            verdict=Verdict.DROP_LOOPGUARD,
            reason="message personId matches bot",
        )

    parent_id = message.get("parentId")
    if not parent_id:
        return DispatchResult(
            verdict=Verdict.DROP_NOT_THREAD_REPLY,
            reason="message has no parentId",
        )

    mapping = await lookup_thread(parent_id)
    if mapping is None:
        return DispatchResult(
            verdict=Verdict.DROP_NO_MAPPING,
            reason=f"parentId {parent_id} not in thread map",
        )

    # The thread map row is canonical -- it tells us which task and
    # which run this reply belongs to. If a row somehow lacks one of
    # the two ids (corrupted by an ops query, schema drift, ...) we
    # treat it as "not in the map" rather than crash the dispatcher.
    task_id = mapping.get("task_id")
    parent_run_id = mapping.get("run_id")
    if not task_id or not parent_run_id:
        logger.warning(
            "Thread map row for parentId=%s is missing task_id/run_id "
            "(have: %s); treating as no mapping",
            parent_id,
            sorted(mapping.keys()),
        )
        return DispatchResult(
            verdict=Verdict.DROP_NO_MAPPING,
            reason=f"thread map row for {parent_id} is malformed",
        )

    user_text = (message.get("text") or message.get("markdown") or "").strip()
    if not user_text:
        # Webex strips leading @mentions from ``text`` for you, so
        # an empty body usually means the user sent only a card or
        # a file with no caption. Nothing useful to forward.
        return DispatchResult(
            verdict=Verdict.DROP_NOT_THREAD_REPLY,
            reason="message has no text body",
        )

    return DispatchResult(
        verdict=Verdict.FORWARD,
        payload=FollowUpPayload(
            task_id=task_id,
            parent_run_id=parent_run_id,
            user_text=user_text,
            user_ref=message.get("personEmail"),
        ),
    )


# ---------------------------------------------------------------------------
# Forwarder -- HTTP call to the autonomous-agents follow-up route
# ---------------------------------------------------------------------------


def httpx_json_compact(payload: Mapping[str, Any]) -> bytes:
    """Compact, deterministic JSON encoding for HMAC signing.

    Using ``json.dumps`` with sorted keys + no whitespace makes the
    signature reproducible regardless of dict ordering on either side.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


async def forward_followup(
    payload: FollowUpPayload,
    *,
    autonomous_agents_url: str,
    http_client: httpx.AsyncClient,
    webhook_secret: str | None = None,
    timestamp: str | None = None,
) -> httpx.Response:
    """POST a follow-up payload to ``/api/v1/hooks/<task_id>/follow-up``.

    Signs the body with the *global* ``WEBHOOK_SECRET`` when configured
    (same HMAC-SHA256 scheme the autonomous-agents service expects on
    the original-fire path -- see ``_expected_signature`` there). The
    bridge cannot use per-task ``trigger.secret`` values because it
    isn't part of the task-creation flow; operators who want signed
    follow-ups should configure a service-wide ``WEBHOOK_SECRET`` on
    *both* sides.

    When ``timestamp`` is set, the signed body is ``f"{ts}.{body}"``
    and the timestamp is sent as ``X-Webhook-Timestamp``. This must
    match the receiver's replay window (default 300s).

    Returns the raw httpx.Response so the caller can decide what to
    do with non-2xx (we deliberately don't ``raise_for_status`` here
    -- the bridge logs and moves on; we don't want a transient
    5xx-on-the-receiver to take the bridge down).
    """
    body = httpx_json_compact(payload.to_json())
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if webhook_secret:
        signed = (
            timestamp.encode("utf-8") + b"." + body if timestamp else body
        )
        digest = hmac.new(
            webhook_secret.encode("utf-8"), signed, hashlib.sha256
        ).hexdigest()
        headers["X-Hub-Signature-256"] = f"sha256={digest}"
        if timestamp:
            headers["X-Webhook-Timestamp"] = timestamp

    url = (
        f"{str(autonomous_agents_url).rstrip('/')}"
        f"/api/v1/hooks/{payload.task_id}/follow-up"
    )
    return await http_client.post(url, content=body, headers=headers)
