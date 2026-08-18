from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_platform_engineering.authz.api.envoy_proto import CheckRequest
from ai_platform_engineering.authz.api.ext_authz import ExtAuthzService
from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.tests.conftest import FakeProvider


def check_request(*, arguments: dict[str, object], body: bytes | None = None) -> CheckRequest:
    request = CheckRequest()
    request.attributes.request.http.method = "POST"
    request.attributes.request.http.path = "/mcp/issue_tracker"
    request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
        "sub"
    ].string_value = "example-user"
    request.attributes.metadata_context.filter_metadata["caipe.auth"].fields[
        "preferred_username"
    ].string_value = "example-user"
    request.attributes.request.http.raw_body = body or json.dumps(
        {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": "create_item", "arguments": arguments},
        }
    ).encode()
    return request


async def service(
    provider: FakeProvider,
    tmp_path: Path,
) -> tuple[ExtAuthzService, AuditOutbox]:
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    await outbox.initialize()
    settings = Settings(
        allow_insecure_headers=True,
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        schema_hashes_json=json.dumps(
            {"issue_tracker/create_item": "sha256:" + "a" * 64}
        ),
    )
    return ExtAuthzService(DecisionEngine(provider, outbox=outbox), settings), outbox


@pytest.mark.asyncio
async def test_ext_authz_projects_trusted_tool_context_and_journals_once(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=False)
    provider.results[("user:example-user", "invoke", "mcp_gateway:list")] = True
    provider.results[("user:example-user", "invoke", "tool:issue_tracker/create_item")] = True
    adapter, outbox = await service(provider, tmp_path)

    result = await adapter.Check(
        check_request(arguments={"project/key": "PRIMARY", "count": 2, "active": True}),
        None,
    )

    assert result.status.code == 0
    assert provider.contexts[-1] == {
        "schema_hash": "sha256:" + "a" * 64,
        "string_arguments": {"/project~1key": "PRIMARY"},
        "integer_arguments": {"/count": 2},
        "boolean_arguments": {"/active": True},
    }
    assert await outbox.size() == 1


@pytest.mark.asyncio
async def test_ext_authz_wildcard_fallback_has_one_authoritative_event(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=False)
    provider.results[("user:example-user", "invoke", "mcp_gateway:list")] = True
    provider.results[("user:example-user", "invoke", "tool:issue_tracker/*")] = True
    adapter, outbox = await service(provider, tmp_path)

    result = await adapter.Check(check_request(arguments={}), None)

    assert result.status.code == 0
    snapshot = outbox.snapshot_sync()
    assert len(snapshot) == 1
    assert snapshot[0]["payload"]["payload"]["resource_ref"] == "tool:issue_tracker/*"


@pytest.mark.asyncio
async def test_ext_authz_rejects_duplicate_json_keys_before_openfga(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=True)
    adapter, outbox = await service(provider, tmp_path)
    raw = (
        b'{"method":"tools/call","params":{"name":"create_item",'
        b'"arguments":{"project":"PRIMARY","project":"SECONDARY"}}}'
    )

    result = await adapter.Check(check_request(arguments={}, body=raw), None)

    assert result.status.code == 7
    assert provider.contexts == []
    assert await outbox.size() == 0


@pytest.mark.asyncio
async def test_ext_authz_requires_the_internal_service_token(tmp_path: Path) -> None:
    provider = FakeProvider(default_allowed=True)
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    await outbox.initialize()
    settings = Settings(
        service_token="internal-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
    )
    adapter = ExtAuthzService(DecisionEngine(provider, outbox=outbox), settings)

    class Context:
        def invocation_metadata(self):
            return ()

    result = await adapter.Check(check_request(arguments={}), Context())

    assert result.status.code == 16
    assert provider.contexts == []
