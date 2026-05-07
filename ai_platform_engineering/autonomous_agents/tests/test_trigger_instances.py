# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ``services.trigger_instances``.

Covers the dedup-key derivation precedence (header > signature > none)
and the Mongo-backed claim flow (new insert vs duplicate). The route
integration is exercised separately in ``test_webhooks.py`` -- this
module focuses on the helper layer in isolation so changes to the
precedence rules don't have to thread through the FastAPI test client.
"""

from __future__ import annotations

from typing import Any

import pytest

from autonomous_agents.models import (
    TaskDefinition,
    WebhookTrigger,
)
from autonomous_agents.services.trigger_instances import (
    DedupKey,
    claim_trigger_instance,
    derive_dedup_key,
)


def _make_task(
    task_id: str = "wh-1",
    *,
    secret: str | None = None,
    dedup_header: str | None = None,
) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webhook task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(secret=secret, dedup_header=dedup_header),
    )


# ---------------------------------------------------------------------------
# derive_dedup_key
# ---------------------------------------------------------------------------


def test_header_strategy_used_when_configured_and_present():
    """Configured ``dedup_header`` + present in request -> wins outright.

    Even when a signature is also present, the header is the more
    reliable per-delivery identifier and takes precedence.
    """
    task = _make_task(secret="s", dedup_header="X-GitHub-Delivery")
    headers = {"X-GitHub-Delivery": "abc-123", "X-Other": "ignored"}

    result = derive_dedup_key(
        task=task,
        headers=headers,
        verified_signature="sha256=somehexvalue",
    )

    assert result.strategy == "header"
    assert result.key == "wh-1:hdr:abc-123"
    assert result.header_name == "X-GitHub-Delivery"
    assert result.header_value == "abc-123"


def test_header_strategy_is_case_insensitive():
    """HTTP headers are case-insensitive; lookup must match real-world
    sender quirks (e.g. ``x-github-delivery`` vs ``X-GitHub-Delivery``)."""
    task = _make_task(dedup_header="X-GitHub-Delivery")
    # Sender uses lowercase.
    headers = {"x-github-delivery": "lower-cased-id"}

    result = derive_dedup_key(
        task=task, headers=headers, verified_signature=None
    )

    assert result.strategy == "header"
    assert result.key == "wh-1:hdr:lower-cased-id"


def test_header_configured_but_missing_falls_back_to_signature():
    """Header configured + absent on this request -> use the verified
    HMAC signature instead. Operator gets a logged warning but the
    request is not rejected -- well-signed retries still dedup."""
    task = _make_task(secret="s", dedup_header="X-GitHub-Delivery")
    headers: dict[str, str] = {}

    result = derive_dedup_key(
        task=task,
        headers=headers,
        verified_signature="sha256=deadbeefcafe",
    )

    assert result.strategy == "signature"
    assert result.key == "wh-1:sig:deadbeefcafe"
    # Signature strategy doesn't carry header metadata -- stays None
    # so the audit row reflects "we used the signature, not the header".
    assert result.header_name is None
    assert result.header_value is None


def test_signature_strategy_when_no_dedup_header_configured():
    """No ``dedup_header`` set on the trigger and the request was
    HMAC-signed -> sig strategy. This is the most common path for
    operators who set up HMAC but don't bother configuring a custom
    delivery header."""
    task = _make_task(secret="s")
    result = derive_dedup_key(
        task=task,
        headers={},
        verified_signature="sha256=abc123",
    )

    assert result.strategy == "signature"
    assert result.key == "wh-1:sig:abc123"


def test_signature_strategy_strips_unknown_prefix_gracefully():
    """Future signature schemes (``sha512=``, plain hex, etc.) must not
    mangle the dedup key. Only the recognised prefixes are stripped;
    anything else is incorporated verbatim."""
    task = _make_task(secret="s")

    # Recognised prefix is stripped.
    r1 = derive_dedup_key(
        task=task, headers={}, verified_signature="sha512=longerhex"
    )
    assert r1.key == "wh-1:sig:longerhex"

    # Unknown prefix is kept (defensive; better to over-specify than
    # to silently strip something the operator didn't intend).
    r2 = derive_dedup_key(
        task=task, headers={}, verified_signature="md5=oldhex"
    )
    assert r2.key == "wh-1:sig:md5=oldhex"


def test_no_strategy_available_returns_none_key():
    """No header configured AND no signature -> dedup is impossible.

    Helper returns ``key=None`` and ``strategy='none'`` so the route can
    branch cleanly: skip the claim, fire the task without protection
    against duplicate deliveries."""
    task = _make_task()  # no secret, no dedup_header
    result = derive_dedup_key(
        task=task, headers={}, verified_signature=None
    )

    assert result.key is None
    assert result.strategy == "none"


# ---------------------------------------------------------------------------
# claim_trigger_instance
# ---------------------------------------------------------------------------


class _FakeMongo:
    """Tiny stand-in mirroring ``MongoService.record_trigger_instance``."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    async def record_trigger_instance(
        self, doc: dict[str, Any]
    ) -> tuple[bool, dict[str, Any] | None]:
        existing = self.rows.get(doc["_id"])
        if existing is not None:
            return False, existing
        self.rows[doc["_id"]] = dict(doc)
        return True, None


async def test_claim_trigger_instance_inserts_new_row():
    mongo = _FakeMongo()
    dedup = DedupKey(
        key="wh-1:hdr:abc",
        strategy="header",
        header_name="X-GitHub-Delivery",
        header_value="abc",
    )

    result = await claim_trigger_instance(
        mongo, task_id="wh-1", dedup_key=dedup, body=b'{"hi":1}'
    )

    assert result.claimed is True
    assert result.existing_run_id is None
    assert result.dedup_key == "wh-1:hdr:abc"
    assert result.strategy == "header"

    row = mongo.rows["wh-1:hdr:abc"]
    assert row["task_id"] == "wh-1"
    assert row["dedup_strategy"] == "header"
    assert row["delivery_header_name"] == "X-GitHub-Delivery"
    assert row["delivery_header_value"] == "abc"
    assert row["body_size_bytes"] == len(b'{"hi":1}')
    # body_sha256 is recorded for forensics, not for dedup -- just
    # confirm it's present and a hex string of the right length.
    assert isinstance(row["body_sha256"], str)
    assert len(row["body_sha256"]) == 64
    # run_id is None until the route attaches it after spawning the
    # background task.
    assert row["run_id"] is None


async def test_claim_trigger_instance_reports_duplicate_with_existing_run_id():
    mongo = _FakeMongo()
    dedup = DedupKey(key="wh-1:sig:hex", strategy="signature")

    # First claim succeeds and the route would normally attach a run id.
    first = await claim_trigger_instance(
        mongo, task_id="wh-1", dedup_key=dedup, body=b"x"
    )
    assert first.claimed is True
    mongo.rows["wh-1:sig:hex"]["run_id"] = "run-abc"

    # Second claim with the same key surfaces the existing row's run_id.
    second = await claim_trigger_instance(
        mongo, task_id="wh-1", dedup_key=dedup, body=b"x"
    )
    assert second.claimed is False
    assert second.existing_run_id == "run-abc"
    assert second.dedup_key == "wh-1:sig:hex"
    assert second.strategy == "signature"


async def test_claim_trigger_instance_rejects_none_key():
    """Misuse guard: callers MUST short-circuit when the key is None;
    inserting a row with no ``_id`` would corrupt the collection."""
    mongo = _FakeMongo()
    dedup = DedupKey(key=None, strategy="none")

    with pytest.raises(ValueError, match="no dedup key"):
        await claim_trigger_instance(
            mongo, task_id="wh-1", dedup_key=dedup, body=b""
        )
