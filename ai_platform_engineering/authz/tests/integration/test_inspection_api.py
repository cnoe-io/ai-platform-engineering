from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.main import create_app
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository
from ai_platform_engineering.authz.providers.base import ConditionalTuple
from ai_platform_engineering.authz.tests.conftest import FakeProvider


class PaginatedProvider(FakeProvider):
    async def read_tuples(
        self,
        *,
        user=None,
        relation=None,
        object_ref=None,
        page_size=100,
        continuation_token=None,
    ):
        del user, relation, object_ref
        offset = int(continuation_token or "0")
        page = self.tuples[offset : offset + page_size]
        next_offset = offset + len(page)
        token = str(next_offset) if next_offset < len(self.tuples) else None
        return page, token


def _app(tmp_path: Path, provider: FakeProvider):
    settings = Settings(
        grpc_bind="127.0.0.1:0",
        allow_insecure_headers=True,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
    )
    return create_app(
        settings,
        provider=provider,
        repository=InMemoryPolicyRepository(),
        outbox=AuditOutbox(settings.audit_outbox_path),
    )


def test_graph_reads_multiple_pages_and_redacts_condition_values(tmp_path: Path) -> None:
    provider = PaginatedProvider()
    provider.tuples = [
        ConditionalTuple(user=f"user:user-{index}", relation="caller", object=f"tool:tool-{index}")
        for index in range(500)
    ] + [
        ConditionalTuple(
            user="user:example-user",
            relation="conditional_caller",
            object="tool:issue_tracker/create_item",
            condition_name="string_argument_in_v1",
            condition_context={"allowed_values": ["SENSITIVE-VALUE"]},
        )
    ]

    with TestClient(_app(tmp_path, provider)) as client:
        response = client.get(
            "/v1/admin/graph?limit=501",
            headers={"authorization": "Bearer admin-example-token"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["edges"]) == 501
    assert payload["edges"][-1]["conditional"] is True
    assert payload["edges"][-1]["condition_name"] == "string_argument_in_v1"
    assert "SENSITIVE-VALUE" not in response.text


def test_inspection_requires_admin_authentication(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path, FakeProvider())) as client:
        response = client.get("/v1/admin/graph")
    assert response.status_code == 403


def test_promotion_gate_reports_explicit_blockers(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path, FakeProvider())) as client:
        response = client.post(
            "/v1/admin/promotion-gates",
            headers={"authorization": "Bearer admin-example-token"},
            json={
                "comparison_count": 10,
                "semantic_mismatches": 1,
                "provider_error_rate": 0,
                "p99_latency_ms": 20,
                "audit_backlog": 0,
                "descriptor_matches": True,
                "rollback_tested": False,
                "owner": "example-owner",
                "context_schema_matches": True,
                "audit_delivery_healthy": True,
            },
        )

    assert response.status_code == 200
    assert response.json()["ready"] is False
    assert response.json()["blockers"] == [
        "insufficient_comparison_sample",
        "semantic_mismatch",
        "rollback_not_tested",
    ]


def test_promotion_gate_requires_context_and_audit_delivery_evidence(tmp_path: Path) -> None:
    with TestClient(_app(tmp_path, FakeProvider())) as client:
        response = client.post(
            "/v1/admin/promotion-gates",
            headers={"authorization": "Bearer admin-example-token"},
            json={
                "comparison_count": 100,
                "semantic_mismatches": 0,
                "provider_error_rate": 0,
                "p99_latency_ms": 20,
                "audit_backlog": 0,
                "descriptor_matches": True,
                "rollback_tested": True,
                "owner": "example-owner",
            },
        )

    assert response.status_code == 422


def test_relationship_inspection_redacts_condition_constants(tmp_path: Path) -> None:
    provider = FakeProvider()
    provider.tuples = [
        ConditionalTuple(
            user="user:example-user",
            relation="conditional_caller",
            object="tool:issue_tracker/create_item",
            condition_name="string_argument_in_v1",
            condition_context={
                "field": "/project_key",
                "allowed_values": ["SENSITIVE-VALUE"],
            },
        )
    ]
    with TestClient(_app(tmp_path, provider)) as client:
        response = client.get(
            "/v1/admin/relationships",
            headers={"authorization": "Bearer admin-example-token"},
        )

    assert response.status_code == 200
    assert response.json()["relationships"][0]["condition"] == {
        "name": "string_argument_in_v1",
        "context_keys": ["allowed_values", "field"],
    }
    assert "SENSITIVE-VALUE" not in response.text
