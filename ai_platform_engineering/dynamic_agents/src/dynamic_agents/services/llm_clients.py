"""Shared LLM transport clients and LLM instantiation.

Provides a single entry point (`get_llm`) for obtaining a LangChain chat model
with shared transport clients (boto3/httpx) to avoid duplicating heavy resources.

Set LLM_CLIENT_SHARING=false to disable client sharing (each call creates its own).
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel

logger = logging.getLogger(__name__)

SHARE_CLIENTS = os.getenv("LLM_CLIENT_SHARING", "true").lower() != "false"


# ─────────────────────────────────────────────────────────────────────────────
# Transport client creation and caching
# ─────────────────────────────────────────────────────────────────────────────


def _create_bedrock_clients(region: str) -> tuple[Any, Any]:
    import boto3
    from botocore.config import Config

    config = Config(
        read_timeout=int(os.getenv("AWS_BEDROCK_READ_TIMEOUT", "300")),
        connect_timeout=int(os.getenv("AWS_BEDROCK_CONNECT_TIMEOUT", "60")),
    )
    # boto3.Session auto-resolves creds from env/profile/instance-role
    session = boto3.Session(region_name=region)
    runtime = session.client("bedrock-runtime", config=config)
    control = session.client("bedrock", config=config)
    logger.info("Created bedrock clients (region=%s, shared=%s)", region, SHARE_CLIENTS)
    return (runtime, control)


@lru_cache(maxsize=4)
def _cached_bedrock_clients(region: str) -> tuple[Any, Any]:
    return _create_bedrock_clients(region)


def _create_httpx_client(endpoint: str) -> Any:
    import httpx

    client = httpx.Client(timeout=httpx.Timeout(300.0, connect=60.0))
    logger.info("Created httpx client (endpoint=%s, shared=%s)", endpoint, SHARE_CLIENTS)
    return client


@lru_cache(maxsize=4)
def _cached_httpx_client(endpoint: str) -> Any:
    return _create_httpx_client(endpoint)


def _get_bedrock_clients(region: str | None = None) -> tuple[Any, Any]:
    """Get (bedrock-runtime, bedrock) client pair. Cached by region when sharing enabled."""
    region = region or os.getenv("AWS_REGION", "us-east-1")
    if SHARE_CLIENTS:
        return _cached_bedrock_clients(region)
    return _create_bedrock_clients(region)


def _get_httpx_client(endpoint: str) -> Any:
    """Get httpx.Client for OpenAI/Azure. Cached by endpoint when sharing enabled."""
    if SHARE_CLIENTS:
        return _cached_httpx_client(endpoint)
    return _create_httpx_client(endpoint)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


def get_llm(provider: str, model_id: str) -> BaseChatModel:
    """Get a LangChain chat model for the given provider and model.

    Injects shared transport clients (boto3/httpx) when LLM_CLIENT_SHARING=true,
    avoiding ~20MB of duplicated boto3 sessions per runtime for Bedrock.

    For Google (Gemini/Vertex AI), no shared client is needed — the SDK
    manages its own transport internally.
    """
    from cnoe_agent_utils import LLMFactory

    kwargs: dict[str, Any] = {"model": model_id}

    if SHARE_CLIENTS:
        p = provider.lower().replace("-", "_")
        if "bedrock" in p or "aws" in p:
            rt, ctrl = _get_bedrock_clients()
            kwargs["client"] = rt
            kwargs["bedrock_client"] = ctrl
        elif "azure" in p:
            endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
            kwargs["http_client"] = _get_httpx_client(endpoint)
        elif "openai" in p:
            endpoint = os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
            kwargs["http_client"] = _get_httpx_client(endpoint)
        # google-gemini / google-vertex-ai: no shared client needed

    llm = LLMFactory(provider=provider).get_llm(**kwargs)
    logger.info(
        "[llm] Instantiated %s (provider=%s, model=%s, shared_clients=%s)",
        type(llm).__name__,
        provider,
        model_id,
        SHARE_CLIENTS,
    )
    return llm


def close_all() -> None:
    """Clear cached clients. Called on shutdown."""
    _cached_bedrock_clients.cache_clear()
    _cached_httpx_client.cache_clear()
    logger.info("Cleared shared LLM client caches")
