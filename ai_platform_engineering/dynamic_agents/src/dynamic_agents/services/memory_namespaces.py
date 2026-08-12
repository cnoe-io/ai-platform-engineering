"""Resolve configured memory namespaces from static config and MCP tools."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

from dynamic_agents.auth.token_context import current_user_sub, current_user_token
from dynamic_agents.config import Settings
from dynamic_agents.models import DynamicAgentConfig, MCPServerConfig
from dynamic_agents.services.credential_exchange import CredentialExchangeClient
from dynamic_agents.services.mcp_client import (
    build_mcp_connections,
    get_tools_with_resilience,
    resolve_mcp_connections_credential_refs,
)
from dynamic_agents.services.memory_paths import validate_namespace_key

logger = logging.getLogger(__name__)
_CACHE_TTL_SECONDS = 30.0
_namespace_cache: dict[tuple[str, str], tuple[float, list[dict[str, str]]]] = {}


async def resolve_memory_namespaces(
    agent: DynamicAgentConfig,
    mcp_servers: list[MCPServerConfig],
    settings: Settings,
    *,
    use_cache: bool = True,
) -> list[dict[str, str]]:
    """Return de-duplicated namespaces visible to the current caller."""

    memory = agent.builtin_tools.memory if agent.builtin_tools else None
    if not memory or not memory.enabled:
        return []

    user_token = current_user_token.get()
    caller_key = current_user_sub.get()
    if not caller_key:
        caller_key = hashlib.sha256((user_token or "anonymous").encode()).hexdigest()
    cache_key = (caller_key, agent.id)
    cached = _namespace_cache.get(cache_key)
    now = time.monotonic()
    if use_cache and cached and cached[0] > now:
        return [dict(item) for item in cached[1]]

    resolved: dict[str, str] = {}
    for item in memory.namespaces:
        try:
            key = validate_namespace_key(item.key)
        except ValueError:
            logger.warning("Ignoring invalid static memory namespace key %r", item.key)
            continue
        resolved[key] = item.label.strip() or key

    source = memory.namespace_source
    if source is None:
        result = [{"key": key, "label": label} for key, label in resolved.items()]
        _namespace_cache[cache_key] = (now + _CACHE_TTL_SECONDS, result)
        return result

    connections = build_mcp_connections(
        mcp_servers,
        [source.server],
        agent_gateway_url=settings.agent_gateway_url,
        auth_bearer=current_user_token.get(),
        agent_id=agent.id,
    )
    credential_client = None
    if settings.credential_api_url and user_token:
        credential_client = CredentialExchangeClient(
            base_url=settings.credential_api_url,
            audience=settings.credential_service_audience,
            token_provider=lambda: user_token,
        )
    credential_result = await resolve_mcp_connections_credential_refs(
        mcp_servers,
        connections,
        credential_client=credential_client,
        caller_token=user_token,
    )
    tools, failed, errors, _status = await get_tools_with_resilience(credential_result.connections)
    if failed:
        raise RuntimeError(errors.get(source.server) or f"Namespace source {source.server} is unavailable")
    tool_name = f"{source.server}_{source.tool}"
    selected = next((tool for tool in tools if getattr(tool, "name", "") == tool_name), None)
    if selected is None:
        raise RuntimeError(f"Namespace source tool '{tool_name}' was not found")

    result = await selected.ainvoke(dict(source.args))
    decoded = _decode_result(result)
    keys = _extract_values(decoded, source.key_path)
    labels = _extract_values(decoded, source.label_path)
    if len(keys) != len(labels):
        raise RuntimeError("Namespace source key and label paths returned different lengths")
    for raw_key, raw_label in zip(keys, labels, strict=True):
        try:
            key = validate_namespace_key(str(raw_key))
        except ValueError:
            logger.warning("Ignoring invalid dynamic memory namespace key %r", raw_key)
            continue
        resolved[key] = str(raw_label).strip() or key
    result = [{"key": key, "label": label} for key, label in resolved.items()]
    _namespace_cache[cache_key] = (now + _CACHE_TTL_SECONDS, result)
    return result


def _decode_result(result: Any) -> Any:
    if isinstance(result, tuple) and result:
        result = result[0]
    # LangChain tools may return a ToolMessage, an MCP result envelope, or
    # the content-block list directly. Normalize all three without depending
    # on a concrete provider response class.
    if not isinstance(result, (str, bytes, dict, list)):
        content = getattr(result, "content", None)
        if content is not None:
            result = content
    if isinstance(result, dict) and "content" in result:
        result = result["content"]
    if isinstance(result, str):
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return result
    if isinstance(result, list) and len(result) == 1:
        block = result[0]
        text = block.get("text") if isinstance(block, dict) else getattr(block, "text", None)
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
    return result


def _extract_values(value: Any, path: str) -> list[Any]:
    """Extract values from a small dotted path language with `[]` expansion."""

    current = [value]
    for raw_part in path.split("."):
        expand = raw_part.endswith("[]")
        part = raw_part[:-2] if expand else raw_part
        next_values: list[Any] = []
        for item in current:
            child = item.get(part) if isinstance(item, dict) else None
            if expand:
                if isinstance(child, list):
                    next_values.extend(child)
            elif child is not None:
                next_values.append(child)
        current = next_values
    return current
