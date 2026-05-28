"""Tests for Dynamic Agents shared LLM client selection."""

import sys
import types
from typing import Any

import pytest

from dynamic_agents.services import llm_clients


def _fail_get_bedrock_clients() -> tuple[Any, Any]:
    raise AssertionError("_get_bedrock_clients should not be called")


@pytest.fixture
def llm_factory_calls(monkeypatch):
    calls = []

    class DummyFactory:
        def __init__(self, provider: str) -> None:
            self.provider = provider

        def get_llm(self, **kwargs: Any) -> str:
            calls.append((self.provider, kwargs))
            return "llm"

    monkeypatch.setitem(sys.modules, "cnoe_agent_utils", types.SimpleNamespace(LLMFactory=DummyFactory))
    return calls


def test_anthropic_bedrock_auto_skips_shared_boto_clients(monkeypatch, llm_factory_calls):
    monkeypatch.setattr(llm_clients, "SHARE_CLIENTS", True)
    monkeypatch.delenv("AWS_BEDROCK_CLIENT", raising=False)
    monkeypatch.setattr(llm_clients, "_get_bedrock_clients", _fail_get_bedrock_clients)

    result = llm_clients.get_llm("aws-bedrock", "global.anthropic.claude-sonnet-4-5-v1:0")

    assert result == "llm"
    assert len(llm_factory_calls) == 1
    provider, kwargs = llm_factory_calls[0]
    assert provider == "aws-bedrock"
    assert kwargs["model"] == "global.anthropic.claude-sonnet-4-5-v1:0"
    assert "client" not in kwargs
    assert "bedrock_client" not in kwargs
    assert kwargs["config"].read_timeout == 300
    assert kwargs["config"].connect_timeout == 60


def test_anthropic_bedrock_timeout_env_is_preserved(monkeypatch, llm_factory_calls):
    monkeypatch.setattr(llm_clients, "SHARE_CLIENTS", True)
    monkeypatch.delenv("AWS_BEDROCK_CLIENT", raising=False)
    monkeypatch.setenv("AWS_BEDROCK_READ_TIMEOUT", "123")
    monkeypatch.setenv("AWS_BEDROCK_CONNECT_TIMEOUT", "45")
    monkeypatch.setattr(llm_clients, "_get_bedrock_clients", _fail_get_bedrock_clients)

    llm_clients.get_llm("bedrock", "anthropic.claude-haiku-4-5")

    _, kwargs = llm_factory_calls[0]
    assert kwargs["config"].read_timeout == 123
    assert kwargs["config"].connect_timeout == 45


@pytest.mark.parametrize("client_setting", ["anthropic", "anthropic-bedrock", "chat-anthropic-bedrock"])
def test_explicit_anthropic_client_skips_shared_boto_clients(monkeypatch, llm_factory_calls, client_setting):
    monkeypatch.setattr(llm_clients, "SHARE_CLIENTS", True)
    monkeypatch.setenv("AWS_BEDROCK_CLIENT", client_setting)
    monkeypatch.setattr(
        llm_clients,
        "_get_bedrock_clients",
        _fail_get_bedrock_clients,
    )

    llm_clients.get_llm("aws-bedrock", "anthropic.claude-sonnet-4-5")

    _, kwargs = llm_factory_calls[0]
    assert "client" not in kwargs
    assert "bedrock_client" not in kwargs
    assert "config" in kwargs


@pytest.mark.parametrize("client_setting", ["converse", "legacy"])
def test_explicit_non_anthropic_bedrock_client_uses_shared_boto_clients(
    monkeypatch,
    llm_factory_calls,
    client_setting,
):
    monkeypatch.setattr(llm_clients, "SHARE_CLIENTS", True)
    monkeypatch.setenv("AWS_BEDROCK_CLIENT", client_setting)
    monkeypatch.setattr(llm_clients, "_get_bedrock_clients", lambda: ("runtime", "control"))

    llm_clients.get_llm("aws-bedrock", "anthropic.claude-sonnet-4-5")

    _, kwargs = llm_factory_calls[0]
    assert kwargs["client"] == "runtime"
    assert kwargs["bedrock_client"] == "control"
    assert "config" not in kwargs


def test_non_anthropic_bedrock_auto_uses_shared_boto_clients(monkeypatch, llm_factory_calls):
    monkeypatch.setattr(llm_clients, "SHARE_CLIENTS", True)
    monkeypatch.delenv("AWS_BEDROCK_CLIENT", raising=False)
    monkeypatch.setattr(llm_clients, "_get_bedrock_clients", lambda: ("runtime", "control"))

    llm_clients.get_llm("aws-bedrock", "amazon.nova-pro-v1:0")

    _, kwargs = llm_factory_calls[0]
    assert kwargs["client"] == "runtime"
    assert kwargs["bedrock_client"] == "control"
    assert "config" not in kwargs
