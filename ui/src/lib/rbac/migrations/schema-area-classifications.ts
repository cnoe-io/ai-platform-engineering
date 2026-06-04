export type SchemaAreaClassification = "migration" | "baseline_v1" | "metadata" | "intentionally_unversioned";

export interface SchemaAreaClassificationEntry {
  classification: SchemaAreaClassification;
  description: string;
}

export const SCHEMA_AREA_CLASSIFICATIONS: Record<string, SchemaAreaClassificationEntry> = {
  admin_surfaces: {
    classification: "migration",
    description:
      "Org-admin manager grants on admin_surface:* objects (e.g. admin_surface:rag_datasources, admin_surface:slack). The `admin_surface_rag_datasources_admin_grant_v1` and `admin_surface_slack_admin_grant_v1` migrations backfill these tuples for every existing org admin.",
  },
  agent_skills: {
    classification: "baseline_v1",
    description: "Skill catalog/config records; start at v1 unless a future data migration is registered.",
  },
  audit_events: {
    classification: "migration",
    description: "RBAC index migration target.",
  },
  channel_team_mappings: {
    classification: "baseline_v1",
    description: "Slack channel team mapping metadata.",
  },
  checkpoint_writes_conversation: {
    classification: "baseline_v1",
    description: "Conversation checkpoint write records.",
  },
  checkpoints_conversation: {
    classification: "baseline_v1",
    description: "Conversation checkpoint records.",
  },
  conversation_bookmarks: {
    classification: "baseline_v1",
    description: "Conversation bookmark records.",
  },
  conversations: {
    classification: "migration",
    description: "Conversation owner identity migration target.",
  },
  data_schema_versions: {
    classification: "metadata",
    description: "Schema-version control table.",
  },
  dynamic_agents: {
    classification: "migration",
    description: "Dynamic Agent OpenFGA tool and organization-admin migration target.",
  },
  feedback: {
    classification: "baseline_v1",
    description: "User feedback records.",
  },
  hub_skills: {
    classification: "baseline_v1",
    description: "Skill hub indexed skill records.",
  },
  keycloak_rbac_mappings: {
    classification: "migration",
    description: "Keycloak RBAC reconciliation migration target.",
  },
  legacy_runtime_cleanup: {
    classification: "migration",
    description:
      "0.6.0 post supervisor/A2A removal cleanup: drops orphaned checkpoint collections and strips dead agent_version/model_used/a2a_events fields. Not backed by a single collection — a virtual schema area tracked only by the migration framework.",
  },
  llm_models: {
    classification: "baseline_v1",
    description: "LLM model configuration records.",
  },
  mcp_servers: {
    classification: "baseline_v1",
    description: "MCP server configuration records.",
  },
  messages: {
    classification: "baseline_v1",
    description: "Chat message records.",
  },
  messaging_rebac_indexes: {
    classification: "migration",
    description: "Messaging ReBAC index migration target.",
  },
  messaging_team_mappings: {
    classification: "migration",
    description: "Slack/Webex team mapping reconciliation target.",
  },
  messaging_team_visibility: {
    classification: "migration",
    description:
      "Slack/Webex team→channel|space OpenFGA visibility-tuple backfill target.",
  },
  migration_manifest: {
    classification: "metadata",
    description: "DB-managed runtime migration manifest.",
  },
  migration_overrides: {
    classification: "metadata",
    description: "Temporary migration override control table.",
  },
  nps_campaigns: {
    classification: "baseline_v1",
    description: "NPS campaign records.",
  },
  nps_responses: {
    classification: "baseline_v1",
    description: "NPS response records.",
  },
  openfga_tuples: {
    classification: "migration",
    description:
      "OpenFGA tuple backfill target. The `data_source_grants_backfill_v1` and `mcp_tool_grants_backfill_v1` migrations mirror existing `knowledge_base:<id>` tuples onto the new `data_source:<id>` type and derive `mcp_tool:<id>` tuples from Mongo `team_rag_tools`.",
  },
  organization_membership: {
    classification: "migration",
    description: "Organization membership migration target.",
  },
  platform_config: {
    classification: "baseline_v1",
    description: "Platform settings records.",
  },
  policies: {
    classification: "baseline_v1",
    description: "Policy records.",
  },
  rebac_relationships: {
    classification: "baseline_v1",
    description: "Universal ReBAC relationship provenance records.",
  },
  schema_migrations: {
    classification: "metadata",
    description: "Migration run history.",
  },
  sharing_access: {
    classification: "baseline_v1",
    description: "Conversation sharing access records.",
  },
  skill_hubs: {
    classification: "migration",
    description: "Skill Hub source records and team-grant backfill migration target.",
  },
  slack_channel_agent_routes: {
    classification: "baseline_v1",
    description: "Slack channel agent route metadata.",
  },
  slack_channel_grants: {
    classification: "migration",
    description: "Slack channel ReBAC grants migration source/target area.",
  },
  slack_channel_rebac: {
    classification: "migration",
    description: "Slack channel ReBAC migration target.",
  },
  slack_link_nonces: {
    classification: "metadata",
    description: "Short-lived Slack account-linking nonce records.",
  },
  slack_user_metrics: {
    classification: "baseline_v1",
    description: "Slack user linkage metrics.",
  },
  team_kb_ownership: {
    classification: "migration",
    description:
      "Team knowledge base ownership records. The `knowledge_base_shared_team_grants_backfill_v1` migration writes the canonical OpenFGA team↔KB tuples for every existing row.",
  },
  team_membership_sources: {
    classification: "baseline_v1",
    description: "Team membership provenance records.",
  },
  team_rag_tools: {
    classification: "baseline_v1",
    description: "Team RAG tool records.",
  },
  team_resources: {
    classification: "migration",
    description: "Universal team-resource OpenFGA backfill migration target.",
  },
  teams: {
    classification: "baseline_v1",
    description: "Team records.",
  },
  turns: {
    classification: "baseline_v1",
    description: "Chat turn records.",
  },
  user_settings: {
    classification: "baseline_v1",
    description: "User preference records.",
  },
  users: {
    classification: "baseline_v1",
    description: "User identity records.",
  },
  webex_link_nonces: {
    classification: "metadata",
    description: "Short-lived Webex account-linking nonce records.",
  },
  webex_space_agent_routes: {
    classification: "baseline_v1",
    description: "Webex space agent route metadata.",
  },
  webex_space_grants: {
    classification: "migration",
    description: "Webex space ReBAC grants migration source/target area.",
  },
  webex_space_rebac: {
    classification: "migration",
    description: "Webex space ReBAC migration target.",
  },
  webex_space_team_mappings: {
    classification: "baseline_v1",
    description: "Webex space team mapping metadata.",
  },
  webex_user_metrics: {
    classification: "baseline_v1",
    description: "Webex user linkage metrics.",
  },
  workflow_configs: {
    classification: "baseline_v1",
    description: "Workflow configuration records.",
  },
  workflow_runs: {
    classification: "baseline_v1",
    description: "Workflow run records.",
  },
};

export function getUnclassifiedSchemaAreas(schemaAreas: Iterable<string>): string[] {
  return Array.from(new Set(schemaAreas))
    .filter((schemaArea) => !schemaArea.startsWith("system."))
    .filter((schemaArea) => !SCHEMA_AREA_CLASSIFICATIONS[schemaArea])
    .sort((left, right) => left.localeCompare(right));
}
