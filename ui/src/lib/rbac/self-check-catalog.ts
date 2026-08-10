// assisted-by Codex Codex-sonnet-4-6

export type RbacSelfCheckId =
  | "team_memberships"
  | "agent_access"
  | "agent_tools"
  | "mcp_servers"
  | "llm_models"
  | "service_accounts"
  | "slack"
  | "webex"
  | "credentials"
  | "conversations"
  | "orphan_review";

export interface RbacSelfCheckDefinition {
  id: RbacSelfCheckId;
  label: string;
  description: string;
  sources: string[];
  orphanObjectTypes: string[];
}

export const RBAC_SELF_CHECKS: RbacSelfCheckDefinition[] = [
  {
    id: "team_memberships",
    label: "Teams",
    description: "Team membership source rows, login baseline grants, and the super-admin org link.",
    sources: ["baseline_access", "team_membership_sources", "super_admins_org_admin_link"],
    orphanObjectTypes: ["team", "organization"],
  },
  {
    id: "agent_access",
    label: "Agent access",
    description: "Agent owner, team, global visibility, and org-admin manager grants.",
    sources: [
      "dynamic_agents.owner_subject",
      "dynamic_agents.system_owner",
      "dynamic_agents.org_admin_manager",
      "dynamic_agents.owner/shared teams",
      "dynamic_agents.visibility",
      "platform_config.default_agent_id",
    ],
    orphanObjectTypes: ["agent"],
  },
  {
    id: "agent_tools",
    label: "Agent tools",
    description: "Agent-to-MCP tool caller grants used during runtime.",
    sources: ["dynamic_agents.allowed_tools"],
    orphanObjectTypes: ["tool"],
  },
  {
    id: "mcp_servers",
    label: "MCP servers",
    description: "Config-driven and owned MCP server access grants.",
    sources: [
      "mcp_servers.config_driven",
      "mcp_servers.owner_subject",
      "mcp_servers.owner_team_slug",
      "mcp_servers.org_admin_manager",
      "baseline_access",
    ],
    orphanObjectTypes: ["mcp_server"],
  },
  {
    id: "llm_models",
    label: "LLM models",
    description: "LLM model reader and manager grants.",
    sources: ["llm_models.config_driven", "llm_models.owner_subject"],
    orphanObjectTypes: ["llm_model"],
  },
  {
    id: "service_accounts",
    label: "Service accounts",
    description: "Service account owner team, gateway, agent, and tool scopes.",
    sources: [
      "service_accounts.owning_team_id",
      "service_accounts.gateway_baseline",
      "service_accounts.scopes_snapshot",
    ],
    orphanObjectTypes: ["service_account", "mcp_gateway", "agent", "tool"],
  },
  {
    id: "slack",
    label: "Slack",
    description: "Slack channel resource grants and team mappings.",
    sources: ["slack_channel_grants", "channel_team_mappings"],
    orphanObjectTypes: ["slack_channel", "agent", "tool", "mcp_server"],
  },
  {
    id: "webex",
    label: "Webex",
    description: "Webex space resource grants and team mappings.",
    sources: ["webex_space_grants", "webex_space_team_mappings"],
    orphanObjectTypes: ["webex_space", "agent", "tool", "mcp_server"],
  },
  {
    id: "credentials",
    label: "Credentials",
    description: "Credential owner and shared-team grants.",
    sources: ["credential_secret_refs.owner", "credential_secret_refs.sharedWithTeams"],
    orphanObjectTypes: ["secret_ref"],
  },
  {
    id: "conversations",
    label: "Conversations",
    description: "Conversation user, team, and service-account sharing grants.",
    sources: ["sharing_access", "conversations.created_by_service_account", "conversations.sharing.shared_with_teams"],
    orphanObjectTypes: ["conversation"],
  },
  {
    id: "orphan_review",
    label: "Unowned tuples",
    description: "Live OpenFGA grants that no current source-of-truth record owns. Review before revoking.",
    sources: [],
    orphanObjectTypes: [
      "agent",
      "conversation",
      "llm_model",
      "mcp_gateway",
      "mcp_server",
      "organization",
      "secret_ref",
      "service_account",
      "slack_channel",
      "team",
      "tool",
      "webex_space",
    ],
  },
];

export const RBAC_SELF_CHECK_IDS = RBAC_SELF_CHECKS.map((check) => check.id);

const CHECK_BY_ID = new Map<RbacSelfCheckId, RbacSelfCheckDefinition>(
  RBAC_SELF_CHECKS.map((check) => [check.id, check]),
);

export function normalizeRbacSelfCheckIds(values?: string[]): RbacSelfCheckId[] {
  if (!values || values.length === 0) return [...RBAC_SELF_CHECK_IDS];
  const selected = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is RbacSelfCheckId => CHECK_BY_ID.has(value as RbacSelfCheckId));
  return selected.length > 0 ? Array.from(new Set(selected)) : [...RBAC_SELF_CHECK_IDS];
}

export function rbacSelfCheckDefinitionsFor(values?: string[]): RbacSelfCheckDefinition[] {
  const ids = normalizeRbacSelfCheckIds(values);
  return ids.map((id) => CHECK_BY_ID.get(id)).filter((check): check is RbacSelfCheckDefinition => Boolean(check));
}
