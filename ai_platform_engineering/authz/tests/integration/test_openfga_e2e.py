from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import grpc
import httpx
import pytest
from fastapi.testclient import TestClient

from ai_platform_engineering.authz.api.envoy_proto import CheckRequest, CheckResponse
from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.main import create_app
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository
from ai_platform_engineering.authz.providers.openfga import (
    OpenFgaProvider,
    canonical_model_sha256,
)

OPENFGA_IMAGE = "openfga/openfga:v1.15.1"
SCHEMA_HASH = "sha256:" + "a" * 64
SERVICE_TOKEN = "internal-example-token"
MODEL_SHA256 = "sha256:42259bb25e67cedc2b71baa8b8b2dc3d7c5db793d726ff850b699b135f8d6c81"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def real_openfga() -> Iterator[str]:
    if os.environ.get("RUN_OPENFGA_E2E") != "1":
        pytest.skip("set RUN_OPENFGA_E2E=1 to run the real OpenFGA test")
    if shutil.which("docker") is None:
        pytest.skip("docker is required for the real OpenFGA test")
    port = free_port()
    name = f"caipe-authz-service-e2e-{uuid.uuid4().hex[:12]}"
    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--name",
            name,
            "--publish",
            f"127.0.0.1:{port}:8080",
            OPENFGA_IMAGE,
            "run",
            "--datastore-engine",
            "memory",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"{url}/healthz", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                # OpenFGA may refuse connections while its listener is starting.
                pass
            time.sleep(0.25)
        else:
            pytest.fail("OpenFGA did not become healthy")
        yield url
    finally:
        subprocess.run(
            ["docker", "rm", "--force", name],
            check=False,
            capture_output=True,
            text=True,
        )


def provision(url: str) -> tuple[str, str]:
    client = httpx.Client(base_url=url, timeout=10)
    store = client.post("/stores", json={"name": f"service-e2e-{uuid.uuid4().hex}"})
    store.raise_for_status()
    store_id = store.json()["id"]
    model = json.loads(
        (repo_root() / "charts/ai-platform-engineering/charts/openfga/authorization-model.json").read_text()
    )
    written = client.post(f"/stores/{store_id}/authorization-models", json=model)
    written.raise_for_status()
    model_id = written.json()["authorization_model_id"]
    tuples = client.post(
        f"/stores/{store_id}/write",
        json={
            "authorization_model_id": model_id,
            "writes": {
                "tuple_keys": [
                    {"user": "user:example-user", "relation": "caller", "object": "mcp_gateway:list"},
                    {
                        "user": "user:example-user",
                        "relation": "conditional_caller",
                        "object": "tool:issue_tracker/create_item",
                        "condition": {
                            "name": "string_argument_in_v1",
                            "context": {
                                "field": "/project_key",
                                "allowed_values": ["PRIMARY"],
                                "expected_schema_hash": SCHEMA_HASH,
                            },
                        },
                    },
                ]
            },
        },
    )
    tuples.raise_for_status()
    client.close()
    return store_id, model_id


def grpc_request(project_key: str) -> CheckRequest:
    request = CheckRequest()
    request.attributes.request.http.method = "POST"
    request.attributes.request.http.path = "/mcp/issue_tracker"
    request.attributes.request.http.raw_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": "create_item", "arguments": {"project_key": project_key}},
        }
    ).encode()
    request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
        "sub"
    ].string_value = "example-user"
    return request


def test_http_and_envoy_grpc_share_real_openfga_condition_pipeline(
    real_openfga: str,
    tmp_path: Path,
) -> None:
    store_id, model_id = provision(real_openfga)
    grpc_port = free_port()
    settings = Settings(
        grpc_bind=f"127.0.0.1:{grpc_port}",
        openfga_url=real_openfga,
        openfga_store_id=store_id,
        openfga_model_id=model_id,
        openfga_model_sha256=MODEL_SHA256,
        service_token=SERVICE_TOKEN,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        schema_hashes_json=json.dumps({"issue_tracker/create_item": SCHEMA_HASH}),
        rollout_json=(
            '{"revision":"e2e-enforce","default_mode":"LEGACY",'
            '"canary_seed":"example-canary-seed-2026","scopes":[{'
            '"surface":"agentgateway","resource_type":"tool","action":"invoke",'
            '"exact_resources":["issue_tracker/create_item"],"mode":"AUTHZ",'
            '"expression_mode":"enforce","owner":"example-owner"}]}'
        ),
    )
    provider = OpenFgaProvider(
        base_url=real_openfga,
        store_name="unused",
        store_id=store_id,
        authorization_model_id=model_id,
        expected_model_sha256=MODEL_SHA256,
    )
    app = create_app(
        settings,
        provider=provider,
        repository=InMemoryPolicyRepository(),
        outbox=AuditOutbox(settings.audit_outbox_path),
    )
    assert provider.expected_model_sha256 == MODEL_SHA256
    headers = {
        "authorization": f"Bearer {SERVICE_TOKEN}",
        "x-caipe-subject-type": "user",
        "x-caipe-subject-id": "example-user",
    }
    with TestClient(app) as client:
        ready = client.get("/readyz")
        model_response = client.get(
            "/v1/admin/model",
            headers={"authorization": "Bearer admin-example-token"},
        )
        actual_model_sha = canonical_model_sha256(model_response.json())
        allow = client.post(
            "/v1/decisions",
            headers=headers,
            json={
                "surface": "bff",
                "action": "invoke",
                "resource": {"type": "tool", "id": "issue_tracker/create_item"},
                "context": {
                    "request": {"arguments": {"project_key": "PRIMARY"}},
                    "resource": {"schema_hash": SCHEMA_HASH},
                },
            },
        )
        deny = client.post(
            "/v1/decisions",
            headers=headers,
            json={
                "surface": "bff",
                "action": "invoke",
                "resource": {"type": "tool", "id": "issue_tracker/create_item"},
                "context": {
                    "request": {"arguments": {"project_key": "OTHER"}},
                    "resource": {"schema_hash": SCHEMA_HASH},
                },
            },
        )
        channel = grpc.insecure_channel(f"127.0.0.1:{grpc_port}")
        grpc.channel_ready_future(channel).result(timeout=5)
        check = channel.unary_unary(
            "/envoy.service.auth.v3.Authorization/Check",
            request_serializer=lambda value: value.SerializeToString(),
            response_deserializer=CheckResponse.FromString,
        )
        grpc_allow = check(
            grpc_request("PRIMARY"),
            timeout=5,
            metadata=(("authorization", f"Bearer {SERVICE_TOKEN}"),),
        )
        grpc_deny = check(
            grpc_request("OTHER"),
            timeout=5,
            metadata=(("authorization", f"Bearer {SERVICE_TOKEN}"),),
        )
        channel.close()
        admin_headers = {"authorization": "Bearer admin-example-token"}
        schema = client.put(
            "/v1/admin/schemas/tool/issue_tracker/create_item",
            headers=admin_headers,
            json={
                "resource_type": "tool",
                "resource_id": "issue_tracker/create_item",
                "schema_hash": SCHEMA_HASH,
                "schema": {
                    "type": "object",
                    "properties": {"project_key": {"type": "string"}},
                },
                "eligible_fields": [
                    {"pointer": "/project_key", "type": "string", "required": True}
                ],
            },
        )
        policy_body = {
            "resource_type": "tool",
            "resource_id": "issue_tracker/create_item",
            "subject": {"type": "user", "id": "example-user"},
            "expression": {
                "template": "string_argument_in_v1",
                "version": "1",
                "field": "/project_key",
                "values": ["PRIMARY"],
            },
            "input_schema_sha256": SCHEMA_HASH,
            "exclusive": True,
        }
        policy = client.put(
            "/v1/admin/policies/e2e-policy",
            headers={**admin_headers, "if-match": "0"},
            json=policy_body,
        )
        deleted = client.delete(
            "/v1/admin/policies/e2e-policy",
            headers={**admin_headers, "if-match": "1"},
        )

    assert ready.status_code == 200, actual_model_sha
    assert allow.status_code == 200 and allow.json()["allowed"] is True
    assert deny.status_code == 200 and deny.json()["allowed"] is False
    assert grpc_allow.status.code == 0
    assert grpc_deny.status.code == 7
    assert schema.status_code == 200
    assert policy.status_code == 200, policy.text
    assert policy.json()["policy"]["status"] == "ACTIVE"
    assert deleted.status_code == 200, deleted.text
