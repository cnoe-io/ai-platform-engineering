import concurrent.futures
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import grpc
import httpx
import pytest


OPENFGA_IMAGE = "openfga/openfga:v1.15.1"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _load_bridge_module() -> ModuleType:
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location("openfga_bridge_conditions_e2e", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def openfga_url() -> Iterator[str]:
    if os.environ.get("RUN_OPENFGA_E2E") != "1":
        pytest.skip("set RUN_OPENFGA_E2E=1 to run the real OpenFGA test")
    if shutil.which("docker") is None:
        pytest.skip("docker is required for the real OpenFGA test")

    port = _free_port()
    container_name = f"caipe-authz-e2e-{uuid.uuid4().hex[:12]}"
    subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--name",
            container_name,
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
            logs = subprocess.run(
                ["docker", "logs", container_name],
                check=False,
                capture_output=True,
                text=True,
            ).stdout
            pytest.fail(f"OpenFGA did not become healthy: {logs}")
        yield url
    finally:
        subprocess.run(
            ["docker", "rm", "--force", container_name],
            check=False,
            capture_output=True,
            text=True,
        )


def _create_store_model_and_tuples(openfga_url: str) -> tuple[str, str]:
    client = httpx.Client(base_url=openfga_url, timeout=10)
    store_response = client.post("/stores", json={"name": f"conditional-e2e-{uuid.uuid4().hex}"})
    store_response.raise_for_status()
    store_id = store_response.json()["id"]

    model = json.loads(
        (
            _repo_root()
            / "charts/ai-platform-engineering/charts/openfga/authorization-model.json"
        ).read_text()
    )
    model_response = client.post(f"/stores/{store_id}/authorization-models", json=model)
    model_response.raise_for_status()
    model_id = model_response.json()["authorization_model_id"]

    write_response = client.post(
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
                    {
                        "user": "user:example-user",
                        "relation": "conditional_caller",
                        "object": "tool:issue_tracker/create_item",
                        "condition": {
                            "name": "string_argument_in_v1",
                            "context": {
                                "field": "/project_key",
                                "allowed_values": ["PRIMARY", "SECONDARY"],
                                "expected_schema_hash": "sha256:example-schema",
                            },
                        },
                    },
                    {
                        "user": "user:example-user",
                        "relation": "caller",
                        "object": "tool:issue_tracker/get_item",
                    },
                ]
            },
        },
    )
    write_response.raise_for_status()
    return store_id, model_id


def _tool_request(
    bridge: Any,
    arguments: dict[str, object],
    *,
    name: str = "create_item",
) -> Any:
    context_header, signature = bridge.build_agent_context_header(
        "local-example",
        secret="test-secret",
        kind=bridge.AGENT_CONTEXT_KIND_LOCAL,
    )
    return bridge.build_check_request(
        headers={
            "x-caipe-agent-context": context_header,
            "x-caipe-agent-context-signature": signature,
        },
        path="/mcp/issue_tracker",
        method="POST",
        metadata_subject="example-user",
        body=json.dumps(
            {
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
        ),
    )


def test_ext_authz_bridge_enforces_openfga_native_condition_e2e(
    openfga_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = _load_bridge_module()
    store_id, model_id = _create_store_model_and_tuples(openfga_url)
    monkeypatch.setattr(bridge, "OPENFGA_HTTP", openfga_url)
    monkeypatch.setattr(bridge, "STORE_ID", store_id)
    monkeypatch.setattr(bridge, "OPENFGA_AUTHORIZATION_MODEL_ID", model_id)
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", True)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(
        bridge,
        "TOOL_SCHEMA_HASHES",
        {
            "issue_tracker/create_item": "sha256:example-schema",
            "issue_tracker/get_item": "sha256:example-schema",
        },
    )
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)

    server = grpc.server(concurrent.futures.ThreadPoolExecutor(max_workers=2))
    bridge._add_authorization_service(server)
    bridge_port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    channel = grpc.insecure_channel(f"127.0.0.1:{bridge_port}")
    check = channel.unary_unary(
        "/envoy.service.auth.v3.Authorization/Check",
        request_serializer=lambda request: request.SerializeToString(),
        response_deserializer=bridge.CheckResponse.FromString,
    )
    try:
        legacy_unconditional = check(
            _tool_request(bridge, {}, name="get_item"),
            timeout=5,
        )
        matching = check(_tool_request(bridge, {"project_key": "PRIMARY"}), timeout=5)
        non_matching = check(_tool_request(bridge, {"project_key": "OTHER"}), timeout=5)
        missing = check(_tool_request(bridge, {}), timeout=5)
        wrong_type = check(_tool_request(bridge, {"project_key": 1}), timeout=5)
        monkeypatch.setattr(bridge, "TOOL_POLICY_MAX_CONTEXT_BYTES", 64)
        legacy_oversized = check(
            _tool_request(bridge, {"note": "x" * 256}, name="get_item"),
            timeout=5,
        )
        oversized = check(
            _tool_request(bridge, {"project_key": "PRIMARY", "note": "x" * 256}),
            timeout=5,
        )
        monkeypatch.setattr(bridge, "TOOL_POLICY_MAX_CONTEXT_BYTES", 16384)
        monkeypatch.setattr(
            bridge,
            "TOOL_SCHEMA_HASHES",
            {"issue_tracker/create_item": "sha256:changed-schema"},
        )
        stale_schema = check(_tool_request(bridge, {"project_key": "PRIMARY"}), timeout=5)
    finally:
        channel.close()
        server.stop(grace=0).wait()

    assert legacy_unconditional.status.code == bridge.OK
    assert legacy_oversized.status.code == bridge.OK
    assert matching.status.code == bridge.OK
    assert non_matching.status.code == bridge.PERMISSION_DENIED
    assert missing.status.code == bridge.PERMISSION_DENIED
    assert wrong_type.status.code == bridge.PERMISSION_DENIED
    assert oversized.status.code == bridge.PERMISSION_DENIED
    assert stale_schema.status.code == bridge.PERMISSION_DENIED
