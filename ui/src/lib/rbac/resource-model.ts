import type {
  UniversalRebacResourceAction,
  UniversalRebacResourceType,
  UniversalRebacResourceTypeDefinition,
} from "@/types/rbac-universal";

export const STANDARD_REBAC_ACTIONS = [
  "discover",
  "read",
  "use",
  "write",
  "create",
  "delete",
  "manage",
  "administer",
  "audit",
  "approve",
  "share",
] as const;

export const UNIVERSAL_REBAC_RESOURCE_TYPES: readonly UniversalRebacResourceTypeDefinition[] = [
  {
    type: "organization",
    actions: ["discover", "read", "manage", "audit"],
    description: "Platform-wide organization scope.",
  },
  {
    type: "user",
    actions: ["read", "manage", "audit"],
    description: "User profile and identity-link state.",
  },
  {
    type: "external_group",
    actions: ["discover", "read", "map", "audit"],
    description: "Enterprise identity group imported from an upstream provider.",
  },
  {
    type: "team",
    actions: ["discover", "read", "write", "manage", "audit"],
    description: "CAIPE team membership and team-owned authorization scope.",
  },
  {
    type: "slack_workspace",
    actions: ["discover", "read", "manage", "audit"],
    description: "Slack workspace configuration and channel discovery scope.",
  },
  {
    type: "slack_channel",
    actions: ["discover", "read", "use", "write", "manage", "audit"],
    description: "Slack channel that can be granted access to multiple CAIPE resources.",
  },
  {
    type: "agent",
    actions: ["discover", "read", "use", "write", "manage", "audit"],
    description: "Agent execution and configuration resource.",
  },
  {
    type: "mcp_server",
    actions: ["discover", "read", "use", "invoke", "manage", "audit"],
    description: "MCP server registration and invocation scope.",
  },
  {
    type: "tool",
    actions: ["discover", "read", "use", "call", "manage", "audit"],
    description: "Tool or tool-prefix authorization target.",
  },
  {
    type: "knowledge_base",
    actions: ["discover", "read", "use", "write", "ingest", "administer", "audit"],
    description: "Knowledge base query, ingestion, and administration scope.",
  },
  {
    type: "document",
    actions: ["discover", "read", "write", "delete", "share", "audit"],
    description: "Document-level authorization target within a knowledge base.",
  },
  {
    type: "skill",
    actions: ["discover", "read", "use", "write", "manage", "audit"],
    description: "Skill catalog entry and execution permission.",
  },
  {
    type: "task",
    actions: ["discover", "read", "use", "write", "manage", "audit"],
    description: "Task template or execution target.",
  },
  {
    type: "conversation",
    actions: ["discover", "read", "write", "share", "delete", "audit"],
    description: "Conversation history and sharing scope.",
  },
  {
    type: "admin_surface",
    actions: ["discover", "read", "write", "manage", "audit"],
    description: "Admin UI page or operation group.",
  },
  {
    type: "policy",
    actions: ["discover", "read", "write", "approve", "manage", "audit"],
    description: "Policy rule or relationship change-set resource.",
  },
  {
    type: "audit_log",
    actions: ["discover", "read", "audit"],
    description: "Audit view scoped by team, resource, or platform area.",
  },
  {
    type: "secret_ref",
    actions: ["discover", "read-metadata", "use", "manage", "audit"],
    description: "Secret reference metadata and usage authorization without secret disclosure.",
  },
  {
    type: "system_config",
    actions: ["discover", "read", "write", "manage", "audit"],
    description: "System configuration area.",
  },
] as const;

const RESOURCE_TYPES_BY_NAME = new Map(
  UNIVERSAL_REBAC_RESOURCE_TYPES.map((definition) => [definition.type, definition])
);

export function listResourceTypeDefinitions(): readonly UniversalRebacResourceTypeDefinition[] {
  return UNIVERSAL_REBAC_RESOURCE_TYPES;
}

export function getResourceTypeDefinition(
  type: UniversalRebacResourceType
): UniversalRebacResourceTypeDefinition | undefined {
  return RESOURCE_TYPES_BY_NAME.get(type);
}

export function isSupportedResourceAction(
  resourceType: UniversalRebacResourceType,
  action: UniversalRebacResourceAction
): boolean {
  return Boolean(getResourceTypeDefinition(resourceType)?.actions.includes(action));
}
