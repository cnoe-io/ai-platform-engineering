from __future__ import annotations

import httpx
import pytest

from ai_platform_engineering.authz.audit.events import AuthzAuditEvent
from ai_platform_engineering.authz.audit.outbox import AuditOutbox, AuditOutboxFull
from ai_platform_engineering.authz.audit.publisher import AuditPublisher


def event(event_id: str) -> AuthzAuditEvent:
    return AuthzAuditEvent(
        event_id=event_id,
        event_type="authz_migration_revision",
        correlation_id="correlation-1",
        payload={"rollout_revision": "revision-1"},
    )


@pytest.mark.asyncio
async def test_outbox_is_bounded_durable_and_idempotent(tmp_path) -> None:
    path = str(tmp_path / "audit.db")
    outbox = AuditOutbox(path, capacity=1)
    await outbox.initialize()
    await outbox.append(event("event-1"))
    await outbox.append(event("event-1"))
    assert await outbox.size() == 1

    with pytest.raises(AuditOutboxFull):
        await outbox.append(event("event-2"))

    recovered = AuditOutbox(path, capacity=1)
    await recovered.initialize()
    assert [item.event_id for item in await recovered.batch(10)] == ["event-1"]


@pytest.mark.asyncio
async def test_publisher_retries_without_acknowledging_then_recovers(tmp_path) -> None:
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    await outbox.initialize()
    await outbox.append(event("event-1"))
    attempts = 0

    def handle(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(503 if attempts == 1 else 202, json={"accepted": 1, "queued": 1})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    publisher = AuditPublisher(
        outbox,
        audit_service_url="http://audit-service.example.test",
        client=client,
    )
    assert await publisher.publish_once() == 0
    assert await outbox.size() == 1
    assert outbox.snapshot_sync()[0]["attempts"] == 1

    assert await publisher.publish_once() == 1
    assert await outbox.size() == 0
    await client.aclose()
