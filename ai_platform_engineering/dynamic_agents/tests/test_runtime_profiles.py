"""Execution tiers describe supported admission without changing saved runtime identity."""

from copy import deepcopy
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from dynamic_agents.config import Settings
from dynamic_agents.models import (
    MANAGED_AGENT_RUNTIME,
    PRIVATE_CODING_SANDBOX_RUNTIME,
    AgentExecutionConfig,
    UserContext,
)
from dynamic_agents.routes import runtime_profiles
from dynamic_agents.services import sandbox_client
from dynamic_agents.services.native_state_protocol import STATE_CONTRACT
from dynamic_agents.services.sandbox_client import SandboxClient, SandboxError, SandboxProfile

PROFILE = {"id": "primary", "name": "Primary", "revision": "v1", "harness": "claude-code",
           "capabilities": {"mcp": True, "skills": True, "attachments": False}, "state_contract": STATE_CONTRACT}


async def test_unconfigured_catalog_retains_native_default_and_marks_other_tiers_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime_profiles, "get_settings", lambda: Settings(sandbox_service_url=""))
    catalog = await runtime_profiles.runtime_profiles(UserContext(email="caller@example.com"))
    assert catalog["profiles"] == []
    tiers = {item["tier"]: item for item in catalog["tiers"]}
    assert set(tiers) == {"1", "2", "2.5", "3"}
    assert [tier for tier, value in tiers.items() if value["selectable"]] == ["1"]
    assert tiers["1"]["runtime_contract"] == MANAGED_AGENT_RUNTIME.model_dump()
    assert tiers["3"]["runtime_contract"] == PRIVATE_CODING_SANDBOX_RUNTIME.model_dump()
    assert tiers["2"]["status"] == "planned" and "checkpoint" in tiers["2"]["reason"]
    assert tiers["2.5"]["status"] == "research" and "tools" in tiers["2.5"]["reason"]
    assert AgentExecutionConfig().model_dump() == {"kind": "native", "profile_id": None}


@pytest.mark.parametrize("tools_url, mcp, available", [
    ("https://tools.example.test", True, True), ("", True, False), ("https://tools.example.test", False, False),
])
async def test_private_tier_requires_an_existing_admitted_tool_capable_profile(
    monkeypatch: pytest.MonkeyPatch, tools_url: str, mcp: bool, available: bool,
) -> None:
    settings = Settings(sandbox_service_url="https://sandbox.example.test", harness_tools_public_url=tools_url)
    monkeypatch.setattr(runtime_profiles, "get_settings", lambda: settings)
    profile = SandboxProfile.model_validate({**PROFILE, "capabilities": {"mcp": mcp, "skills": True, "attachments": False}})
    client = AsyncMock()
    client.profiles.return_value = [profile]
    monkeypatch.setattr(runtime_profiles, "SandboxClient", lambda _: client)
    catalog = await runtime_profiles.runtime_profiles(UserContext(email="caller@example.com"))
    tier = next(item for item in catalog["tiers"] if item["tier"] == "3")
    assert tier["selectable"] is available
    assert bool(catalog["profiles"]) is available
    if available:
        admitted = catalog["profiles"][0]
        assert admitted == {**PROFILE, "runtime_contract": PRIVATE_CODING_SANDBOX_RUNTIME.model_dump()}
        assert admitted["runtime_contract"]["workspace_scope"] == "conversation"


def test_catalog_metadata_does_not_change_legacy_profile_snapshots_or_agent_execution() -> None:
    legacy = SandboxProfile.model_validate(PROFILE)
    declared = SandboxProfile.model_validate({**PROFILE, "runtime_contract": PRIVATE_CODING_SANDBOX_RUNTIME.model_dump()})
    assert declared == legacy
    # sandbox_runtime compares the exact model dump with its durable admitted
    # profile. New discovery metadata must not force adoption or migration.
    assert declared.model_dump() == legacy.model_dump() == PROFILE
    assert AgentExecutionConfig(kind="sandbox", profile_id="primary").model_dump() == {"kind": "sandbox", "profile_id": "primary"}


@pytest.mark.parametrize("change", [
    {"workspace_scope": "team"}, {"workspace_scope": "user"}, {"workspace_scope": "global"},
    {"tier": "2"}, {"tier": "2.5"}, {"filesystem": "logical"}, {"isolation": "shared-runtime"},
    {"policy_authority": "unrestricted"}, {"command": "arbitrary-program"},
])
async def test_provider_cannot_claim_an_unsupported_runtime_or_workspace_contract(
    monkeypatch: pytest.MonkeyPatch, change: dict[str, str],
) -> None:
    metadata = {**PRIVATE_CODING_SANDBOX_RUNTIME.model_dump(), **change}
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"profiles": [{**PROFILE, "runtime_contract": metadata}]}))
    monkeypatch.setattr(sandbox_client.httpx, "AsyncClient", lambda **options: original(transport=transport, **options))
    client = SandboxClient(Settings(sandbox_service_url="https://sandbox.example.test"), bearer="example-bearer")
    with pytest.raises(SandboxError, match="catalog"):
        await client.profiles()


def test_provider_cannot_describe_managed_execution_as_a_private_sandbox() -> None:
    with pytest.raises(ValidationError, match="private conversation"):
        SandboxProfile.model_validate({**PROFILE, "runtime_contract": MANAGED_AGENT_RUNTIME.model_dump()})


@pytest.mark.parametrize("change", [
    {"kind": "team"}, {"kind": "virtual"}, {"command": "arbitrary-program"},
    {"endpoint": "https://runtime.example.test"}, {"workspace_scope": "team"},
    {"runtime_contract": PRIVATE_CODING_SANDBOX_RUNTIME.model_dump()},
])
def test_agent_definition_cannot_select_unimplemented_tiers_or_supply_runtime_authority(change: dict[str, object]) -> None:
    execution = {"kind": "sandbox", "profile_id": "primary", **deepcopy(change)}
    with pytest.raises(ValidationError):
        AgentExecutionConfig.model_validate(execution)
