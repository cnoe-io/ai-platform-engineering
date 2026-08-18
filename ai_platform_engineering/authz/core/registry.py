"""Server-owned resource/action and provider registry."""

from __future__ import annotations

from dataclasses import dataclass

ACTION_RELATIONS: dict[str, str] = {
    "discover": "can_discover",
    "read": "can_read",
    "view": "can_read",
    "list": "can_read",
    "use": "can_use",
    "invoke": "can_invoke",
    "call": "can_call",
    "create": "can_manage",
    "write": "can_write",
    "update": "can_write",
    "ingest": "can_ingest",
    "execute": "can_execute",
    "assign": "can_assign",
    "share": "can_share",
    "delete": "can_delete",
    "manage": "can_manage",
    "administer": "can_admin",
    "audit": "can_audit",
    "approve": "can_approve",
    "map": "can_map",
    "read-metadata": "can_read_metadata",
}

RESOURCE_TYPES = frozenset(
    {
        "admin_surface",
        "agent",
        "audit_log",
        "data_source",
        "document",
        "external_group",
        "knowledge_base",
        "llm_model",
        "mcp_gateway",
        "mcp_server",
        "mcp_tool",
        "organization",
        "policy",
        "secret_ref",
        "skill",
        "slack_channel",
        "slack_workspace",
        "system_config",
        "task",
        "team",
        "tool",
        "user_profile",
        "webex_space",
        "webex_workspace",
        "workflow_config",
        "workflow_run",
    }
)


@dataclass(frozen=True)
class ProviderDescriptor:
    name: str
    enabled: bool
    version: str


PROVIDERS = {
    "openfga-cel": ProviderDescriptor("openfga-cel", True, "v1"),
    "cedar": ProviderDescriptor("cedar", False, "future"),
    "opa": ProviderDescriptor("opa", False, "future"),
}


def relation_for(resource_type: str, action: str) -> str:
    if resource_type not in RESOURCE_TYPES:
        raise ValueError(f"unsupported resource type: {resource_type}")
    if action == "invoke" and resource_type in {"mcp_gateway", "mcp_tool", "tool"}:
        return "can_call"
    try:
        return ACTION_RELATIONS[action]
    except KeyError as exc:
        raise ValueError(f"unsupported action: {action}") from exc


def select_provider(requested: str | None = None) -> ProviderDescriptor:
    name = requested or "openfga-cel"
    try:
        descriptor = PROVIDERS[name]
    except KeyError as exc:
        raise ValueError("unknown authorization provider") from exc
    if not descriptor.enabled:
        raise ValueError(f"authorization provider {name!r} is disabled")
    return descriptor
