from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator

import httpx
import pytest

from ai_platform_engineering.authz.api.envoy_proto import CheckRequest
from ai_platform_engineering.authz.api.ext_authz import ExtAuthzService
from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.providers.base import ProviderResult


SCHEMA_HASH = "sha256:" + "a" * 64


class ConditionalProvider:
    async def check(self, request, *, context=None) -> ProviderResult:
        resource = request.resource.openfga_ref
        if resource == "mcp_gateway:list":
            allowed = True
        elif resource == "tool:issue_tracker/create_item":
            allowed = context is not None and context.get("string_arguments", {}).get("/project_key") == "PRIMARY"
        else:
            allowed = False
        return ProviderResult(allowed=allowed, authorization_model_id="model-example")


class McpRecorder(BaseHTTPRequestHandler):
    calls: list[bytes] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        self.__class__.calls.append(self.rfile.read(length))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"jsonrpc":"2.0","result":{"ok":true},"id":1}')

    def log_message(self, _format: str, *args: object) -> None:
        del args


@contextmanager
def recording_mcp() -> Iterator[str]:
    McpRecorder.calls = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), McpRecorder)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield f"http://{host}:{port}/mcp"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def check_request(arguments: dict[str, object]) -> CheckRequest:
    request = CheckRequest()
    request.attributes.request.http.method = "POST"
    request.attributes.request.http.path = "/mcp/issue_tracker"
    request.attributes.request.http.raw_body = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "create_item", "arguments": arguments},
        }
    ).encode()
    request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
        "sub"
    ].string_value = "example-user"
    return request


async def gateway_call(
    service: ExtAuthzService,
    upstream: str,
    arguments: dict[str, object],
) -> int:
    request = check_request(arguments)
    decision = await service.Check(request, None)
    if decision.status.code == 0:
        response = httpx.post(upstream, content=bytes(request.attributes.request.http.raw_body), timeout=2)
        response.raise_for_status()
    return decision.status.code


@pytest.mark.asyncio
async def test_only_matching_exact_tool_call_reaches_mcp(tmp_path: Path) -> None:
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    await outbox.initialize()
    settings = Settings(
        allow_insecure_headers=True,
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        schema_hashes_json=json.dumps({"issue_tracker/create_item": SCHEMA_HASH}),
    )
    service = ExtAuthzService(
        DecisionEngine(ConditionalProvider(), outbox=outbox),  # type: ignore[arg-type]
        settings,
    )

    with recording_mcp() as upstream:
        assert await gateway_call(service, upstream, {"project_key": "PRIMARY"}) == 0
        assert len(McpRecorder.calls) == 1

        assert await gateway_call(service, upstream, {"project_key": "OTHER"}) == 7
        assert await gateway_call(service, upstream, {}) == 7

        assert len(McpRecorder.calls) == 1
        forwarded = json.loads(McpRecorder.calls[0])
        assert forwarded["params"]["arguments"] == {"project_key": "PRIMARY"}
