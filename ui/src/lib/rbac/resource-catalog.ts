import { getCollection } from "@/lib/mongodb";
import { listResourceTypeDefinitions } from "@/lib/rbac/resource-model";
import type {
  UniversalRebacResourceType,
  UniversalRebacResourceTypeDefinition,
} from "@/types/rbac-universal";

export type RebacResourceStatus = "active" | "disabled" | "archived" | "deleted" | "unknown";
export type RebacEnforcementStatus =
  | "not_gated"
  | "role_gated"
  | "rebac_shadowed"
  | "rebac_enforced"
  | "deprecated";

export interface RebacCatalogResource {
  type: UniversalRebacResourceType;
  id: string;
  display_name: string;
  status: RebacResourceStatus;
  enforcement_status: RebacEnforcementStatus;
  metadata?: Record<string, unknown>;
}

export interface ListRebacCatalogInput {
  type?: string | null;
  status?: string | null;
  search?: string | null;
}

export interface RebacCatalog {
  resource_types: readonly UniversalRebacResourceTypeDefinition[];
  actions: Record<string, readonly string[]>;
  resources: RebacCatalogResource[];
}

const DEFAULT_RESOURCES: readonly RebacCatalogResource[] = [
  resource("organization", "caipe", "CAIPE", "rebac_shadowed"),
  resource("user", "current-user", "Current User", "role_gated"),
  resource("external_group", "example-enterprise-group", "Example Enterprise Group", "rebac_shadowed"),
  resource("team", "platform", "Platform", "rebac_shadowed"),
  resource("slack_workspace", "workspace-default", "Default Slack Workspace", "role_gated"),
  resource("slack_channel", "workspace-default:platform", "#platform", "role_gated"),
  resource("agent", "platform-engineer", "Platform Engineer", "rebac_shadowed"),
  resource("mcp_server", "argocd", "Argo CD MCP Server", "role_gated"),
  resource("tool", "argocd_*", "Argo CD Tools", "rebac_shadowed"),
  resource("knowledge_base", "platform-runbooks", "Platform Runbooks", "rebac_shadowed"),
  resource("document", "platform-runbook", "Platform Runbook", "role_gated"),
  resource("skill", "incident-triage", "Incident Triage", "role_gated"),
  resource("task", "task-template", "Task Template", "role_gated"),
  resource("conversation", "conversation", "Conversation", "role_gated"),
  resource("admin_surface", "admin", "Admin Console", "role_gated"),
  resource("policy", "rebac-policies", "ReBAC Policies", "rebac_shadowed"),
  resource("audit_log", "rbac-audit", "RBAC Audit Log", "role_gated"),
  resource("secret_ref", "identity-provider-credentials", "Identity Provider Credentials", "not_gated"),
  resource("system_config", "rbac", "RBAC System Configuration", "role_gated"),
];

function resource(
  type: UniversalRebacResourceType,
  id: string,
  displayName: string,
  enforcementStatus: RebacEnforcementStatus,
  metadata?: Record<string, unknown>
): RebacCatalogResource {
  return {
    type,
    id,
    display_name: displayName,
    status: "active",
    enforcement_status: enforcementStatus,
    metadata,
  };
}

async function readCollection<T>(name: string, query: Record<string, unknown> = {}): Promise<T[]> {
  try {
    const collection = await getCollection<T>(name);
    const rows = await collection.find(query as never).sort({ name: 1 }).limit(200).toArray();
    return rows as T[];
  } catch {
    return [];
  }
}

function dedupeResources(resources: RebacCatalogResource[]): RebacCatalogResource[] {
  const seen = new Set<string>();
  const out: RebacCatalogResource[] = [];
  for (const item of resources) {
    const key = `${item.type}\n${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function matchesFilter(resourceItem: RebacCatalogResource, input: ListRebacCatalogInput): boolean {
  if (input.type && resourceItem.type !== input.type) return false;
  if (input.status && resourceItem.status !== input.status) return false;
  if (input.search) {
    const query = input.search.toLowerCase();
    return (
      resourceItem.id.toLowerCase().includes(query) ||
      resourceItem.display_name.toLowerCase().includes(query)
    );
  }
  return true;
}

export async function listRebacCatalog(input: ListRebacCatalogInput = {}): Promise<RebacCatalog> {
  const definitions = listResourceTypeDefinitions();
  const actions = Object.fromEntries(
    definitions.map((definition) => [definition.type, definition.actions])
  );

  const [teams, users, agents, mcpServers, kbOwnership, slackMappings, conversations] =
    await Promise.all([
      readCollection<{ _id: unknown; slug?: string; name?: string; status?: string }>("teams"),
      readCollection<{ _id?: unknown; email?: string; name?: string; role?: string }>("users"),
      readCollection<{ _id: unknown; name?: string; description?: string }>("dynamic_agents", {
        enabled: { $ne: false },
      }),
      readCollection<{ _id: unknown; name?: string; description?: string }>("mcp_servers", {
        enabled: { $ne: false },
      }),
      readCollection<{ kb_ids?: string[]; kb_permissions?: Record<string, string> }>(
        "team_kb_ownership"
      ),
      readCollection<{
        slack_workspace_id?: string;
        slack_channel_id?: string;
        channel_name?: string;
      }>("channel_team_mappings"),
      readCollection<{ _id: unknown; title?: string }>("conversations"),
    ]);

  const kbIds = new Set<string>();
  for (const row of kbOwnership) {
    for (const id of row.kb_ids ?? []) kbIds.add(id);
    for (const id of Object.keys(row.kb_permissions ?? {})) kbIds.add(id);
  }

  const discovered: RebacCatalogResource[] = [
    ...teams.map((team) =>
      resource("team", team.slug || String(team._id), team.name || String(team._id), "rebac_shadowed")
    ),
    ...users.map((user) =>
      resource("user", user.email || String(user._id), user.name || user.email || String(user._id), "role_gated")
    ),
    ...agents.map((agent) =>
      resource("agent", String(agent._id), agent.name || String(agent._id), "rebac_shadowed")
    ),
    ...mcpServers.flatMap((server) => [
      resource("mcp_server", String(server._id), server.name || String(server._id), "role_gated"),
      resource("tool", `${String(server._id)}_*`, `${String(server._id)} tools`, "rebac_shadowed"),
    ]),
    ...Array.from(kbIds).map((id) => resource("knowledge_base", id, id, "rebac_shadowed")),
    ...slackMappings.flatMap((mapping) => {
      const workspaceId = mapping.slack_workspace_id || "default";
      const channelId = mapping.slack_channel_id || mapping.channel_name || "unknown";
      return [
        resource("slack_workspace", workspaceId, workspaceId, "role_gated"),
        resource(
          "slack_channel",
          `${workspaceId}:${channelId}`,
          mapping.channel_name || channelId,
          "role_gated"
        ),
      ];
    }),
    ...conversations.map((conversation) =>
      resource(
        "conversation",
        String(conversation._id),
        conversation.title || String(conversation._id),
        "role_gated"
      )
    ),
  ];

  return {
    resource_types: definitions,
    actions,
    resources: dedupeResources([...discovered, ...DEFAULT_RESOURCES])
      .filter((item) => matchesFilter(item, input))
      .sort((a, b) => `${a.type}:${a.display_name}`.localeCompare(`${b.type}:${b.display_name}`)),
  };
}
