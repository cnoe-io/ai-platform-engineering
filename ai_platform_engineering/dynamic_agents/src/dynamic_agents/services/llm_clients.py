"""Shared LLM transport clients — one per (provider, region/endpoint).

Avoids duplicating boto3 sessions, SSL contexts, and connection pools
(~20MB savings per runtime for Bedrock).

Set LLM_CLIENT_SHARING=false to disable caching (each runtime gets its own client).
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

logger = logging.getLogger(__name__)

SHARE_CLIENTS = os.getenv("LLM_CLIENT_SHARING", "true").lower() != "false"


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


def get_bedrock_clients(region: str | None = None) -> tuple[Any, Any]:
    """Get (bedrock-runtime, bedrock) client pair. Cached by region when sharing enabled."""
    region = region or os.getenv("AWS_REGION", "us-east-1")
    if SHARE_CLIENTS:
        return _cached_bedrock_clients(region)
    return _create_bedrock_clients(region)


def get_httpx_client(endpoint: str) -> Any:
    """Get httpx.Client for OpenAI/Azure. Cached by endpoint when sharing enabled."""
    if SHARE_CLIENTS:
        return _cached_httpx_client(endpoint)
    return _create_httpx_client(endpoint)


def get_shared_llm_client(provider: str) -> Any | None:
    """Return shared transport client for the given provider, or None."""
    p = provider.lower().replace("-", "_")
    if "bedrock" in p or "aws" in p:
        return get_bedrock_clients()
    elif "azure" in p:
        return get_httpx_client(os.getenv("AZURE_OPENAI_ENDPOINT", "azure"))
    elif "openai" in p:
        return get_httpx_client(os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1"))
    return None


def close_all() -> None:
    """Clear cached clients. Called on shutdown."""
    _cached_bedrock_clients.cache_clear()
    _cached_httpx_client.cache_clear()
    logger.info("Cleared shared LLM client caches")
