from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from ai_platform_engineering.authz.api.envoy_proto import CheckRequest, CheckResponse, response
from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.main import create_app
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository
from ai_platform_engineering.authz.providers.openfga import OpenFgaProvider


OPENFGA_IMAGE = "openfga/openfga:v1.15.1"
SCHEMA_HASH = "sha256:" + "a" * 64
MODEL_SHA256 = "sha256:42259bb25e67cedc2b71baa8b8b2dc3d7c5db793d726ff850b699b135f8d6c81"
SERVICE_TOKEN = "internal-example-token"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def live_openfga() -> Iterator[str]:
    if os.environ.get("RUN_AUTHZ_MIGRATION_E2E") != "1":
        pytest.skip("set RUN_AUTHZ_MIGRATION_E2E=1 to run the live migration sequence")
    if shutil.which("docker") is None:
        pytest.skip("docker is required for the live migration sequence")
    port = free_port()
    name = f"caipe-authz-migration-{uuid.uuid4().hex[:12]}"
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


def load_bridge_module() -> Any:
    path = repo_root() / "deploy/openfga/bridge/authz_client.py"
    spec = importlib.util.spec_from_file_location("live_bridge_authz_client", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def conditional_tuple() -> dict[str, Any]:
    return {
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
    }


def provision(url: str) -> tuple[str, str]:
    with httpx.Client(base_url=url, timeout=10) as client:
        store = client.post("/stores", json={"name": f"migration-{uuid.uuid4().hex}"})
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
                        {
                            "user": "user:example-user",
                            "relation": "caller",
                            "object": "mcp_gateway:list",
                        },
                        conditional_tuple(),
                    ]
                },
            },
        )
        tuples.raise_for_status()
    return store_id, model_id


def tool_request(project_key: str) -> CheckRequest:
    request = CheckRequest()
    request.attributes.request.http.method = "POST"
    request.attributes.request.http.path = "/mcp/issue_tracker"
    request.attributes.request.http.raw_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "create_item", "arguments": {"project_key": project_key}},
        }
    ).encode()
    request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
        "sub"
    ].string_value = "example-user"
    return request


def tuple_snapshot(url: str, store_id: str) -> list[str]:
    response_value = httpx.post(
        f"{url}/stores/{store_id}/read",
        json={"page_size": 100},
        timeout=10,
    )
    if not response_value.is_success:
        raise AssertionError(f"OpenFGA tuple snapshot failed: {response_value.text}")
    return sorted(
        json.dumps(item["key"], sort_keys=True, separators=(",", ":"))
        for item in response_value.json()["tuples"]
    )


def test_live_full_migration_sequence_and_independent_rollbacks(
    live_openfga: str,
    tmp_path: Path,
) -> None:
    store_id, model_id = provision(live_openfga)
    grpc_port = free_port()
    settings = Settings(
        grpc_bind=f"127.0.0.1:{grpc_port}",
        openfga_url=live_openfga,
        openfga_store_id=store_id,
        openfga_model_id=model_id,
        openfga_model_sha256=MODEL_SHA256,
        service_token=SERVICE_TOKEN,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        schema_hashes_json=json.dumps({"issue_tracker/create_item": SCHEMA_HASH}),
        rollout_json=(
            '{"revision":"live-sequence","default_mode":"LEGACY",'
            '"canary_seed":"example-canary-seed-2026","scopes":[{'
            '"surface":"agentgateway","resource_type":"tool","action":"invoke",'
            '"exact_resources":["issue_tracker/create_item"],"mode":"AUTHZ",'
            '"expression_mode":"enforce","owner":"example-owner"}]}'
        ),
    )
    provider = OpenFgaProvider(
        base_url=live_openfga,
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
    bridge = load_bridge_module()
    original_tuples = tuple_snapshot(live_openfga, store_id)
    calls: list[str] = []
    comparisons: list[dict[str, Any]] = []

    with TestClient(app) as http_client:
        graph_response = http_client.get(
            "/v1/admin/graph?limit=100",
            headers={"authorization": "Bearer admin-example-token"},
        )
        assert graph_response.status_code == 200
        assert len(graph_response.json()["edges"]) == 2
        authz_client = bridge.AuthzGrpcClient(
            f"127.0.0.1:{grpc_port}",
            CheckResponse,
            service_token=SERVICE_TOKEN,
        )

        def legacy(_request: object, _context: object) -> CheckResponse:
            calls.append("legacy")
            return response(allowed=True, code=0)

        def legacy_shadow(_request: object, _context: object) -> CheckResponse:
            calls.append("legacy-shadow")
            return response(allowed=True, code=0)

        def authz(request_value: object, purpose: str, timeout_seconds: float) -> CheckResponse:
            calls.append(f"authz-{purpose}")
            return authz_client.check(request_value, purpose=purpose, timeout_seconds=timeout_seconds)

        selection = bridge.Selection(
            surface="agentgateway",
            subject="user:example-user",
            resource_type="tool",
            resource_id="issue_tracker/create_item",
            action="invoke",
            correlation_id="live-sequence",
        )

        def run_phase(name: str, mode: str, project_key: str) -> tuple[int, list[str]]:
            calls.clear()
            scope = ()
            default_mode = mode
            if mode == "CANARY":
                default_mode = "LEGACY"
                scope = (
                    bridge.Scope(
                        surface="agentgateway",
                        resource_type="tool",
                        action="invoke",
                        mode="CANARY",
                        exact_resources=("issue_tracker/create_item",),
                        canary_percent=100,
                    ),
                )
            router = bridge.MigrationRouter(
                legacy=legacy,
                legacy_shadow=legacy_shadow,
                authz=authz,
                select=lambda _request: selection,
                unavailable=lambda: response(allowed=False, code=14),
                compare=lambda **event: comparisons.append(event),
                rollout=bridge.Rollout(
                    name,
                    default_mode,
                    "example-canary-seed-2026",
                    1000,
                    scope,
                ),
            )
            try:
                code = router.Check(tool_request(project_key), None).status.code
            finally:
                router.close()
            return code, list(calls)

        try:
            assert run_phase("legacy-1", "LEGACY", "OTHER") == (0, ["legacy"])
            assert run_phase("shadow-2", "SHADOW", "OTHER")[0] == 0
            assert run_phase("canary-3", "CANARY", "PRIMARY")[0] == 0
            assert run_phase("authz-4", "AUTHZ", "OTHER")[0] == 7
            authz_only_code, authz_only_calls = run_phase("authz-only-5", "AUTHZ_ONLY", "PRIMARY")
            assert authz_only_code == 0
            assert authz_only_calls == ["authz-authoritative"]
            assert tuple_snapshot(live_openfga, store_id) == original_tuples

            routing_rollback_code, routing_rollback_calls = run_phase(
                "routing-rollback-6",
                "SHADOW",
                "OTHER",
            )
            assert routing_rollback_code == 0
            assert routing_rollback_calls[0] == "legacy"
            assert tuple_snapshot(live_openfga, store_id) == original_tuples

            deleted = httpx.post(
                f"{live_openfga}/stores/{store_id}/write",
                json={
                    "authorization_model_id": model_id,
                    "deletes": {"tuple_keys": [conditional_tuple()]},
                },
                timeout=10,
            )
            deleted.raise_for_status()
            assert run_phase("policy-rollback-7", "AUTHZ", "PRIMARY")[0] == 7
            remaining = tuple_snapshot(live_openfga, store_id)
            assert all("conditional_caller" not in item for item in remaining)
            remaining_keys = [json.loads(item) for item in remaining]
            assert not any(
                item.get("relation") == "caller" and str(item.get("object", "")).startswith("tool:")
                for item in remaining_keys
            )
        finally:
            authz_client.close()
