from __future__ import annotations

from fastapi.testclient import TestClient

from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.main import create_app
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository


def test_http_single_and_batch_share_canonical_engine(
    fake_provider,
    settings,
) -> None:
    app = create_app(
        settings,
        provider=fake_provider,
        repository=InMemoryPolicyRepository(),
        outbox=AuditOutbox(settings.audit_outbox_path),
    )
    headers = {"x-caipe-subject-type": "user", "x-caipe-subject-id": "example-user"}
    with TestClient(app) as client:
        single = client.post(
            "/v1/decisions",
            headers=headers,
            json={
                "action": "read",
                "resource": {"type": "agent", "id": "primary"},
                "surface": "bff",
            },
        )
        batch = client.post(
            "/v1/decisions:batch",
            headers=headers,
            json={
                "surface": "bff",
                "items": [
                    {
                        "item_id": "item-1",
                        "action": "read",
                        "resource": {"type": "agent", "id": "primary"},
                    }
                ],
            },
        )
    assert single.status_code == 200
    assert single.json()["allowed"] is True
    assert batch.status_code == 200
    assert batch.json()["items"][0]["result"]["allowed"] is True


def test_http_rejects_untrusted_provider_and_subject_override(fake_provider, settings) -> None:
    app = create_app(
        settings,
        provider=fake_provider,
        repository=InMemoryPolicyRepository(),
        outbox=AuditOutbox(settings.audit_outbox_path),
    )
    with TestClient(app) as client:
        response = client.post(
            "/v1/decisions",
            headers={"x-caipe-subject-type": "user", "x-caipe-subject-id": "example-user"},
            json={
                "action": "read",
                "resource": {"type": "agent", "id": "primary"},
                "provider": "cedar",
            },
        )
    assert response.status_code == 422
