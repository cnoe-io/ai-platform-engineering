from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.main import create_app
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository
from ai_platform_engineering.authz.tests.conftest import FakeProvider


def schema_body() -> dict[str, object]:
    return {
        "resource_type": "tool",
        "resource_id": "issue_tracker/create_item",
        "schema_hash": "sha256:" + "a" * 64,
        "schema": {
            "type": "object",
            "properties": {"project_key": {"type": "string"}},
        },
        "eligible_fields": [
            {"pointer": "/project_key", "type": "string", "required": True}
        ],
    }


def policy_body() -> dict[str, object]:
    return {
        "resource_type": "tool",
        "resource_id": "issue_tracker/create_item",
        "subject": {"type": "user", "id": "example-user"},
        "expression": {
            "template": "string_argument_in_v1",
            "version": "1",
            "field": "/project_key",
            "values": ["PRIMARY"],
        },
        "input_schema_sha256": "sha256:" + "a" * 64,
        "exclusive": True,
    }


def test_policy_crud_is_typed_versioned_and_reconciled(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=False)
    repository = InMemoryPolicyRepository()
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    settings = Settings(
        allow_insecure_headers=True,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        openfga_model_id="model-example",
        openfga_model_sha256="sha256:" + "b" * 64,
        schema_hashes_json='{"issue_tracker/create_item":"sha256:' + "a" * 64 + '"}',
        rollout_json=(
            '{"revision":"policy-enforce","default_mode":"LEGACY",'
            '"canary_seed":"example-canary-seed-2026","scopes":[{'
            '"surface":"agentgateway","resource_type":"tool","action":"invoke",'
            '"exact_resources":["issue_tracker/create_item"],"mode":"AUTHZ",'
            '"expression_mode":"enforce","owner":"example-owner"}]}'
        ),
    )
    headers = {"authorization": "Bearer admin-example-token"}

    with TestClient(
        create_app(settings, provider=provider, repository=repository, outbox=outbox)
    ) as client:
        schema = client.put(
            "/v1/admin/schemas/tool/issue_tracker/create_item",
            headers=headers,
            json=schema_body(),
        )
        assert schema.status_code == 200
        assert "schema" in schema.json()
        assert "schema_document" not in schema.json()

        created = client.put(
            "/v1/admin/policies/example-policy",
            headers={**headers, "if-match": "0"},
            json=policy_body(),
        )
        assert created.status_code == 200, created.text
        assert created.json()["policy"]["version"] == 1
        assert created.json()["policy"]["status"] == "ACTIVE"
        assert created.json()["effectiveness"]["exclusive"] is True
        assert provider.tuples[0].condition_name == "string_argument_in_v1"
        assert provider.tuples[0].condition_context == {
            "field": "/project_key",
            "allowed_values": ["PRIMARY"],
            "expected_schema_hash": "sha256:" + "a" * 64,
        }

        missing_version = client.put(
            "/v1/admin/policies/example-policy",
            headers=headers,
            json=policy_body(),
        )
        assert missing_version.status_code == 412

        invalid_version = client.put(
            "/v1/admin/policies/example-policy",
            headers={**headers, "if-match": "not-a-version"},
            json=policy_body(),
        )
        assert invalid_version.status_code == 400

        deleted = client.delete(
            "/v1/admin/policies/example-policy",
            headers={**headers, "if-match": '"1"'},
        )
        assert deleted.status_code == 200
        assert provider.tuples == []


def test_policy_stays_draft_without_an_enforcing_rollout_scope(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=False)
    repository = InMemoryPolicyRepository()
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    settings = Settings(
        allow_insecure_headers=True,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
    )
    headers = {"authorization": "Bearer admin-example-token"}

    with TestClient(
        create_app(settings, provider=provider, repository=repository, outbox=outbox)
    ) as client:
        assert client.put(
            "/v1/admin/schemas/tool/issue_tracker/create_item",
            headers=headers,
            json=schema_body(),
        ).status_code == 200
        response = client.put(
            "/v1/admin/policies/example-policy",
            headers={**headers, "if-match": "0"},
            json=policy_body(),
        )

    assert response.status_code == 200
    assert response.json()["policy"]["status"] == "DRAFT"
    assert response.json()["expression_mode"] == "off"
    assert provider.tuples == []
