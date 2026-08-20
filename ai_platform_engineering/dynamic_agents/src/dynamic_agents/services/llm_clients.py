"""Shared LLM transport clients and LLM instantiation.

Provides a single entry point (`get_llm`) for obtaining a LangChain chat model
with shared transport clients (boto3/httpx) to avoid duplicating heavy resources.

Set LLM_CLIENT_SHARING=false to disable client sharing (each call creates its own).
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel

logger = logging.getLogger(__name__)

SHARE_CLIENTS = os.getenv("LLM_CLIENT_SHARING", "true").lower() != "false"


def _flatten_text_content_blocks(body: dict[str, Any]) -> bytes | None:
    """Rewrite pure-text OpenAI content-block arrays (`[{"type":"text","text":"..."}]`)
    into plain strings.

    LangChain's ChatOpenAI sends `content` as a list of blocks; real OpenAI accepts
    both forms, but Cloudflare Workers AI's schema (behind the AI Gateway) only
    accepts a string, so plain-text-only requests 400 with a schema error. Mixed
    content (e.g. images) is left untouched since flattening would lose data and
    Workers AI text models can't consume it anyway. Returns None when nothing to
    change.
    """
    messages = body.get("messages")
    if not isinstance(messages, list):
        return None
    changed = False
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        texts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
                texts.append(part["text"])
            else:
                texts = []
                break
        if texts:
            message["content"] = "".join(texts)
            changed = True
    return json.dumps(body).encode("utf-8") if changed else None


def _flatten_content_request_hook(request: Any) -> None:
    """httpx sync `request` event hook — see `_flatten_text_content_blocks`."""
    if request.method != "POST" or not request.content:
        return
    try:
        body = json.loads(request.content)
    except (ValueError, UnicodeDecodeError):
        return
    new_content = _flatten_text_content_blocks(body)
    if new_content is not None:
        import httpx._content

        # httpx sends the wire body from `request.stream`, not `._content` — the
        # latter is only a cache populated by `.read()`. Both must be replaced,
        # or the old (larger) body still goes out under the new (smaller)
        # Content-Length header, corrupting the request.
        request.headers["content-length"] = str(len(new_content))
        request.stream = httpx._content.ByteStream(new_content)  # noqa: SLF001 — httpx has no public content setter
        request._content = new_content  # noqa: SLF001


async def _async_flatten_content_request_hook(request: Any) -> None:
    """httpx async `request` event hook — see `_flatten_text_content_blocks`."""
    _flatten_content_request_hook(request)


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


def _create_httpx_client(
    endpoint: str, headers: tuple[tuple[str, str], ...] | None = None, flatten_content: bool = False
) -> Any:
    import httpx

    event_hooks = {"request": [_flatten_content_request_hook]} if flatten_content else None
    client = httpx.Client(
        timeout=httpx.Timeout(300.0, connect=60.0), headers=dict(headers) if headers else None, event_hooks=event_hooks
    )
    logger.info("Created httpx client (endpoint=%s, shared=%s)", endpoint, SHARE_CLIENTS)
    return client


@lru_cache(maxsize=4)
def _cached_httpx_client(
    endpoint: str, headers: tuple[tuple[str, str], ...] | None = None, flatten_content: bool = False
) -> Any:
    return _create_httpx_client(endpoint, headers, flatten_content)


def _create_async_httpx_client(
    endpoint: str, headers: tuple[tuple[str, str], ...] | None = None, flatten_content: bool = False
) -> Any:
    import httpx

    event_hooks = {"request": [_async_flatten_content_request_hook]} if flatten_content else None
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(300.0, connect=60.0), headers=dict(headers) if headers else None, event_hooks=event_hooks
    )
    logger.info("Created async httpx client (endpoint=%s, shared=%s)", endpoint, SHARE_CLIENTS)
    return client


@lru_cache(maxsize=4)
def _cached_async_httpx_client(
    endpoint: str, headers: tuple[tuple[str, str], ...] | None = None, flatten_content: bool = False
) -> Any:
    return _create_async_httpx_client(endpoint, headers, flatten_content)


def _get_bedrock_clients(region: str | None = None) -> tuple[Any, Any]:
    """Get (bedrock-runtime, bedrock) client pair. Cached by region when sharing enabled."""
    region = region or os.getenv("AWS_REGION", "us-east-1")
    if SHARE_CLIENTS:
        return _cached_bedrock_clients(region)
    return _create_bedrock_clients(region)


def _get_httpx_client(endpoint: str, headers: dict[str, str] | None = None, flatten_content: bool = False) -> Any:
    """Get httpx.Client for OpenAI/Azure. Cached by (endpoint, headers, flatten_content) when sharing enabled."""
    headers_key = tuple(sorted(headers.items())) if headers else None
    if SHARE_CLIENTS:
        return _cached_httpx_client(endpoint, headers_key, flatten_content)
    return _create_httpx_client(endpoint, headers_key, flatten_content)


def _get_async_httpx_client(endpoint: str, headers: dict[str, str] | None = None, flatten_content: bool = False) -> Any:
    """Get httpx.AsyncClient for OpenAI/Azure. Cached by (endpoint, headers, flatten_content) when sharing enabled.

    ChatOpenAI uses this (not the sync `http_client`) for streaming/async calls
    (`_astream`) — without it, custom routing headers (e.g. the AI Gateway's
    `x-portkey-provider`) never reach async requests even though `http_client`
    is set correctly for sync ones.
    """
    headers_key = tuple(sorted(headers.items())) if headers else None
    if SHARE_CLIENTS:
        return _cached_async_httpx_client(endpoint, headers_key, flatten_content)
    return _create_async_httpx_client(endpoint, headers_key, flatten_content)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


class LLMConfigError(ValueError):
    """Raised when an agent has no usable LLM configuration.

    Distinct from `LLMFactory`'s generic `ValueError` so callers (and the
    chat SSE wrapper) can map it to a user-actionable message instead of
    the misleading "Something went wrong - some tools or subagents may
    have timed out" fallback.
    """


# Provider secret field -> env var LLMFactory actually reads (see
# cnoe_agent_utils.llm_factory). Mirrors the fields the "Connect provider"
# dialog collects and saves as `llm:<provider>:<field>` (see
# ui/src/components/dynamic-agents/LLMProvidersTab.tsx PROVIDERS).
_PROVIDER_SECRET_ENV_MAP: dict[str, dict[str, str]] = {
    "openai": {"api_key": "OPENAI_API_KEY"},
    "anthropic-claude": {"api_key": "ANTHROPIC_API_KEY"},
    "azure-openai": {
        "api_key": "AZURE_OPENAI_API_KEY",
        "endpoint": "AZURE_OPENAI_ENDPOINT",
        "api_version": "AZURE_OPENAI_API_VERSION",
    },
    "aws-bedrock": {
        "access_key_id": "AWS_ACCESS_KEY_ID",
        "secret_access_key": "AWS_SECRET_ACCESS_KEY",
        "region": "AWS_REGION",
    },
    "google-genai": {"api_key": "GOOGLE_API_KEY"},
}


async def resolve_provider_credential_env(provider: str, credential_client: Any | None) -> dict[str, str]:
    """Fetch UI-managed provider secrets for env vars not already set on this deployment.

    The "Connect provider" dialog in the LLM Models tab saves credentials into the
    shared credential secret store under `llm:<provider>:<field>`, but nothing
    previously read them back — `LLMFactory` (and this module) only ever read plain
    OS env vars, so a saved secret had no effect on whether the model actually
    worked. This closes that gap by resolving those stored secrets into the same
    env-var overrides `get_llm` already applies for the call duration, the same
    way MCP server BYO secrets are resolved (`services/mcp_client.py`).

    Deployment-level env vars always win: a field is only looked up here when its
    env var isn't already set, so this never overrides an operator's explicit
    configuration.
    """
    if credential_client is None:
        return {}
    normalized = provider.lower().replace("_", "-")
    field_env_map = _PROVIDER_SECRET_ENV_MAP.get(normalized)
    if not field_env_map:
        return {}
    missing = {field: env_var for field, env_var in field_env_map.items() if not os.getenv(env_var)}
    if not missing:
        return {}
    try:
        secret_ids_by_name = await credential_client.list_secret_ids_by_name()
    except Exception as exc:  # noqa: BLE001 — credential store may be unavailable; fall through to no creds
        logger.debug("Could not list stored LLM provider credentials: %s", exc)
        return {}
    resolved: dict[str, str] = {}
    for field, env_var in missing.items():
        secret_id = secret_ids_by_name.get(f"llm:{normalized}:{field}")
        if not secret_id:
            continue
        try:
            value = await credential_client.retrieve_secret(secret_id, intended_use="internal_service")
        except Exception as exc:  # noqa: BLE001 — missing/unauthorized secret should not fail LLM init
            logger.warning("Failed to retrieve stored credential for %s/%s: %s", normalized, field, exc)
            continue
        if value:
            resolved[env_var] = value
    return resolved


def _resolve_llm_defaults(provider: str | None, model_id: str | None) -> tuple[str, str | None]:
    """Fill in provider/model from environment when an agent leaves them blank.

    The bootstrap "Hello World" agent (see ui/src/lib/seed-config.ts) is
    intentionally seeded with empty model/provider so it doesn't pin the
    install to a specific deployment. Per the comment there, the dynamic-
    agents backend is supposed to substitute the deployment default; this
    helper is that promise.

    Resolution order:
    - `provider`: agent value → `LLM_PROVIDER` env var
    - `model_id`: agent value → `None` (LLMFactory then reads the
      provider-specific env var, e.g. `AWS_BEDROCK_MODEL_ID`,
      `OPENAI_MODEL_NAME`, `ANTHROPIC_MODEL_NAME`, etc.)

    Empty `model_id` is returned as `None` rather than `""` so the
    downstream `model_override` check in LLMFactory falls through to
    its env-based lookup.
    """
    resolved_provider = (provider or "").strip() or os.getenv("LLM_PROVIDER", "").strip()
    if not resolved_provider:
        raise LLMConfigError(
            "Agent has no LLM provider configured and no deployment default "
            "(LLM_PROVIDER) is set. Open Admin UI → Custom Agents and pick a "
            "provider/model for this agent, or set LLM_PROVIDER on the "
            "dynamic-agents service."
        )
    resolved_model = (model_id or "").strip() or None
    return resolved_provider, resolved_model


def get_llm(provider: str, model_id: str, credential_env: dict[str, str] | None = None) -> BaseChatModel:
    """Get a LangChain chat model for the given provider and model.

    Injects shared transport clients (boto3/httpx) when LLM_CLIENT_SHARING=true,
    avoiding ~20MB of duplicated boto3 sessions per runtime for Bedrock.

    For Google (Gemini/Vertex AI), no shared client is needed — the SDK
    manages its own transport internally.

    When `provider` or `model_id` are empty, falls back to environment
    defaults (`LLM_PROVIDER` and provider-specific model vars). Raises
    `LLMConfigError` with an actionable message if neither agent nor env
    define a usable provider.

    `credential_env` (see `resolve_provider_credential_env`) supplies
    provider API keys/config resolved from the UI's "Connect provider"
    secret store, applied as env-var overrides for the duration of this
    call only — same mechanism as the Cloudflare/OpenAI-direct overrides
    below.
    """
    from cnoe_agent_utils import LLMFactory

    resolved_provider, resolved_model = _resolve_llm_defaults(provider, model_id)

    kwargs: dict[str, Any] = {}
    if resolved_model is not None:
        kwargs["model"] = resolved_model

    factory_provider = resolved_provider
    p = resolved_provider.lower().replace("-", "_")
    # LLMFactory's "openai" builder always derives base_url from OPENAI_ENDPOINT
    # (and passing base_url again via kwargs collides with that). For providers
    # that need a different endpoint than the deployment-default OPENAI_ENDPOINT,
    # temporarily override the env vars it reads for the duration of this call.
    env_overrides: dict[str, str] = dict(credential_env or {})
    # Credential-store values (unlike the provider-specific overrides added
    # below) must be visible to the SHARE_CLIENTS branch further down, which
    # reads os.getenv(...) directly to build shared bedrock/httpx clients —
    # so they're applied to the environment immediately rather than only
    # right before the LLMFactory call. `previous_env` accumulates the
    # original value of every key touched here so the single `finally`
    # block below can restore all of them, including ones added later
    # (e.g. the cloudflare/openai_direct branches' OPENAI_* overrides).
    previous_env: dict[str, str | None] = {k: os.environ.get(k) for k in env_overrides}
    os.environ.update(env_overrides)

    if p == "cloudflare_workers_ai":
        # Routed through the local Portkey AI Gateway (~/Software/aigateway,
        # `wrangler dev` on :8787), which speaks the OpenAI chat-completions
        # protocol but requires its own x-portkey-* routing headers, and
        # expects the Workers AI model slug (e.g. "@cf/meta/llama-3.1-8b-instruct")
        # as the "model" field. LLMFactory has no "cloudflare-workers-ai"
        # provider, so we present it as "openai" with a custom transport.
        # NOTE: the gateway reads the provider API key from the plain
        # `Authorization: Bearer <token>` header (not `x-portkey-api-key`,
        # despite that header existing) — confirmed against gateway source
        # (handlerUtils.ts: `apiKey: requestHeaders['authorization']...`).
        # ChatOpenAI sends `Authorization: Bearer <OPENAI_API_KEY>` itself,
        # so the Cloudflare token is passed via the OPENAI_API_KEY override
        # below rather than as a custom header.
        endpoint = os.getenv("AI_GATEWAY_URL", "http://host.docker.internal:8787/v1")
        headers = {
            "x-portkey-provider": "workers-ai",
            "x-portkey-workers-ai-account-id": os.getenv("CLOUDFLARE_ACCOUNT_ID", ""),
        }
        # Workers AI's schema requires string `content` (unlike OpenAI, which
        # accepts both string and content-block-array forms); ChatOpenAI always
        # sends the array form, so flatten pure-text blocks before they're sent.
        kwargs["http_client"] = _get_httpx_client(endpoint, headers, flatten_content=True)
        kwargs["http_async_client"] = _get_async_httpx_client(endpoint, headers, flatten_content=True)
        # The AI Gateway's workers-ai route 500s on SSE (`stream: true`) requests
        # while the same request with `stream: false` succeeds (confirmed via
        # direct curl). `disable_streaming` stops LangChain's own .stream()/
        # .astream() wrappers from requesting SSE; ChatOpenAI's `streaming`
        # attribute (set unconditionally by LLMFactory, so it can't also be
        # passed here — that raises a duplicate-kwarg TypeError) independently
        # puts `stream: true` in the body even for a plain .invoke(), so it's
        # force-disabled on the instance right after construction below.
        kwargs["disable_streaming"] = True
        # Prefer the model_id selected on the agent/catalog entry (a real Workers
        # AI slug, e.g. "@cf/meta/llama-3.1-8b-instruct") so different agents can
        # pick different Cloudflare models. Only fall back to the deployment-wide
        # CLOUDFLARE_WORKERS_AI_MODEL env var when the agent leaves model_id blank.
        kwargs["model"] = resolved_model or os.getenv(
            "CLOUDFLARE_WORKERS_AI_MODEL", "@cf/meta/llama-3.1-8b-instruct-fast"
        )
        env_overrides["OPENAI_ENDPOINT"] = endpoint
        env_overrides["OPENAI_API_KEY"] = os.getenv("CLOUDFLARE_API_TOKEN", "")
        factory_provider = "openai"
    elif p == "openai_direct":
        # Real OpenAI, kept separate from the deployment-default "openai"
        # provider (which may point at an OpenAI-compatible endpoint like
        # NVIDIA NIM or a local gateway via OPENAI_ENDPOINT).
        endpoint = "https://api.openai.com/v1"
        kwargs["http_client"] = _get_httpx_client(endpoint)
        kwargs["http_async_client"] = _get_async_httpx_client(endpoint)
        kwargs.setdefault("model", os.getenv("OPENAI_DIRECT_MODEL_NAME", "gpt-4o-mini"))
        env_overrides["OPENAI_ENDPOINT"] = endpoint
        env_overrides["OPENAI_API_KEY"] = os.getenv("OPENAI_DIRECT_API_KEY", "")
        factory_provider = "openai"
    elif SHARE_CLIENTS:
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

    for key in env_overrides:
        previous_env.setdefault(key, os.environ.get(key))
    os.environ.update(env_overrides)
    try:
        llm = LLMFactory(provider=factory_provider).get_llm(**kwargs)
    except ValueError as exc:
        # LLMFactory raises ValueError for unknown providers OR missing
        # provider-specific env vars. Re-raise as LLMConfigError so the
        # SSE chat wrapper can translate to an actionable user message.
        raise LLMConfigError(
            f"Cannot initialize LLM (provider={resolved_provider!r}, "
            f"model={resolved_model!r}): {exc}"
        ) from exc
    finally:
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    if p == "cloudflare_workers_ai":
        # See the `disable_streaming` comment above — LLMFactory sets `streaming`
        # unconditionally, so it must be overridden post-construction here rather
        # than passed as a kwarg.
        llm.streaming = False

    logger.info(
        "[llm] Instantiated %s (provider=%s, model=%s, shared_clients=%s)",
        type(llm).__name__,
        resolved_provider,
        resolved_model or "<from env>",
        SHARE_CLIENTS,
    )
    return llm


def close_all() -> None:
    """Clear cached clients. Called on shutdown."""
    _cached_bedrock_clients.cache_clear()
    _cached_httpx_client.cache_clear()
    _cached_async_httpx_client.cache_clear()
    logger.info("Cleared shared LLM client caches")
