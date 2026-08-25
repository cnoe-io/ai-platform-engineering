"""LLM construction helpers for Dynamic Agents."""

from __future__ import annotations

from typing import Any

from dynamic_agents.services.llm_clients import get_llm as _get_llm


def get_configured_llm(model_id: str, model_provider: str) -> Any:
    """Instantiate an LLM with provider-specific runtime options.

    Delegates to `dynamic_agents.services.llm_clients.get_llm`, the single
    entry point for LLM instantiation — it already applies Bedrock's extended
    Botocore timeouts (via AWS_BEDROCK_READ_TIMEOUT/CONNECT_TIMEOUT, same
    defaults previously hardcoded here) and translates gateway-routed
    providers (cloudflare-workers-ai, openai-direct) that `LLMFactory` itself
    doesn't know about. Calling `LLMFactory` directly here (as this used to)
    bypassed that translation and 500'd for those providers.
    """
    return _get_llm(model_provider, model_id)
