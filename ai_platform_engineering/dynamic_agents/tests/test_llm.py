"""Tests for Dynamic Agents LLM construction helpers."""

import importlib
import sys
import types


class PlaceholderFactory:
    def __init__(self, provider):
        self.provider = provider

    def get_llm(self, **kwargs):
        return kwargs


sys.modules.setdefault(
    "cnoe_agent_utils",
    types.SimpleNamespace(LLMFactory=PlaceholderFactory),
)

llm_module = importlib.import_module("dynamic_agents.services.llm")


def test_get_configured_llm_does_not_pass_botocore_config_to_openai(monkeypatch):
    calls = []

    class DummyFactory:
        def __init__(self, provider):
            self.provider = provider

        def get_llm(self, **kwargs):
            calls.append((self.provider, kwargs))
            return "llm"

    monkeypatch.setattr(llm_module, "LLMFactory", DummyFactory)

    result = llm_module.get_configured_llm("bedrock/global.anthropic.claude-sonnet-4-6", "openai")

    assert result == "llm"
    assert calls == [
        (
            "openai",
            {"model": "bedrock/global.anthropic.claude-sonnet-4-6"},
        )
    ]


def test_get_configured_llm_passes_botocore_config_to_aws_bedrock(monkeypatch):
    calls = []

    class DummyFactory:
        def __init__(self, provider):
            self.provider = provider

        def get_llm(self, **kwargs):
            calls.append((self.provider, kwargs))
            return "llm"

    def fake_botocore_config(**kwargs):
        return {"botocore_config": kwargs}

    monkeypatch.setattr(llm_module, "LLMFactory", DummyFactory)
    monkeypatch.setattr(llm_module, "BotocoreConfig", fake_botocore_config)

    result = llm_module.get_configured_llm("anthropic.claude-sonnet-4-5", "aws-bedrock")

    assert result == "llm"
    assert calls == [
        (
            "aws-bedrock",
            {
                "model": "anthropic.claude-sonnet-4-5",
                "config": {"botocore_config": {"read_timeout": 300, "connect_timeout": 60}},
            },
        )
    ]


def test_get_configured_llm_passes_botocore_config_to_bedrock_alias(monkeypatch):
    calls = []

    class DummyFactory:
        def __init__(self, provider):
            self.provider = provider

        def get_llm(self, **kwargs):
            calls.append((self.provider, kwargs))
            return "llm"

    def fake_botocore_config(**kwargs):
        return {"botocore_config": kwargs}

    monkeypatch.setattr(llm_module, "LLMFactory", DummyFactory)
    monkeypatch.setattr(llm_module, "BotocoreConfig", fake_botocore_config)

    result = llm_module.get_configured_llm("anthropic.claude-sonnet-4-5", "bedrock")

    assert result == "llm"
    assert calls == [
        (
            "bedrock",
            {
                "model": "anthropic.claude-sonnet-4-5",
                "config": {"botocore_config": {"read_timeout": 300, "connect_timeout": 60}},
            },
        )
    ]
