"""Shared LLM client pool to avoid duplicating SSL contexts and connection pools.

Each AgentRuntime that uses the same (provider, region/endpoint) reuses
the same underlying transport client (~20MB savings per runtime for Bedrock).
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Keyed by (provider_type, endpoint_identifier) -> transport client
_shared_clients: dict[str, Any] = {}


def get_shared_llm_client(provider: str, model_id: str) -> Any | None:
    """Get or create a shared transport client for the given provider.

    For AWS Bedrock: returns a tuple (bedrock-runtime client, bedrock client).
    For OpenAI/Azure: returns an httpx.Client.
    For other providers: returns None (no sharing supported).

    The key is based on provider + region/endpoint since the transport
    client is model-agnostic (model is specified per-request).
    """
    provider_lower = provider.lower().replace("-", "_")

    if "bedrock" in provider_lower or "aws" in provider_lower:
        return _get_bedrock_clients()
    elif "openai" in provider_lower:
        return _get_openai_httpx_client(provider_lower)
    elif "azure" in provider_lower:
        return _get_openai_httpx_client(provider_lower)

    return None


def _get_bedrock_clients() -> tuple[Any, Any]:
    """Get or create shared boto3 bedrock-runtime AND bedrock (control-plane) clients.

    Returns a tuple: (data_plane_client, control_plane_client).
    Both share the same boto3 Session to avoid duplicating botocore's
    JSON service model loading (~9MB) and SSL contexts.
    """
    region = os.getenv("AWS_REGION", "us-east-1")
    key_runtime = f"bedrock-runtime:{region}"
    key_control = f"bedrock:{region}"

    if key_runtime in _shared_clients and key_control in _shared_clients:
        return (_shared_clients[key_runtime], _shared_clients[key_control])

    from botocore.config import Config as BotocoreConfig

    boto_config = BotocoreConfig(read_timeout=300, connect_timeout=60)

    # Pick up env-var based timeouts if set (same logic as LLMFactory)
    read_timeout = os.getenv("AWS_BEDROCK_READ_TIMEOUT")
    connect_timeout = os.getenv("AWS_BEDROCK_CONNECT_TIMEOUT")
    if read_timeout or connect_timeout:
        kwargs = {}
        if read_timeout:
            kwargs["read_timeout"] = int(read_timeout)
        if connect_timeout:
            kwargs["connect_timeout"] = int(connect_timeout)
        boto_config = BotocoreConfig(**kwargs)

    import boto3

    aws_access_key_id = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret_access_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    profile = os.getenv("AWS_PROFILE") if not (aws_access_key_id and aws_secret_access_key) else None

    session_kwargs: dict[str, Any] = {}
    if profile:
        session_kwargs["profile_name"] = profile
    if region:
        session_kwargs["region_name"] = region

    session = boto3.Session(**session_kwargs)
    client_kwargs: dict[str, Any] = {"config": boto_config}
    if aws_access_key_id and aws_secret_access_key:
        client_kwargs["aws_access_key_id"] = aws_access_key_id
        client_kwargs["aws_secret_access_key"] = aws_secret_access_key
        aws_session_token = os.getenv("AWS_SESSION_TOKEN")
        if aws_session_token:
            client_kwargs["aws_session_token"] = aws_session_token

    # Data-plane client (bedrock-runtime) — used for converse/invoke
    runtime_client = session.client("bedrock-runtime", **client_kwargs)
    _shared_clients[key_runtime] = runtime_client

    # Control-plane client (bedrock) — used for get_inference_profile
    control_client = session.client("bedrock", **client_kwargs)
    _shared_clients[key_control] = control_client

    logger.info("Created shared bedrock-runtime + bedrock clients (region=%s)", region)
    return (runtime_client, control_client)


def _get_openai_httpx_client(provider_lower: str) -> Any:
    """Get or create a shared httpx.Client for OpenAI/Azure endpoints."""
    if "azure" in provider_lower:
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "azure")
        key = f"httpx:azure:{endpoint}"
    else:
        endpoint = os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1")
        key = f"httpx:openai:{endpoint}"

    if key in _shared_clients:
        return _shared_clients[key]

    import httpx

    client = httpx.Client(timeout=httpx.Timeout(300.0, connect=60.0))
    _shared_clients[key] = client
    logger.info("Created shared httpx client for %s", key)
    return client


def close_all() -> None:
    """Close all shared clients. Called on shutdown."""
    for key, client in _shared_clients.items():
        try:
            if hasattr(client, "close"):
                client.close()
            logger.debug("Closed shared client: %s", key)
        except Exception:
            logger.exception("Error closing shared client: %s", key)
    _shared_clients.clear()
