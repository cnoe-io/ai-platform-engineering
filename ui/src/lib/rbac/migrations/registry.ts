import { connectToDatabase, getCollection } from "@/lib/mongodb";
import {
  applyKeycloakRbacReconciliationMigration,
  KEYCLOAK_RBAC_MIGRATION_DEFINITION,
  KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID,
  planKeycloakRbacReconciliationMigration,
} from "@/lib/rbac/keycloak-rbac-reconciliation";
import { readOpenFgaTuples, writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { slackChannelTeamVisibilityRelationships } from "@/lib/rbac/slack-channel-rebac";
import { webexSpaceTeamVisibilityRelationships } from "@/lib/rbac/webex-space-rebac";
import { buildUniversalRebacTupleDiff } from "@/lib/rbac/tuple-builders";
import type { UniversalRebacRelationship } from "@/types/rbac-universal";

import {
  applyConversationOwnerIdentityMigration,
  CONVERSATION_OWNER_IDENTITY_CONFIRMATION,
  CONVERSATION_OWNER_IDENTITY_MIGRATION_ID,
  deriveConversationOwnerIdentityPlan,
} from "./conversation-owner-identity";
export {
  getUnclassifiedSchemaAreas,
  SCHEMA_AREA_CLASSIFICATIONS,
  type SchemaAreaClassification,
  type SchemaAreaClassificationEntry,
} from "./schema-area-classifications";
import type {
  MigrationApplyResult,
  MigrationBlockingStatus,
  MigrationDefinition,
  MigrationListItem,
  MigrationListResult,
  MigrationPlanResult,
  MigrationSchemaVersionStatus,
  SchemaVersionBootstrapApplyResult,
  SchemaVersionBootstrapPlanResult,
} from "./types";

export const RELEASE_051 = "0.5.1";
export const SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION = "INITIALIZE SCHEMA VERSIONS TO v1";
export const SCHEMA_VERSION_BOOTSTRAP_MIGRATION_ID = "schema_version_bootstrap_v1";
const UNIVERSAL_REBAC_MIGRATION_ID = "universal_rebac_relationship_backfill_v1";
const ORGANIZATION_MEMBERSHIP_MIGRATION_ID = "organization_membership_backfill_v1";
const SKILL_HUB_TEAM_GRANTS_MIGRATION_ID = "skill_hub_team_grants_backfill_v1";
const AGENT_TOOL_MIGRATION_ID = "agent_tool_openfga_backfill_v1";
export const AGENT_ORG_ADMIN_MIGRATION_ID = "agent_org_admin_inheritance_v1";
// assisted-by Cursor Claude:claude-opus-4-7
// Backfills the OpenFGA tuples implied by every existing agent's
// `shared_with_teams` field. Until 2026-05-27 the Agent editor stored
// shared teams in Mongo only — no `team:<slug>#member can_use agent:<id>`
// tuples were ever written — so the multi-select silently denied access in
// DMs (which evaluate `user:<sub> can_use agent:<id>` and only fall back
// to a team-union check against EXISTING tuples). This migration walks
// the dynamic_agents collection, resolves each shared entry (legacy
// Mongo `_id` OR slug) against the teams collection, and writes the
// canonical team-member/team-admin tuple pair for every resolved slug.
// Idempotent — re-running it is safe and a no-op when nothing changed.
export const AGENT_SHARED_TEAM_GRANTS_MIGRATION_ID = "agent_shared_team_grants_backfill_v1";
// assisted-by Cursor Claude:claude-opus-4-7
// Adds `rag_datasources` to PRIVILEGED_ADMIN_SURFACES, but every
// previously-bootstrapped org-admin in OpenFGA still lacks the matching
// `user:<sub> manager admin_surface:rag_datasources` tuple. The `rag` +
// `admin` short-circuit in `api-middleware.ts` resolves that tuple via
// model inheritance from `organization#admin`, but writing it explicitly
// makes the org-admin super-grant on KB/Search/Data Sources/Graph/MCP
// fail-safe instead of inheritance-dependent. Idempotent — re-running
// it writes the same tuples and OpenFGA no-ops on identical writes.
export const ADMIN_SURFACE_RAG_DATASOURCES_ADMIN_GRANT_MIGRATION_ID =
  "admin_surface_rag_datasources_admin_grant_v1";
// Walks every existing `team_kb_ownership` doc and writes the canonical
// `team:<slug>#member reader`, `team:<slug>#member ingestor`, and
// `team:<slug>#admin manager knowledge_base:<id>` tuples for every
// (team, kb) row. Catches up KBs that were granted to a team via the
// Settings → Knowledge Bases UI before explicit Share-with-Teams
// reconciliation existed. Idempotent.
export const KNOWLEDGE_BASE_SHARED_TEAM_GRANTS_MIGRATION_ID =
  "knowledge_base_shared_team_grants_backfill_v1";
// `data_source_grants_backfill_v1` mirrors every existing
// `knowledge_base:<id>` tuple in OpenFGA as a `data_source:<id>`
// tuple, so day-zero behavior of "if you can read the KB you can read
// its data source" is preserved when the new type is introduced.
// Strictly additive — no deletes are ever planned by this migration.
// See [docs/docs/security/rbac/architecture.md] for the policy and
// rollout sequence.
// assisted-by Cursor claude-opus-4-7
export const DATA_SOURCE_GRANTS_BACKFILL_MIGRATION_ID =
  "data_source_grants_backfill_v1";
// `mcp_tool_grants_backfill_v1` walks Mongo `team_rag_tools` and
// writes `team:<slug>#member reader mcp_tool:<tool_id>` (plus the
// matching `user` relation, mirroring `mcp_server` invokers). For
// teams without an explicit owner team it's a no-op — admins keep
// access via the `organization#admin → manager` model edge documented
// in [deploy/openfga/model.fga].
// assisted-by Cursor claude-opus-4-7
export const MCP_TOOL_GRANTS_BACKFILL_MIGRATION_ID =
  "mcp_tool_grants_backfill_v1";
const RBAC_INDEXES_MIGRATION_ID = "rbac_indexes_v1";
const SLACK_CHANNEL_REBAC_MIGRATION_ID = "slack_channel_rebac_backfill_v1";
const WEBEX_SPACE_REBAC_MIGRATION_ID = "webex_space_rebac_backfill_v1";
const MESSAGING_TEAM_MAPPING_MIGRATION_ID = "messaging_team_mapping_reconciliation_v1";
const MESSAGING_REBAC_INDEXES_MIGRATION_ID = "messaging_rebac_indexes_v1";
// assisted-by Cursor Claude:claude-opus-4-7
// Issue: previously-onboarded Slack channels / Webex spaces stayed invisible in
// the admin panels because no inbound team→channel (or team→space) tuples were
// ever written. The /api/admin/{slack,webex}/{channels,spaces} list routes
// filter rows by user `can_read` on the channel/space object, so with no
// inbound tuples every row got dropped. This migration backfills the missing
// `team#admin → manage → slack_channel|webex_space` and
// `team#member → read → slack_channel|webex_space` tuples derived from
// existing `channel_team_mappings` / `webex_space_team_mappings` rows. It is
// fully idempotent because writeOpenFgaTuples no-ops on identical writes.
const MESSAGING_TEAM_VISIBILITY_MIGRATION_ID = "messaging_team_visibility_v1";
const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

const ACTION_TO_BASE_RELATION: Record<string, string> = {
  discover: "reader",
  read: "reader",
  use: "user",
  write: "writer",
  create: "owner",
  delete: "manager",
  manage: "manager",
  administer: "manager",
  audit: "auditor",
  approve: "approver",
  share: "sharer",
  call: "caller",
  invoke: "invoker",
  map: "manager",
  ingest: "ingestor",
  "read-metadata": "metadata_reader",
};

export const MIGRATION_DEFINITIONS: MigrationDefinition[] = [
  {
    id: CONVERSATION_OWNER_IDENTITY_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "conversations",
    from_version: 1,
    to_version: 2,
    kind: "implicit",
    title: "Conversation owner identity v2",
    description:
      "Normalize legacy email-owned conversations with owner_subject without creating per-conversation owner tuples.",
    confirmation: CONVERSATION_OWNER_IDENTITY_CONFIRMATION,
    required: true,
    implemented: true,
  },
  {
    id: ORGANIZATION_MEMBERSHIP_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "organization_membership",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Organization membership backfill",
    description:
      "Grant existing linked users organization membership so baseline supervisor, RAG, and chat access survive the OpenFGA cutover.",
    confirmation: "MIGRATE organization_membership TO v2",
    required: true,
    implemented: true,
    dependencies: [CONVERSATION_OWNER_IDENTITY_MIGRATION_ID],
  },
  {
    id: "universal_rebac_relationship_backfill_v1",
    release: RELEASE_051,
    schema_area: "team_resources",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Universal ReBAC team resources",
    description: "Expose the existing universal team/resource OpenFGA backfill through the migration surface.",
    confirmation: "MIGRATE team_resources TO v2",
    required: true,
    implemented: true,
    dependencies: [CONVERSATION_OWNER_IDENTITY_MIGRATION_ID],
  },
  {
    id: SKILL_HUB_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "skill_hubs",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Skill Hub team grants",
    description:
      "Grant selected teams use access to already-crawled Skill Hub skills based on each hub's shared_with_teams policy.",
    confirmation: "MIGRATE skill_hubs TO v2",
    required: true,
    implemented: true,
    dependencies: [UNIVERSAL_REBAC_MIGRATION_ID],
  },
  {
    id: "agent_tool_openfga_backfill_v1",
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Dynamic Agent tool tuples",
    description: "Reconcile allowed_tools into agent caller tool OpenFGA tuples.",
    confirmation: "MIGRATE dynamic_agents TO v2",
    required: true,
    implemented: true,
  },
  {
    id: AGENT_ORG_ADMIN_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    from_version: 2,
    to_version: 3,
    kind: "explicit",
    title: "Dynamic Agent organization admin inheritance",
    description: "Backfill organization-admin manager tuples so platform admins inherit Dynamic Agent management.",
    confirmation: "MIGRATE dynamic_agents TO v3",
    required: true,
    implemented: true,
    dependencies: [AGENT_TOOL_MIGRATION_ID],
  },
  {
    id: AGENT_SHARED_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    from_version: 3,
    to_version: 4,
    kind: "explicit",
    title: "Dynamic Agent shared-team grants",
    description:
      "Backfill OpenFGA team#member→can_use and team#admin→can_manage tuples for every dynamic agent's shared_with_teams field. Before 2026-05-27 the Agent editor wrote shared teams to Mongo only, so the multi-select silently denied DM access.",
    confirmation: "MIGRATE dynamic_agents TO v4",
    required: true,
    implemented: true,
    dependencies: [AGENT_ORG_ADMIN_MIGRATION_ID],
  },
  {
    id: ADMIN_SURFACE_RAG_DATASOURCES_ADMIN_GRANT_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "admin_surfaces",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "rag_datasources admin-surface manager grant",
    description:
      "Backfill `user:<sub> manager admin_surface:rag_datasources` for every existing org admin so the org-admin super-grant on KB/Search/Data Sources/Graph/MCP Tools no longer relies solely on OpenFGA model inheritance.",
    confirmation: "MIGRATE admin_surfaces TO v2",
    required: true,
    implemented: true,
  },
  {
    id: KNOWLEDGE_BASE_SHARED_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "team_kb_ownership",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Knowledge Base team-share grants backfill",
    description:
      "Walks every `team_kb_ownership` Mongo doc and writes the canonical `team:<slug>#member reader knowledge_base:<id>`, `team:<slug>#member ingestor knowledge_base:<id>`, and `team:<slug>#admin manager knowledge_base:<id>` tuples so any KB granted to a team via Settings → Knowledge Bases keeps its access after the explicit Share-with-Teams panel ships. Idempotent.",
    confirmation: "MIGRATE team_kb_ownership TO v2",
    required: true,
    implemented: true,
  },
  {
    id: DATA_SOURCE_GRANTS_BACKFILL_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "openfga_tuples",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "data_source grants backfill",
    description:
      "Mirrors every existing `knowledge_base:<id>` tuple in OpenFGA as a parallel `data_source:<id>` tuple. Preserves day-zero behavior — anyone who can read the KB can read its data source — without requiring users to re-share their KBs after the new `data_source` type is introduced. Strictly additive.",
    confirmation: "MIGRATE openfga_tuples TO data_source_v1",
    required: true,
    implemented: true,
  },
  {
    id: MCP_TOOL_GRANTS_BACKFILL_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "team_rag_tools",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "mcp_tool grants backfill",
    description:
      "Walks Mongo `team_rag_tools` and writes the canonical `team:<slug>#member reader mcp_tool:<tool_id>` + `team:<slug>#member user mcp_tool:<tool_id>` + `team:<slug>#admin manager mcp_tool:<tool_id>` tuples so every team that already owned a RAG custom MCP tool keeps access through the BFF's per-tool filter. Idempotent.",
    confirmation: "MIGRATE team_rag_tools TO mcp_tool_v1",
    required: true,
    implemented: true,
  },
  {
    id: "rbac_indexes_v1",
    release: RELEASE_051,
    schema_area: "audit_events",
    from_version: 1,
    to_version: 2,
    kind: "index",
    title: "RBAC audit and migration indexes",
    description: "Ensure RBAC audit, schema migration, and provenance indexes exist.",
    confirmation: "MIGRATE audit_events TO v2",
    required: true,
    implemented: true,
  },
  {
    id: SLACK_CHANNEL_REBAC_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "slack_channel_rebac",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Slack channel ReBAC grants",
    description: "Backfill Slack channel resource grants and route-owned agent grants into OpenFGA provenance.",
    confirmation: "MIGRATE slack_channel_rebac TO v2",
    required: true,
    implemented: true,
  },
  {
    id: WEBEX_SPACE_REBAC_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "webex_space_rebac",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Webex space ReBAC grants",
    description: "Backfill Webex space resource grants and route-owned agent grants into OpenFGA provenance.",
    confirmation: "MIGRATE webex_space_rebac TO v2",
    required: true,
    implemented: true,
  },
  {
    id: MESSAGING_TEAM_MAPPING_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_team_mappings",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Messaging team mapping reconciliation",
    description: "Reconcile Slack channel and Webex space team mappings into denormalized team documents.",
    confirmation: "MIGRATE messaging_team_mappings TO v2",
    required: true,
    implemented: true,
  },
  {
    id: MESSAGING_REBAC_INDEXES_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_rebac_indexes",
    from_version: 1,
    to_version: 2,
    kind: "index",
    title: "Messaging ReBAC indexes",
    description: "Ensure Webex messaging ReBAC collections have lookup and TTL indexes matching Slack coverage.",
    confirmation: "MIGRATE messaging_rebac_indexes TO v2",
    required: true,
    implemented: true,
  },
  {
    id: MESSAGING_TEAM_VISIBILITY_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_team_visibility",
    from_version: 1,
    to_version: 2,
    kind: "explicit",
    title: "Messaging team→channel/space visibility",
    description:
      "Backfill team#admin→manage and team#member→read tuples onto previously-onboarded Slack channels and Webex spaces so admins can actually see them in the listing endpoints.",
    confirmation: "MIGRATE messaging_team_visibility TO v2",
    required: true,
    implemented: true,
  },
  KEYCLOAK_RBAC_MIGRATION_DEFINITION,
];

interface SchemaVersionDoc {
  _id: string;
  version?: number;
  last_migration_id?: string;
}

interface SchemaMigrationDoc {
  _id: string;
  status?: MigrationListItem["status"];
  completed_at?: string;
  updated_at?: string;
}

interface MigrationManifestDoc extends MigrationDefinition {
  _id: string;
  migration_id?: string;
  blocking?: boolean;
  registered_at?: string;
  updated_at?: string;
}

interface MigrationOverrideDoc {
  _id: string;
  release: string;
  reason?: string;
  status?: "active" | "revoked";
  expires_at?: string;
}

interface MigrationRuntimePlan extends MigrationPlanResult {
  tuples?: OpenFgaTupleKey[];
  relationships?: Array<{
    subject: { type: string; id: string; relation?: string };
    action: string;
    resource: { type: string; id: string };
  }>;
  membershipSources?: Array<{
    team_slug: string;
    user_email: string;
    user_subject: string;
    relationship: "member" | "admin";
  }>;
  indexes?: Array<{ collection: string; keys: Record<string, 1 | -1>; options?: Record<string, unknown> }>;
  teamMappingRepairs?: Array<{
    team_id: string;
    slack_channel?: {
      slack_channel_id: string;
      channel_name: string;
      slack_workspace_id?: string;
    };
    webex_space?: {
      space_id: string;
      space_name: string;
      workspace_id?: string;
    };
  }>;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function isOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

function uniqueTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

function userSubject(user: Record<string, any>): string | null {
  return (
    normalizeString(user.keycloak_sub) ??
    normalizeString(user.metadata?.keycloak_sub) ??
    normalizeString(user.subject) ??
    normalizeString(user.sub) ??
    normalizeString(user.metadata?.sso_id)
  );
}

function buildEmailSubjectIndex(users: Array<Record<string, any>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const user of users) {
    const email = normalizeEmail(user.email);
    const subject = userSubject(user);
    if (email && subject && isOpenFgaId(subject)) out.set(email, subject);
  }
  return out;
}

function addRelationship(
  relationships: NonNullable<MigrationRuntimePlan["relationships"]>,
  subject: { type: string; id: string; relation?: string },
  action: string,
  resource: { type: string; id: string },
): void {
  relationships.push({ subject, action, resource });
}

function deriveUniversalRebacPlan(input: {
  teams: Array<Record<string, any>>;
  users: Array<Record<string, any>>;
  dynamicAgents: Array<Record<string, any>>;
  platformConfig: Record<string, any> | null;
}): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const relationships: NonNullable<MigrationRuntimePlan["relationships"]> = [];
  const membershipSources: NonNullable<MigrationRuntimePlan["membershipSources"]> = [];
  const warnings: string[] = [];
  const emailSubjects = buildEmailSubjectIndex(input.users);
  let invalidIdentifiers = 0;
  let unmappedUsers = 0;

  for (const team of input.teams) {
    const slug = normalizeString(team.slug);
    if (!slug || !isOpenFgaId(slug)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping team with invalid slug: ${String(team.slug ?? team._id)}`);
      continue;
    }

    // Historic universal-rebac migration: reads legacy team.members[] to seed
    // team_membership_sources for clusters upgrading from < 0.5.1. After the
    // canonical-team-membership refactor (spec 2026-05-26), live writers no
    // longer populate this array, but this code path must remain for legacy
    // upgrade paths and is harmless on already-canonical clusters (the array
    // is undefined, so the loop is empty).
    for (const member of team.members ?? []) {
      const email = normalizeEmail(member.user_id);
      const subject = email ? emailSubjects.get(email) ?? email : null;
      if (!email || !subject || !isOpenFgaId(subject)) {
        unmappedUsers += 1;
        warnings.push(`Skipping team ${slug} member with unmapped or invalid subject.`);
        continue;
      }
      const relationship = member.role === "admin" || member.role === "owner" ? "admin" : "member";
      tuples.push({ user: `user:${subject}`, relation: relationship, object: `team:${slug}` });
      membershipSources.push({ team_slug: slug, user_email: email, user_subject: subject, relationship });
    }

    const grants: Array<{
      ids?: string[];
      subjectRelation: "member" | "admin";
      tupleRelation: string;
      resourceType: "agent" | "tool" | "knowledge_base" | "skill" | "task";
      action: string;
    }> = [
      { ids: team.resources?.agents, subjectRelation: "member", tupleRelation: "user", resourceType: "agent", action: "use" },
      { ids: team.resources?.agent_admins, subjectRelation: "admin", tupleRelation: "manager", resourceType: "agent", action: "manage" },
      { ids: team.resources?.tools, subjectRelation: "member", tupleRelation: "caller", resourceType: "tool", action: "call" },
      { ids: team.resources?.knowledge_bases, subjectRelation: "member", tupleRelation: "reader", resourceType: "knowledge_base", action: "read" },
      { ids: team.resources?.skills, subjectRelation: "member", tupleRelation: "user", resourceType: "skill", action: "use" },
      { ids: team.resources?.tasks, subjectRelation: "member", tupleRelation: "user", resourceType: "task", action: "use" },
    ];

    for (const grant of grants) {
      for (const rawId of grant.ids ?? []) {
        const id = normalizeString(rawId);
        if (!id || !isOpenFgaId(id)) {
          invalidIdentifiers += 1;
          warnings.push(`Skipping ${grant.resourceType} grant for team ${slug}: invalid id ${String(rawId)}`);
          continue;
        }
        tuples.push({
          user: `team:${slug}#${grant.subjectRelation}`,
          relation: grant.tupleRelation,
          object: `${grant.resourceType}:${id}`,
        });
        addRelationship(relationships, { type: "team", id: slug, relation: grant.subjectRelation }, grant.action, {
          type: grant.resourceType,
          id,
        });
      }
    }
  }

  const defaultAgentId = normalizeString(input.platformConfig?.default_agent_id);
  const dynamicAgentIds = new Set(input.dynamicAgents.map((agent) => normalizeString(agent.id) ?? normalizeString(agent._id)).filter(Boolean));
  if (defaultAgentId && isOpenFgaId(defaultAgentId) && dynamicAgentIds.has(defaultAgentId)) {
    tuples.push({ user: "user:*", relation: "user", object: `agent:${defaultAgentId}` });
    addRelationship(relationships, { type: "user", id: "*", relation: "typed_wildcard" }, "use", {
      type: "agent",
      id: defaultAgentId,
    });
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: UNIVERSAL_REBAC_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "team_resources",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      teams_scanned: input.teams.length,
      tuples_planned: unique.length,
      relationships_planned: relationships.length,
      membership_sources_planned: membershipSources.length,
      invalid_identifiers: invalidIdentifiers,
      unmapped_users: unmappedUsers,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${UNIVERSAL_REBAC_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE team_resources TO v2",
    tuples: unique,
    relationships,
    membershipSources,
  };
}

export function deriveOrganizationMembershipPlan(
  users: Array<Record<string, any>>,
  organizationId = caipeOrgKey(),
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let usersWithSubjects = 0;
  let invalidSubjects = 0;
  let missingSubjects = 0;

  for (const user of users) {
    const subject = userSubject(user);
    if (!subject) {
      missingSubjects += 1;
      warnings.push(`Skipping user without keycloak subject: ${String(user.email ?? user._id ?? "unknown")}`);
      continue;
    }
    if (!isOpenFgaId(subject)) {
      invalidSubjects += 1;
      warnings.push(`Skipping user with invalid OpenFGA subject: ${String(user.email ?? user._id ?? subject)}`);
      continue;
    }
    usersWithSubjects += 1;
    tuples.push({
      user: `user:${subject}`,
      relation: "member",
      object: `organization:${organizationId}`,
    });
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: ORGANIZATION_MEMBERSHIP_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "organization_membership",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      users_scanned: users.length,
      users_with_subjects: usersWithSubjects,
      tuples_planned: unique.length,
      invalid_subjects: invalidSubjects,
      missing_subjects: missingSubjects,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${ORGANIZATION_MEMBERSHIP_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE organization_membership TO v2",
    tuples: unique,
  };
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function mongoId(doc: Record<string, any>): string | null {
  if (!doc._id) return null;
  if (typeof doc._id?.toHexString === "function") return doc._id.toHexString();
  return String(doc._id);
}

export function deriveSkillHubTeamGrantPlan(input: {
  hubs: Array<Record<string, any>>;
  hubSkills: Array<Record<string, any>>;
  teams: Array<Record<string, any>>;
}): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  const skillIdsByHub = new Map<string, string[]>();
  const teamSlugByRef = new Map<string, string>();

  for (const team of input.teams) {
    const slug = typeof team.slug === "string" ? team.slug.trim() : "";
    if (!slug) continue;
    const id = mongoId(team);
    if (id) teamSlugByRef.set(id, slug);
    teamSlugByRef.set(slug, slug);
  }

  for (const skill of input.hubSkills) {
    const hubId = String(skill.hub_id ?? "").trim();
    const skillId = String(skill.skill_id ?? "").trim();
    if (!hubId || !skillId) {
      warnings.push(`Skipping hub skill with missing hub_id or skill_id: ${String(skill.name ?? skill._id ?? "unknown")}`);
      continue;
    }
    const existing = skillIdsByHub.get(hubId) ?? [];
    existing.push(skillId);
    skillIdsByHub.set(hubId, existing);
  }

  let hubsWithTeamGrants = 0;
  let hubsWithoutCachedSkills = 0;
  let invalidIdentifiers = 0;

  for (const hub of input.hubs) {
    const hubId = String(hub.id ?? "").trim();
    if (!hubId) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping skill hub without id: ${String(hub.location ?? hub._id ?? "unknown")}`);
      continue;
    }

    const teamSlugs = normalizeStringArray(hub.shared_with_teams)
      .map((teamRef) => teamSlugByRef.get(teamRef) ?? teamRef)
      .filter((teamSlug) => {
        if (isOpenFgaId(teamSlug)) return true;
        invalidIdentifiers += 1;
        warnings.push(`Skipping skill hub ${hubId} team with invalid OpenFGA id: ${teamSlug}`);
        return false;
      });
    if (teamSlugs.length === 0) continue;

    const hubSkillIds = skillIdsByHub.get(hubId) ?? [];
    if (hubSkillIds.length === 0) {
      hubsWithoutCachedSkills += 1;
      warnings.push(`Skill hub ${hubId} has team grants but no cached hub_skills rows.`);
      continue;
    }

    hubsWithTeamGrants += 1;
    for (const teamSlug of teamSlugs) {
      for (const skillId of hubSkillIds) {
        const catalogSkillId = `hub-${hubId}-${skillId}`;
        if (!isOpenFgaId(catalogSkillId)) {
          invalidIdentifiers += 1;
          warnings.push(`Skipping invalid Skill Hub catalog skill id: ${catalogSkillId}`);
          continue;
        }
        tuples.push({
          user: `team:${teamSlug}#member`,
          relation: "user",
          object: `skill:${catalogSkillId}`,
        });
      }
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: SKILL_HUB_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "skill_hubs",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      hubs_scanned: input.hubs.length,
      hubs_with_team_grants: hubsWithTeamGrants,
      hubs_without_cached_skills: hubsWithoutCachedSkills,
      hub_skills_scanned: input.hubSkills.length,
      teams_scanned: input.teams.length,
      tuples_planned: unique.length,
      invalid_identifiers: invalidIdentifiers,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${SKILL_HUB_TEAM_GRANTS_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE skill_hubs TO v2",
    tuples: unique,
  };
}

function deriveAgentToolPlan(agents: Array<Record<string, any>>): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let agentsWithTools = 0;
  let invalidIdentifiers = 0;

  for (const agent of agents) {
    const agentId = normalizeString(agent.id) ?? normalizeString(agent._id);
    if (!agentId || !isOpenFgaId(agentId)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping dynamic agent with invalid id: ${String(agent.id ?? agent._id)}`);
      continue;
    }
    const allowedTools = agent.allowed_tools ?? {};
    if (Object.keys(allowedTools).length > 0) agentsWithTools += 1;
    for (const [serverId, tools] of Object.entries(allowedTools)) {
      if (!isOpenFgaId(serverId)) {
        invalidIdentifiers += 1;
        warnings.push(`Skipping invalid MCP server id for agent ${agentId}: ${serverId}`);
        continue;
      }
      const toolNames = Array.isArray(tools) && tools.length > 0 ? tools : ["*"];
      for (const toolName of toolNames) {
        if (typeof toolName !== "string" || (toolName !== "*" && !isOpenFgaId(toolName))) {
          invalidIdentifiers += 1;
          warnings.push(`Skipping invalid tool id for agent ${agentId}/${serverId}: ${String(toolName)}`);
          continue;
        }
        tuples.push({ user: `agent:${agentId}`, relation: "caller", object: `tool:${serverId}/${toolName}` });
      }
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: AGENT_TOOL_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      agents_scanned: agents.length,
      agents_with_tools: agentsWithTools,
      tuples_planned: unique.length,
      invalid_identifiers: invalidIdentifiers,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${AGENT_TOOL_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE dynamic_agents TO v2",
    tuples: unique,
  };
}

export function deriveAgentOrganizationInheritancePlan(
  agents: Array<Record<string, any>>,
  organizationId = caipeOrgKey(),
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let invalidIdentifiers = 0;

  for (const agent of agents) {
    const agentId = normalizeString(agent.id) ?? normalizeString(agent._id);
    if (!agentId || !isOpenFgaId(agentId)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping dynamic agent with invalid id: ${String(agent.id ?? agent._id)}`);
      continue;
    }
    tuples.push({
      user: `organization:${organizationId}#admin`,
      relation: "manager",
      object: `agent:${agentId}`,
    });
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: AGENT_ORG_ADMIN_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    kind: "explicit",
    from_version: 2,
    to_version: 3,
    counts: {
      agents_scanned: agents.length,
      tuples_planned: unique.length,
      invalid_identifiers: invalidIdentifiers,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${AGENT_ORG_ADMIN_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE dynamic_agents TO v3",
    tuples: unique,
  };
}

/**
 * Derive `team:<slug>#member can_use agent:<id>` and
 * `team:<slug>#admin can_manage agent:<id>` tuples for every shared
 * team on every existing dynamic agent.
 *
 * Inputs:
 *  - `agents`: full dynamic_agents collection. Reads `shared_with_teams`
 *    (legacy: array of Mongo `_id` strings; modern: array of canonical
 *    slugs) and `owner_team_slug`. The owner team's tuples are
 *    intentionally *not* written here — `agent_org_admin_inheritance_v1`
 *    and the original `agent_tool_openfga_backfill_v1` already cover
 *    that — so this migration is strictly additive for the shared
 *    multi-select.
 *  - `teams`: full teams collection (id + slug). Used to translate any
 *    legacy `_id` references back to the canonical slug.
 *
 * Idempotent: re-running this migration writes the same tuples a second
 * time and OpenFGA's tuple store no-ops on identical writes.
 */
export function deriveAgentSharedTeamGrantsPlan(
  agents: Array<Record<string, any>>,
  teams: Array<Record<string, any>>,
): MigrationRuntimePlan {
  const slugById = new Map<string, string>();
  const knownSlugs = new Set<string>();
  for (const team of teams) {
    const slug = normalizeString(team.slug);
    if (!slug || !isOpenFgaId(slug)) continue;
    knownSlugs.add(slug);
    const idHex = mongoId(team);
    if (idHex) slugById.set(idHex, slug);
  }

  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let agentsScanned = 0;
  let agentsWithSharedTeams = 0;
  let sharedSlugsResolved = 0;
  let unresolvedEntries = 0;

  for (const agent of agents) {
    agentsScanned += 1;
    const agentId = normalizeString(agent.id) ?? normalizeString(agent._id);
    if (!agentId || !isOpenFgaId(agentId)) {
      warnings.push(`Skipping dynamic agent with invalid id: ${String(agent.id ?? agent._id)}`);
      continue;
    }
    const rawShared = normalizeStringArray(agent.shared_with_teams);
    if (rawShared.length === 0) continue;
    agentsWithSharedTeams += 1;

    const ownerSlug = normalizeString(agent.owner_team_slug);
    const seen = new Set<string>();
    for (const entry of rawShared) {
      // Resolve legacy `_id` → slug, or accept a slug directly.
      const resolvedSlug =
        slugById.get(entry) ??
        (knownSlugs.has(entry) ? entry : null);
      if (!resolvedSlug || !isOpenFgaId(resolvedSlug)) {
        unresolvedEntries += 1;
        warnings.push(`Agent ${agentId}: shared_with_teams entry has no matching team: ${entry}`);
        continue;
      }
      // Don't double-count the owner team — the owner-team tuples are
      // written by the earlier agent_tool / agent_org_admin migrations
      // and by every live POST/PUT reconcile.
      if (ownerSlug && resolvedSlug === ownerSlug) continue;
      if (seen.has(resolvedSlug)) continue;
      seen.add(resolvedSlug);
      sharedSlugsResolved += 1;

      tuples.push({
        user: `team:${resolvedSlug}#member`,
        relation: "user",
        object: `agent:${agentId}`,
      });
      tuples.push({
        user: `team:${resolvedSlug}#admin`,
        relation: "manager",
        object: `agent:${agentId}`,
      });
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: AGENT_SHARED_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "dynamic_agents",
    kind: "explicit",
    from_version: 3,
    to_version: 4,
    counts: {
      agents_scanned: agentsScanned,
      agents_with_shared_teams: agentsWithSharedTeams,
      shared_slugs_resolved: sharedSlugsResolved,
      unresolved_entries: unresolvedEntries,
      teams_scanned: teams.length,
      tuples_planned: unique.length,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${AGENT_SHARED_TEAM_GRANTS_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE dynamic_agents TO v4",
    tuples: unique,
  };
}

/**
 * Backfill the `user:<sub> manager admin_surface:rag_datasources` tuple
 * for every existing org admin.
 *
 * Inputs:
 *  - `adminSubjects`: list of OpenFGA user subjects (no `user:` prefix)
 *    derived from the `user:<sub> admin organization:<key>` tuples in
 *    OpenFGA. Invalid subjects are skipped with a warning.
 *
 * Idempotent: re-running this migration writes the same tuples; OpenFGA's
 * tuple store no-ops on identical writes.
 */
export function deriveAdminSurfaceRagDatasourcesAdminGrantPlan(
  adminSubjects: string[],
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let invalidSubjects = 0;
  const seen = new Set<string>();

  for (const raw of adminSubjects) {
    const subject = typeof raw === "string" ? raw.trim() : "";
    if (!subject) continue;
    if (!isOpenFgaId(subject)) {
      invalidSubjects += 1;
      warnings.push(`Skipping org admin with invalid OpenFGA subject: ${raw}`);
      continue;
    }
    if (seen.has(subject)) continue;
    seen.add(subject);
    tuples.push({
      user: `user:${subject}`,
      relation: "manager",
      object: "admin_surface:rag_datasources",
    });
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: ADMIN_SURFACE_RAG_DATASOURCES_ADMIN_GRANT_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "admin_surfaces",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      admins_scanned: adminSubjects.length,
      admins_resolved: seen.size,
      tuples_planned: unique.length,
      invalid_subjects: invalidSubjects,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${ADMIN_SURFACE_RAG_DATASOURCES_ADMIN_GRANT_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE admin_surfaces TO v2",
    tuples: unique,
  };
}

/**
 * Backfill team-share grants for every KB ownership record.
 *
 * Inputs:
 *  - `ownershipDocs`: rows from the `team_kb_ownership` Mongo collection.
 *  - `teamSlugByMongoId`: map from each team's Mongo `_id` (as string) to
 *    its canonical slug. Rows whose team is unknown (or has no slug yet)
 *    are skipped with a warning so the migration is safe to re-run after
 *    a team rename.
 *
 * The migration emits the same canonical tuple set the runtime reconciler
 * writes (`reader` + `ingestor` + `manager`) for every (team, kb_id) row,
 * so first-time installs and existing deployments converge on the same
 * OpenFGA state.
 */
export function deriveKnowledgeBaseSharedTeamGrantsPlan(
  ownershipDocs: Array<Record<string, unknown>>,
  teamSlugByMongoId: Map<string, string>,
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let rowsScanned = 0;
  let rowsResolved = 0;
  let invalidKbIds = 0;
  let unresolvedTeams = 0;
  const teamsTouched = new Set<string>();

  for (const doc of ownershipDocs) {
    rowsScanned += 1;
    const teamId = typeof doc.team_id === "string" ? doc.team_id.trim() : "";
    if (!teamId) continue;
    const slug = teamSlugByMongoId.get(teamId);
    if (!slug || !isOpenFgaId(slug)) {
      unresolvedTeams += 1;
      warnings.push(`Skipping team_kb_ownership row with unresolved team_id=${teamId}`);
      continue;
    }
    const kbIdsRaw = Array.isArray(doc.kb_ids) ? doc.kb_ids : [];
    let perRowResolved = false;
    for (const candidate of kbIdsRaw) {
      const kbId = typeof candidate === "string" ? candidate.trim() : "";
      if (!kbId) continue;
      if (!isOpenFgaId(kbId)) {
        invalidKbIds += 1;
        warnings.push(`Skipping team_kb_ownership kb_id=${candidate} (not a valid OpenFGA id)`);
        continue;
      }
      tuples.push({
        user: `team:${slug}#member`,
        relation: "reader",
        object: `knowledge_base:${kbId}`,
      });
      tuples.push({
        user: `team:${slug}#member`,
        relation: "ingestor",
        object: `knowledge_base:${kbId}`,
      });
      tuples.push({
        user: `team:${slug}#admin`,
        relation: "manager",
        object: `knowledge_base:${kbId}`,
      });
      perRowResolved = true;
    }
    if (perRowResolved) {
      rowsResolved += 1;
      teamsTouched.add(slug);
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: KNOWLEDGE_BASE_SHARED_TEAM_GRANTS_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "team_kb_ownership",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      ownership_rows_scanned: rowsScanned,
      ownership_rows_resolved: rowsResolved,
      teams_touched: teamsTouched.size,
      unresolved_teams: unresolvedTeams,
      invalid_kb_ids: invalidKbIds,
      tuples_planned: unique.length,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${KNOWLEDGE_BASE_SHARED_TEAM_GRANTS_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE team_kb_ownership TO v2",
    tuples: unique,
  };
}

/**
 * Mirror existing `knowledge_base:<id>` tuples as `data_source:<id>`
 * tuples so day-zero behavior of "if you can read the KB you can read
 * its data source" is preserved when the new `data_source` type is
 * introduced.
 *
 * Input: every OpenFGA tuple whose `object` starts with
 * `knowledge_base:`. The deriver does not deduplicate against existing
 * `data_source:` tuples because write-by-tuple is already idempotent
 * in OpenFGA (writing the same tuple twice is a no-op), and the
 * migration runner runs `unique` filtering anyway. Only tuples whose
 * relation is one of the team-share relations (`reader`, `manager`,
 * `ingestor`, `owner`) are mirrored — `can_*` computed relations
 * never appear as written tuples so they're safe to ignore.
 *
 * Caller-supplied tuples must already be valid OpenFGA tuple keys;
 * this deriver does no validation beyond the relation allow-list.
 */
export function deriveDataSourceGrantsBackfillPlan(
  knowledgeBaseTuples: ReadonlyArray<OpenFgaTupleKey>,
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let scanned = 0;
  let mirrored = 0;
  const MIRRORABLE_RELATIONS = new Set([
    "owner",
    "reader",
    "ingestor",
    "manager",
  ]);

  for (const tuple of knowledgeBaseTuples) {
    scanned += 1;
    if (!tuple.object?.startsWith("knowledge_base:")) continue;
    if (!MIRRORABLE_RELATIONS.has(tuple.relation)) continue;
    const id = tuple.object.slice("knowledge_base:".length);
    if (!id || !isOpenFgaId(id)) {
      warnings.push(`Skipping knowledge_base tuple with invalid id: ${tuple.object}`);
      continue;
    }
    tuples.push({
      user: tuple.user,
      relation: tuple.relation,
      object: `data_source:${id}`,
    });
    mirrored += 1;
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: DATA_SOURCE_GRANTS_BACKFILL_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "openfga_tuples",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      tuples_scanned: scanned,
      tuples_mirrored: mirrored,
      tuples_planned: unique.length,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${DATA_SOURCE_GRANTS_BACKFILL_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE openfga_tuples TO data_source_v1",
    tuples: unique,
  };
}

/**
 * Backfill `mcp_tool:<tool_id>` grants for every Mongo `team_rag_tools`
 * row. Mirrors the runtime reconciler used by
 * `reconcileMcpToolRelationships`: the owner team's members get
 * `reader` + `user`, the owner team's admins get `manager`.
 *
 * Inputs:
 *  - `ownershipDocs`: rows from the `team_rag_tools` collection. Each
 *    is expected to have a `team_id` (Mongo id of the owning team)
 *    and a `tool_ids` array of `tool_id` strings, mirroring the
 *    `team_kb_ownership` schema.
 *  - `teamSlugByMongoId`: same `_id → slug` map as the KB backfill.
 *
 * Rows whose team is unknown or whose tool_id is not OpenFGA-safe are
 * skipped with a warning.
 */
export function deriveMcpToolGrantsBackfillPlan(
  ownershipDocs: Array<Record<string, unknown>>,
  teamSlugByMongoId: Map<string, string>,
): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const warnings: string[] = [];
  let rowsScanned = 0;
  let rowsResolved = 0;
  let invalidToolIds = 0;
  let unresolvedTeams = 0;
  const teamsTouched = new Set<string>();

  for (const doc of ownershipDocs) {
    rowsScanned += 1;
    const teamId = typeof doc.team_id === "string" ? doc.team_id.trim() : "";
    if (!teamId) continue;
    const slug = teamSlugByMongoId.get(teamId);
    if (!slug || !isOpenFgaId(slug)) {
      unresolvedTeams += 1;
      warnings.push(`Skipping team_rag_tools row with unresolved team_id=${teamId}`);
      continue;
    }
    const toolIdsRaw = Array.isArray(doc.tool_ids) ? doc.tool_ids : [];
    let perRowResolved = false;
    for (const candidate of toolIdsRaw) {
      const toolId = typeof candidate === "string" ? candidate.trim() : "";
      if (!toolId) continue;
      if (!isOpenFgaId(toolId)) {
        invalidToolIds += 1;
        warnings.push(`Skipping team_rag_tools tool_id=${candidate} (not a valid OpenFGA id)`);
        continue;
      }
      const object = `mcp_tool:${toolId}`;
      tuples.push({ user: `team:${slug}#member`, relation: "reader", object });
      tuples.push({ user: `team:${slug}#member`, relation: "user", object });
      tuples.push({ user: `team:${slug}#admin`, relation: "manager", object });
      perRowResolved = true;
    }
    if (perRowResolved) {
      rowsResolved += 1;
      teamsTouched.add(slug);
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: MCP_TOOL_GRANTS_BACKFILL_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "team_rag_tools",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      ownership_rows_scanned: rowsScanned,
      ownership_rows_resolved: rowsResolved,
      teams_touched: teamsTouched.size,
      unresolved_teams: unresolvedTeams,
      invalid_tool_ids: invalidToolIds,
      tuples_planned: unique.length,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${MCP_TOOL_GRANTS_BACKFILL_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE team_rag_tools TO mcp_tool_v1",
    tuples: unique,
  };
}

type MessagingGrantSurface = {
  migrationId: string;
  schemaArea: string;
  confirmation: string;
  subjectType: "slack_channel" | "webex_space";
  idField: "channel_id" | "space_id";
  routeIdField: "channel_id" | "space_id";
};

function relationshipForAction(action: unknown): string | null {
  if (typeof action !== "string") return null;
  return ACTION_TO_BASE_RELATION[action] ?? null;
}

function addMessagingRelationship(
  relationships: NonNullable<MigrationRuntimePlan["relationships"]>,
  subjectType: "slack_channel" | "webex_space",
  subjectId: string,
  action: string,
  resource: { type: string; id: string }
): void {
  addRelationship(relationships, { type: subjectType, id: subjectId }, action, resource);
}

export function deriveMessagingRebacPlan(input: {
  surface: MessagingGrantSurface;
  grants: Array<Record<string, any>>;
  routes: Array<Record<string, any>>;
}): MigrationRuntimePlan {
  const tuples: OpenFgaTupleKey[] = [];
  const relationships: NonNullable<MigrationRuntimePlan["relationships"]> = [];
  const warnings: string[] = [];
  let invalidIdentifiers = 0;
  let unsupportedActions = 0;
  let activeGrants = 0;
  let activeRoutes = 0;

  for (const grant of input.grants) {
    if (grant.status && grant.status !== "active") continue;
    activeGrants += 1;
    const workspaceId = normalizeString(grant.workspace_id);
    const resourceOwnerId = normalizeString(grant[input.surface.idField]);
    const resourceType = normalizeString(grant.resource?.type);
    const resourceId = normalizeString(grant.resource?.id);
    if (!workspaceId || !resourceOwnerId || !resourceType || !resourceId) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping ${input.surface.subjectType} grant with incomplete identifiers.`);
      continue;
    }
    const subjectId = `${workspaceId}--${resourceOwnerId}`;
    if (![workspaceId, resourceOwnerId, subjectId, resourceType, resourceId].every(isOpenFgaId)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping ${input.surface.subjectType} grant with invalid OpenFGA identifiers.`);
      continue;
    }

    const actions = Array.isArray(grant.actions) ? grant.actions : [];
    for (const action of actions) {
      const relation = relationshipForAction(action);
      if (!relation || typeof action !== "string") {
        unsupportedActions += 1;
        warnings.push(`Skipping unsupported ${input.surface.subjectType} action: ${String(action)}`);
        continue;
      }
      tuples.push({
        user: `${input.surface.subjectType}:${subjectId}`,
        relation,
        object: `${resourceType}:${resourceId}`,
      });
      addMessagingRelationship(relationships, input.surface.subjectType, subjectId, action, {
        type: resourceType,
        id: resourceId,
      });
    }
  }

  for (const route of input.routes) {
    if (route.status && route.status !== "active") continue;
    if (route.enabled === false) continue;
    activeRoutes += 1;
    const workspaceId = normalizeString(route.workspace_id);
    const resourceOwnerId = normalizeString(route[input.surface.routeIdField]);
    const agentId = normalizeString(route.agent_id);
    if (!workspaceId || !resourceOwnerId || !agentId) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping ${input.surface.subjectType} route with incomplete identifiers.`);
      continue;
    }
    const subjectId = `${workspaceId}--${resourceOwnerId}`;
    if (![workspaceId, resourceOwnerId, subjectId, agentId].every(isOpenFgaId)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping ${input.surface.subjectType} route with invalid OpenFGA identifiers.`);
      continue;
    }

    tuples.push({
      user: `${input.surface.subjectType}:${subjectId}`,
      relation: "user",
      object: `agent:${agentId}`,
    });
    addMessagingRelationship(relationships, input.surface.subjectType, subjectId, "use", {
      type: "agent",
      id: agentId,
    });
  }

  const unique = uniqueTuples(tuples);
  return {
    migration_id: input.surface.migrationId,
    release: RELEASE_051,
    schema_area: input.surface.schemaArea,
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      grants_scanned: activeGrants,
      routes_scanned: activeRoutes,
      tuples_planned: unique.length,
      relationships_planned: relationships.length,
      invalid_identifiers: invalidIdentifiers,
      unsupported_actions: unsupportedActions,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${input.surface.migrationId}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: input.surface.confirmation,
    tuples: unique,
    relationships,
  };
}

export function deriveMessagingTeamMappingPlan(input: {
  teams: Array<Record<string, any>>;
  slackMappings: Array<Record<string, any>>;
  webexMappings: Array<Record<string, any>>;
}): MigrationRuntimePlan {
  const warnings: string[] = [];
  const teamIds = new Set(input.teams.map((team) => normalizeString(team._id)).filter(Boolean));
  const teamIdsBySlug = new Map(
    input.teams
      .map((team) => [normalizeString(team.slug), normalizeString(team._id)] as const)
      .filter(([slug, id]) => Boolean(slug && id)),
  );
  const repairs: NonNullable<MigrationRuntimePlan["teamMappingRepairs"]> = [];
  let missingTeams = 0;

  const resolveTeamId = (mapping: Record<string, any>) => {
    const id = normalizeString(mapping.team_id);
    if (id && teamIds.has(id)) return id;
    const slug = normalizeString(mapping.team_slug);
    if (slug && teamIdsBySlug.has(slug)) return teamIdsBySlug.get(slug) ?? null;
    return null;
  };

  for (const mapping of input.slackMappings) {
    if (mapping.status && mapping.status !== "active") continue;
    const teamId = resolveTeamId(mapping);
    const workspaceId = normalizeString(mapping.slack_workspace_id) ?? normalizeString(mapping.workspace_id);
    const channelId = normalizeString(mapping.slack_channel_id) ?? normalizeString(mapping.channel_id);
    if (!teamId || !workspaceId || !channelId) {
      missingTeams += teamId ? 0 : 1;
      warnings.push("Skipping Slack channel mapping with missing team or channel identifiers.");
      continue;
    }
    repairs.push({
      team_id: teamId,
      slack_channel: {
        slack_channel_id: channelId,
        channel_name: normalizeString(mapping.channel_name) ?? channelId,
        slack_workspace_id: workspaceId,
      },
    });
  }

  for (const mapping of input.webexMappings) {
    if (mapping.status && mapping.status !== "active") continue;
    const teamId = resolveTeamId(mapping);
    const workspaceId = normalizeString(mapping.workspace_id);
    const spaceId = normalizeString(mapping.space_id);
    if (!teamId || !workspaceId || !spaceId) {
      missingTeams += teamId ? 0 : 1;
      warnings.push("Skipping Webex space mapping with missing team or space identifiers.");
      continue;
    }
    repairs.push({
      team_id: teamId,
      webex_space: {
        space_id: spaceId,
        space_name: normalizeString(mapping.space_name) ?? normalizeString(mapping.space_title) ?? spaceId,
        workspace_id: workspaceId,
      },
    });
  }

  return {
    migration_id: MESSAGING_TEAM_MAPPING_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_team_mappings",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      slack_mappings_scanned: input.slackMappings.length,
      webex_mappings_scanned: input.webexMappings.length,
      mapping_repairs_planned: repairs.length,
      missing_teams: missingTeams,
      tuple_writes_planned: 0,
    },
    warnings,
    sample_diffs: repairs.slice(0, 10).map((repair, index) => ({
      collection: "teams",
      id: `${repair.team_id}:${index}`,
      before: {},
      after: repair,
    })),
    tuple_writes_planned: 0,
    confirmation: "MIGRATE messaging_team_mappings TO v2",
    teamMappingRepairs: repairs,
  };
}

// assisted-by Cursor Claude:claude-opus-4-7
//
// Derives team→channel/space visibility tuples from already-onboarded Slack
// channel and Webex space mappings. Without these tuples, the admin listing
// endpoints filter every row out via their `can_read` check, which is why
// previously-set-up channels appear as "Needs setup" in the panel.
//
// Tuple shape (per onboarded channel/space with a resolvable team_slug):
//   team:<slug>#admin  → manage → slack_channel|webex_space:<workspace>--<id>
//   team:<slug>#member → read   → slack_channel|webex_space:<workspace>--<id>
//
// Idempotent: writeOpenFgaTuples no-ops on identical writes.
export function deriveMessagingTeamVisibilityPlan(input: {
  teams: Array<Record<string, any>>;
  slackMappings: Array<Record<string, any>>;
  webexMappings: Array<Record<string, any>>;
}): MigrationRuntimePlan {
  const warnings: string[] = [];
  const teamIds = new Set(input.teams.map((team) => normalizeString(team._id)).filter(Boolean));
  const teamSlugsById = new Map(
    input.teams
      .map((team) => [normalizeString(team._id), normalizeString(team.slug)] as const)
      .filter(([id, slug]) => Boolean(id && slug)),
  );
  const teamIdsBySlug = new Map(
    input.teams
      .map((team) => [normalizeString(team.slug), normalizeString(team._id)] as const)
      .filter(([slug, id]) => Boolean(slug && id)),
  );

  const resolveTeamSlug = (mapping: Record<string, any>): string | null => {
    const directSlug = normalizeString(mapping.team_slug);
    if (directSlug && teamIdsBySlug.has(directSlug)) return directSlug;
    const teamId = normalizeString(mapping.team_id);
    if (teamId && teamIds.has(teamId)) return teamSlugsById.get(teamId) ?? null;
    return null;
  };

  // Strongly-typed local array so the helpers' narrow union types are not
  // lost when widened to MigrationRuntimePlan["relationships"] later.
  const typedRelationships: UniversalRebacRelationship[] = [];
  let slackChannelsScanned = 0;
  let webexSpacesScanned = 0;
  let missingTeams = 0;
  let invalidIdentifiers = 0;

  for (const mapping of input.slackMappings) {
    if (mapping.active === false) continue;
    if (mapping.status && mapping.status !== "active") continue;
    slackChannelsScanned += 1;
    const workspaceId = normalizeString(mapping.slack_workspace_id) ?? normalizeString(mapping.workspace_id);
    const channelId = normalizeString(mapping.slack_channel_id) ?? normalizeString(mapping.channel_id);
    if (!workspaceId || !channelId) {
      invalidIdentifiers += 1;
      warnings.push("Skipping Slack channel mapping with missing workspace or channel id.");
      continue;
    }
    const teamSlug = resolveTeamSlug(mapping);
    if (!teamSlug) {
      missingTeams += 1;
      warnings.push(
        `Skipping Slack channel ${channelId}: no resolvable team_slug for visibility tuples.`,
      );
      continue;
    }
    typedRelationships.push(
      ...slackChannelTeamVisibilityRelationships(workspaceId, channelId, teamSlug),
    );
  }

  for (const mapping of input.webexMappings) {
    if (mapping.active === false) continue;
    if (mapping.status && mapping.status !== "active") continue;
    webexSpacesScanned += 1;
    const workspaceId = normalizeString(mapping.workspace_id);
    const spaceId = normalizeString(mapping.space_id) ?? normalizeString(mapping.webex_space_id);
    if (!workspaceId || !spaceId) {
      invalidIdentifiers += 1;
      warnings.push("Skipping Webex space mapping with missing workspace or space id.");
      continue;
    }
    const teamSlug = resolveTeamSlug(mapping);
    if (!teamSlug) {
      missingTeams += 1;
      warnings.push(
        `Skipping Webex space ${spaceId}: no resolvable team_slug for visibility tuples.`,
      );
      continue;
    }
    typedRelationships.push(
      ...webexSpaceTeamVisibilityRelationships(workspaceId, spaceId, teamSlug),
    );
  }

  // Hand the relationships through the same builder the rest of the registry
  // uses so the OpenFGA tuples emitted here are 1:1 with what an onboarding
  // call would write. This keeps the deduplication / validation rules in one
  // place.
  const { writes } = buildUniversalRebacTupleDiff({ writes: typedRelationships, deletes: [] });
  const unique = uniqueTuples(writes);

  return {
    migration_id: MESSAGING_TEAM_VISIBILITY_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_team_visibility",
    kind: "explicit",
    from_version: 1,
    to_version: 2,
    counts: {
      slack_channels_scanned: slackChannelsScanned,
      webex_spaces_scanned: webexSpacesScanned,
      relationships_planned: typedRelationships.length,
      tuples_planned: unique.length,
      missing_teams: missingTeams,
      invalid_identifiers: invalidIdentifiers,
      tuple_writes_planned: unique.length,
    },
    warnings,
    sample_diffs: unique.slice(0, 10).map((tuple, index) => ({
      collection: "openfga_tuples",
      id: `${MESSAGING_TEAM_VISIBILITY_MIGRATION_ID}:${index}`,
      before: {},
      after: { ...tuple },
    })),
    tuple_writes_planned: unique.length,
    confirmation: "MIGRATE messaging_team_visibility TO v2",
    tuples: unique,
    relationships: typedRelationships,
  };
}

const RBAC_INDEX_SPECS: NonNullable<MigrationRuntimePlan["indexes"]> = [
  { collection: "schema_migrations", keys: { release: 1, status: 1 } },
  { collection: "rebac_relationships", keys: { "resource.type": 1, "resource.id": 1, action: 1, status: 1 } },
  { collection: "team_membership_sources", keys: { team_slug: 1, user_subject: 1, relationship: 1 } },
  { collection: "audit_events", keys: { type: 1, ts: -1 } },
];

const MESSAGING_REBAC_INDEX_SPECS: NonNullable<MigrationRuntimePlan["indexes"]> = [
  {
    collection: "webex_space_team_mappings",
    keys: { workspace_id: 1, space_id: 1, status: 1 },
    options: { name: "webex_space_team_lookup" },
  },
  {
    collection: "webex_space_agent_routes",
    keys: { workspace_id: 1, space_id: 1, agent_id: 1, status: 1 },
    options: { name: "webex_space_agent_route_lookup" },
  },
  {
    collection: "webex_space_grants",
    keys: { workspace_id: 1, space_id: 1, "resource.type": 1, "resource.id": 1, status: 1 },
    options: { name: "webex_space_grant_lookup" },
  },
  {
    collection: "webex_link_nonces",
    keys: { expires_at: 1 },
    options: { expireAfterSeconds: 0, name: "webex_link_nonce_expiry" },
  },
];

function deriveIndexPlan(): MigrationRuntimePlan {
  return {
    migration_id: RBAC_INDEXES_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "audit_events",
    kind: "index",
    from_version: 1,
    to_version: 2,
    counts: { indexes_planned: RBAC_INDEX_SPECS.length, tuple_writes_planned: 0 },
    warnings: [],
    sample_diffs: RBAC_INDEX_SPECS.map((spec) => ({
      collection: spec.collection,
      id: JSON.stringify(spec.keys),
      before: {},
      after: { keys: spec.keys, options: spec.options ?? {} },
    })),
    tuple_writes_planned: 0,
    confirmation: "MIGRATE audit_events TO v2",
    indexes: RBAC_INDEX_SPECS,
  };
}

export function deriveMessagingIndexPlan(): MigrationRuntimePlan {
  return {
    migration_id: MESSAGING_REBAC_INDEXES_MIGRATION_ID,
    release: RELEASE_051,
    schema_area: "messaging_rebac_indexes",
    kind: "index",
    from_version: 1,
    to_version: 2,
    counts: { indexes_planned: MESSAGING_REBAC_INDEX_SPECS.length, tuple_writes_planned: 0 },
    warnings: [],
    sample_diffs: MESSAGING_REBAC_INDEX_SPECS.map((spec) => ({
      collection: spec.collection,
      id: JSON.stringify(spec.keys),
      before: {},
      after: { keys: spec.keys, options: spec.options ?? {} },
    })),
    tuple_writes_planned: 0,
    confirmation: "MIGRATE messaging_rebac_indexes TO v2",
    indexes: MESSAGING_REBAC_INDEX_SPECS,
  };
}

async function loadConversationMigrationInputs() {
  const conversations = await getCollection("conversations");
  const users = await getCollection("users");
  const [conversationDocs, userDocs] = await Promise.all([
    conversations
      .find({})
      .project({ _id: 1, owner_id: 1, owner_subject: 1, owner_identity_version: 1, metadata: 1 })
      .toArray(),
    users
      .find({})
      .project({ email: 1, keycloak_sub: 1, "metadata.keycloak_sub": 1 })
      .toArray(),
  ]);
  return { conversations, conversationDocs, userDocs };
}

async function loadUniversalMigrationInputs() {
  const [teams, users, dynamicAgents, platformConfig] = await Promise.all([
    getCollection("teams"),
    getCollection("users"),
    getCollection("dynamic_agents"),
    getCollection<Record<string, any>>("platform_config"),
  ]);
  const [teamDocs, userDocs, agentDocs, configDoc] = await Promise.all([
    teams.find({}).toArray(),
    users.find({}).toArray(),
    dynamicAgents.find({}).toArray(),
    platformConfig.findOne({ _id: "platform_settings" } as any),
  ]);
  return { teamDocs, userDocs, agentDocs, configDoc };
}

async function loadSkillHubTeamGrantMigrationInputs() {
  const [skillHubs, hubSkills, teams] = await Promise.all([
    getCollection("skill_hubs"),
    getCollection("hub_skills"),
    getCollection("teams"),
  ]);
  const [hubDocs, hubSkillDocs, teamDocs] = await Promise.all([
    skillHubs.find({}).toArray(),
    hubSkills.find({}).toArray(),
    teams.find({}).toArray(),
  ]);
  return { hubDocs, hubSkillDocs, teamDocs };
}

async function loadOrganizationMembershipMigrationInputs() {
  const users = await getCollection("users");
  return users
    .find({})
    .project({
      email: 1,
      keycloak_sub: 1,
      "metadata.keycloak_sub": 1,
      subject: 1,
      sub: 1,
      "metadata.sso_id": 1,
    })
    .toArray();
}

async function loadAgentToolMigrationInputs() {
  const dynamicAgents = await getCollection("dynamic_agents");
  return dynamicAgents.find({}).toArray();
}

async function loadAgentSharedTeamGrantInputs() {
  const [agents, teams] = await Promise.all([
    getCollection("dynamic_agents"),
    getCollection("teams"),
  ]);
  const [agentDocs, teamDocs] = await Promise.all([
    agents.find({}).toArray(),
    teams.find({}).project({ _id: 1, slug: 1 }).toArray(),
  ]);
  return { agentDocs, teamDocs };
}

// assisted-by Cursor Claude:claude-opus-4-7
// Walk the existing OpenFGA `user:<sub> admin organization:<key>` tuples
// to discover every previously-bootstrapped org admin subject. Pages
// through the store because some deployments have thousands of users.
/**
 * Load every `team_kb_ownership` Mongo doc plus a `teamId → slug` map for
 * the KB shared-team grants backfill. Skips teams whose Mongo `_id` is
 * unknown (returned in the migration `warnings` instead of failing the
 * whole plan, mirroring `deriveMessagingRebacPlan`).
 */
async function loadKnowledgeBaseSharedTeamGrantsInputs(): Promise<{
  ownershipDocs: Array<Record<string, unknown>>;
  teamSlugByMongoId: Map<string, string>;
}> {
  const [ownershipCollection, teamsCollection] = await Promise.all([
    getCollection("team_kb_ownership"),
    getCollection("teams"),
  ]);

  const ownershipDocs = (await ownershipCollection.find({}).toArray()) as Array<
    Record<string, unknown>
  >;

  // Best-effort: only resolve teams that have a slug field. The teams
  // collection's _id is sometimes an ObjectId and sometimes a string;
  // we coerce both to string so the lookup is uniform.
  const teamDocs = (await teamsCollection
    .find({}, { projection: { _id: 1, slug: 1 } } as never)
    .toArray()) as Array<Record<string, unknown>>;
  const teamSlugByMongoId = new Map<string, string>();
  for (const doc of teamDocs) {
    const idValue = (doc as { _id?: unknown })._id;
    const slug = typeof doc.slug === "string" ? doc.slug.trim() : "";
    if (!slug) continue;
    const idString =
      typeof idValue === "string"
        ? idValue
        : idValue && typeof (idValue as { toString?: () => string }).toString === "function"
          ? (idValue as { toString: () => string }).toString()
          : "";
    if (!idString) continue;
    teamSlugByMongoId.set(idString, slug);
  }

  return { ownershipDocs, teamSlugByMongoId };
}

/**
 * Read every existing `knowledge_base:*` tuple from OpenFGA. Used by
 * `deriveDataSourceGrantsBackfillPlan` so the data_source mirror set
 * is computed from the source of truth instead of Mongo. Iterates
 * the OpenFGA `read` API in pages until `continuationToken` is empty
 * so we don't blow up memory on large stores.
 *
 * Failures (OpenFGA unreachable, model not loaded) bubble up so the
 * migration runner can surface the underlying error rather than
 * silently writing 0 tuples.
 */
async function loadKnowledgeBaseTuples(): Promise<OpenFgaTupleKey[]> {
  const collected: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({
      tuple: { user: "", relation: "", object: "knowledge_base:" },
      continuationToken,
    });
    for (const entry of page.tuples) {
      collected.push(entry.key);
    }
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return collected;
}

/**
 * Load every `team_rag_tools` Mongo doc plus a `teamId → slug` map
 * for the MCP tool grants backfill, mirroring
 * `loadKnowledgeBaseSharedTeamGrantsInputs`.
 */
async function loadMcpToolGrantsBackfillInputs(): Promise<{
  ownershipDocs: Array<Record<string, unknown>>;
  teamSlugByMongoId: Map<string, string>;
}> {
  const [ownershipCollection, teamsCollection] = await Promise.all([
    getCollection("team_rag_tools"),
    getCollection("teams"),
  ]);

  const ownershipDocs = (await ownershipCollection.find({}).toArray()) as Array<
    Record<string, unknown>
  >;

  const teamDocs = (await teamsCollection
    .find({}, { projection: { _id: 1, slug: 1 } } as never)
    .toArray()) as Array<Record<string, unknown>>;
  const teamSlugByMongoId = new Map<string, string>();
  for (const doc of teamDocs) {
    const idValue = (doc as { _id?: unknown })._id;
    const slug = typeof doc.slug === "string" ? doc.slug.trim() : "";
    if (!slug) continue;
    const idString =
      typeof idValue === "string"
        ? idValue
        : idValue && typeof (idValue as { toString?: () => string }).toString === "function"
          ? (idValue as { toString: () => string }).toString()
          : "";
    if (!idString) continue;
    teamSlugByMongoId.set(idString, slug);
  }

  return { ownershipDocs, teamSlugByMongoId };
}

async function loadOrgAdminSubjects(): Promise<string[]> {
  const subjects = new Set<string>();
  const organizationObject = `organization:${caipeOrgKey()}`;
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({
      tuple: { object: organizationObject, relation: "admin" },
      continuationToken,
      pageSize: 100,
    });
    for (const tuple of page.tuples) {
      const user = tuple.key?.user;
      if (typeof user !== "string") continue;
      if (!user.startsWith("user:")) continue;
      const subject = user.slice("user:".length).trim();
      if (subject) subjects.add(subject);
    }
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return Array.from(subjects);
}

async function loadMessagingRebacInputs(surface: "slack" | "webex") {
  if (surface === "slack") {
    const [grants, routes] = await Promise.all([
      getCollection("slack_channel_grants"),
      getCollection("slack_channel_agent_routes"),
    ]);
    const [grantDocs, routeDocs] = await Promise.all([grants.find({}).toArray(), routes.find({}).toArray()]);
    return { grantDocs, routeDocs };
  }

  const [grants, routes] = await Promise.all([
    getCollection("webex_space_grants"),
    getCollection("webex_space_agent_routes"),
  ]);
  const [grantDocs, routeDocs] = await Promise.all([grants.find({}).toArray(), routes.find({}).toArray()]);
  return { grantDocs, routeDocs };
}

async function loadMessagingTeamMappingInputs() {
  const [teams, slackMappings, webexMappings] = await Promise.all([
    getCollection("teams"),
    getCollection("channel_team_mappings"),
    getCollection("webex_space_team_mappings"),
  ]);
  const [teamDocs, slackDocs, webexDocs] = await Promise.all([
    teams.find({}).toArray(),
    slackMappings.find({}).toArray(),
    webexMappings.find({}).toArray(),
  ]);
  return { teamDocs, slackDocs, webexDocs };
}

export function getMigrationDefinition(migrationId: string): MigrationDefinition | null {
  return MIGRATION_DEFINITIONS.find((migration) => migration.id === migrationId) ?? null;
}

function manifestDefinition(doc: MigrationManifestDoc): MigrationDefinition {
  return {
    id: doc.migration_id ?? doc.id ?? doc._id,
    release: doc.release,
    schema_area: doc.schema_area,
    from_version: doc.from_version,
    to_version: doc.to_version,
    kind: doc.kind,
    title: doc.title,
    description: doc.description,
    confirmation: doc.confirmation,
    required: doc.required,
    blocking: doc.blocking,
    implemented: doc.implemented,
    dependencies: doc.dependencies,
  };
}

function isMigrationComplete(definition: MigrationDefinition, version?: SchemaVersionDoc, run?: SchemaMigrationDoc): boolean {
  return run?.status === "completed" || (version?.version ?? 0) >= definition.to_version;
}

async function seedMigrationManifest(now = new Date().toISOString()): Promise<void> {
  const manifest = await getCollection<MigrationManifestDoc>("migration_manifest");
  await Promise.all(
    MIGRATION_DEFINITIONS.map((definition) =>
      manifest.updateOne(
        { _id: definition.id },
        {
          $set: {
            migration_id: definition.id,
            release: definition.release,
            schema_area: definition.schema_area,
            from_version: definition.from_version,
            to_version: definition.to_version,
            kind: definition.kind,
            title: definition.title,
            description: definition.description,
            confirmation: definition.confirmation,
            required: definition.required,
            blocking: definition.blocking ?? definition.required,
            implemented: definition.implemented,
            dependencies: definition.dependencies ?? [],
            handler_checksum: `${definition.id}:${definition.from_version}->${definition.to_version}:${definition.confirmation}`,
            updated_at: now,
            managed_by: "runtime",
          },
          $setOnInsert: { created_at: now, registered_at: now },
        },
        { upsert: true },
      ),
    ),
  );
}

function deriveSchemaVersionStatuses(
  definitions: MigrationDefinition[],
  versionByArea: Map<string, SchemaVersionDoc>,
  collectionNames: string[] = [],
): MigrationSchemaVersionStatus[] {
  const targets = new Map<string, number>();
  for (const definition of definitions) {
    targets.set(definition.schema_area, Math.max(targets.get(definition.schema_area) ?? 0, definition.to_version));
  }

  const schemaAreas = new Set<string>([
    ...collectionNames.filter((name) => !name.startsWith("system.")),
    ...versionByArea.keys(),
    ...targets.keys(),
  ]);

  return Array.from(schemaAreas)
    .sort((left, right) => left.localeCompare(right))
    .map((schemaArea) => {
      const version = versionByArea.get(schemaArea);
      const currentVersion = version?.version ?? null;
      const targetVersion = targets.get(schemaArea) ?? null;
      return {
        schema_area: schemaArea,
        current_version: currentVersion,
        target_version: targetVersion,
        status:
          currentVersion === null
            ? "unknown"
            : targetVersion === null || currentVersion >= targetVersion
              ? "current"
              : "behind",
        last_migration_id: version?.last_migration_id,
      };
    });
}

async function listMongoCollectionNames(): Promise<string[]> {
  try {
    const { db } = await connectToDatabase();
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections.map((collection) => collection.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function listReleaseMigrations(options: { includeCompleted?: boolean } = {}): Promise<MigrationListResult> {
  await seedMigrationManifest();
  const manifest = await getCollection<MigrationManifestDoc>("migration_manifest");
  const versions = await getCollection<SchemaVersionDoc>("data_schema_versions");
  const runs = await getCollection<SchemaMigrationDoc>("schema_migrations");
  const [manifestDocs, versionDocs, runDocs, collectionNames] = await Promise.all([
    manifest.find({}).toArray(),
    versions.find({}).toArray(),
    runs.find({ release: RELEASE_051 }).toArray(),
    listMongoCollectionNames(),
  ]);
  const definitions = (manifestDocs.length > 0 ? manifestDocs.map(manifestDefinition) : MIGRATION_DEFINITIONS).sort(
    (left, right) => left.release.localeCompare(right.release) || left.schema_area.localeCompare(right.schema_area) || left.from_version - right.from_version,
  );
  const versionByArea = new Map(versionDocs.map((doc) => [doc._id, doc]));
  const runById = new Map(runDocs.map((doc) => [doc._id, doc]));
  const migrations = definitions.map((definition) => {
    const version = versionByArea.get(definition.schema_area);
    const run = runById.get(definition.id);
    const completed = isMigrationComplete(definition, version, run);
    return {
      ...definition,
      blocking: definition.blocking ?? definition.required,
      current_version: version?.version ?? null,
      target_version: definition.to_version,
      status: completed ? "completed" : run?.status ?? "not_started",
      last_run_at: run?.completed_at ?? run?.updated_at,
    };
  });
  const completedMigrations = migrations.filter((migration) => migration.status === "completed");

  return {
    release: RELEASE_051,
    runtime: {
      migration_release: RELEASE_051,
      manifest_count: definitions.length,
    },
    schema_versions: deriveSchemaVersionStatuses(definitions, versionByArea, collectionNames),
    migrations: options.includeCompleted ? migrations : migrations.filter((migration) => migration.status !== "completed"),
    completed_migrations: completedMigrations,
  };
}

async function listDerivedSchemaVersionStatuses(): Promise<MigrationSchemaVersionStatus[]> {
  await seedMigrationManifest();
  const manifest = await getCollection<MigrationManifestDoc>("migration_manifest");
  const versions = await getCollection<SchemaVersionDoc>("data_schema_versions");
  const [manifestDocs, versionDocs, collectionNames] = await Promise.all([
    manifest.find({}).toArray(),
    versions.find({}).toArray(),
    listMongoCollectionNames(),
  ]);
  const definitions = (manifestDocs.length > 0 ? manifestDocs.map(manifestDefinition) : MIGRATION_DEFINITIONS).sort(
    (left, right) => left.release.localeCompare(right.release) || left.schema_area.localeCompare(right.schema_area) || left.from_version - right.from_version,
  );
  return deriveSchemaVersionStatuses(definitions, new Map(versionDocs.map((doc) => [doc._id, doc])), collectionNames);
}

function normalizeSchemaAreas(schemaAreas: unknown): string[] | null {
  if (!Array.isArray(schemaAreas)) return null;
  return Array.from(
    new Set(
      schemaAreas
        .map((schemaArea) => (typeof schemaArea === "string" ? schemaArea.trim() : ""))
        .filter(Boolean),
    ),
  );
}

export async function planSchemaVersionBootstrap(input: {
  schemaAreas?: unknown;
} = {}): Promise<SchemaVersionBootstrapPlanResult> {
  const statuses = await listDerivedSchemaVersionStatuses();
  const unversionedSchemaAreas = statuses
    .filter((schema) => schema.current_version === null)
    .map((schema) => schema.schema_area);
  const unversionedSet = new Set(unversionedSchemaAreas);
  const requestedSchemaAreas = normalizeSchemaAreas(input.schemaAreas);
  const selectedSchemaAreas = requestedSchemaAreas ?? unversionedSchemaAreas;
  const invalidSchemaAreas = selectedSchemaAreas.filter((schemaArea) => !unversionedSet.has(schemaArea));

  if (invalidSchemaAreas.length > 0) {
    const error = new Error(`Schema areas are not eligible for v1 initialization: ${invalidSchemaAreas.join(", ")}`) as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 400;
    error.code = "SCHEMA_VERSION_BOOTSTRAP_INVALID_AREAS";
    throw error;
  }

  return {
    migration_id: SCHEMA_VERSION_BOOTSTRAP_MIGRATION_ID,
    release: RELEASE_051,
    schema_areas: selectedSchemaAreas,
    counts: {
      unversioned_schema_areas: unversionedSchemaAreas.length,
      selected_schema_areas: selectedSchemaAreas.length,
      schema_versions_planned: selectedSchemaAreas.length,
      collection_documents_touched: 0,
    },
    warnings: [],
    confirmation: SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION,
  };
}

export async function applySchemaVersionBootstrap(input: {
  schemaAreas?: unknown;
  confirmation: string;
  actor: string;
  now?: string;
}): Promise<SchemaVersionBootstrapApplyResult> {
  if (input.confirmation !== SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION) {
    const error = new Error(`Confirmation must exactly match: ${SCHEMA_VERSION_BOOTSTRAP_CONFIRMATION}`) as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 400;
    error.code = "CONFIRMATION_REQUIRED";
    throw error;
  }

  const now = input.now ?? new Date().toISOString();
  const plan = await planSchemaVersionBootstrap({ schemaAreas: input.schemaAreas });
  const schemaVersions = await getCollection<SchemaVersionDoc>("data_schema_versions");
  const schemaMigrations = await getCollection<SchemaMigrationDoc>("schema_migrations");

  for (const schemaArea of plan.schema_areas) {
    await schemaVersions.updateOne(
      { _id: schemaArea },
      {
        $set: {
          version: 1,
          updated_at: now,
          updated_by: input.actor,
          last_migration_id: SCHEMA_VERSION_BOOTSTRAP_MIGRATION_ID,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
  }

  const appliedCounts = {
    schema_versions_initialized: plan.schema_areas.length,
    collection_documents_touched: 0,
  };
  await schemaMigrations.updateOne(
    { _id: SCHEMA_VERSION_BOOTSTRAP_MIGRATION_ID },
    {
      $set: {
        release: RELEASE_051,
        schema_area: "data_schema_versions",
        kind: "version",
        status: "completed",
        planned_counts: plan.counts,
        applied_counts: appliedCounts,
        schema_areas: plan.schema_areas,
        completed_at: now,
        updated_at: now,
        updated_by: input.actor,
      },
      $setOnInsert: { created_at: now, created_by: input.actor },
    },
    { upsert: true },
  );

  return {
    ...plan,
    applied_counts: appliedCounts,
    applied_at: now,
    applied_by: input.actor,
  };
}

function overrideKey(release: string, actor: string): string {
  return `${release}:${actor.toLowerCase()}`;
}

function isOverrideActive(override: MigrationOverrideDoc | null, now: string): boolean {
  if (!override || override.status !== "active") return false;
  if (!override.expires_at) return true;
  return override.expires_at > now;
}

export async function getMigrationBlockingStatus(input: {
  actor: string;
  now?: string;
}): Promise<MigrationBlockingStatus> {
  const now = input.now ?? new Date().toISOString();
  const state = await listReleaseMigrations();
  const overrides = await getCollection<MigrationOverrideDoc>("migration_overrides");
  const override = await overrides.findOne({ _id: overrideKey(state.release, input.actor) });
  const overrideActive = isOverrideActive(override, now);
  const pendingRequired = state.migrations.filter((migration) => migration.required);
  const blockingRequired = pendingRequired.filter((migration) => migration.blocking ?? migration.required);
  const versionBootstrapSchemaAreas = state.schema_versions
    .filter((schema) => schema.current_version === null)
    .map((schema) => schema.schema_area)
    .sort((left, right) => left.localeCompare(right));
  const needsVersionBootstrap = versionBootstrapSchemaAreas.length > 0;
  const isBlocking = blockingRequired.length > 0 && !overrideActive;

  return {
    release: state.release,
    runtime: state.runtime,
    schema_versions: state.schema_versions,
    pending_required_count: pendingRequired.length,
    blocking_required_count: blockingRequired.length,
    version_bootstrap_required_count: versionBootstrapSchemaAreas.length,
    version_bootstrap_schema_areas: versionBootstrapSchemaAreas,
    needs_version_bootstrap: needsVersionBootstrap,
    requires_attention: isBlocking || needsVersionBootstrap,
    is_blocking: isBlocking,
    override_active: overrideActive,
    override_reason: overrideActive ? override?.reason : undefined,
    override_expires_at: overrideActive ? override?.expires_at : undefined,
  };
}

export async function recordMigrationOverride(input: {
  actor: string;
  reason: string;
  now?: string;
}): Promise<MigrationBlockingStatus> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    const error = new Error("Override reason must be at least 10 characters") as Error & { statusCode?: number; code?: string };
    error.statusCode = 400;
    error.code = "MIGRATION_OVERRIDE_REASON_REQUIRED";
    throw error;
  }

  const now = input.now ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
  const overrides = await getCollection<MigrationOverrideDoc>("migration_overrides");
  await overrides.updateOne(
    { _id: overrideKey(RELEASE_051, input.actor) },
    {
      $set: {
        release: RELEASE_051,
        reason,
        status: "active",
        expires_at: expiresAt,
        created_by: input.actor,
        created_at: now,
        updated_at: now,
      },
      $setOnInsert: {},
    },
    { upsert: true },
  );

  return getMigrationBlockingStatus({ actor: input.actor, now });
}

export async function planMigration(migrationId: string, now = new Date().toISOString()): Promise<MigrationPlanResult> {
  const definition = getMigrationDefinition(migrationId);
  if (!definition) {
    throw new Error(`Unknown migration: ${migrationId}`);
  }
  if (!definition.implemented) {
    return {
      migration_id: definition.id,
      release: definition.release,
      schema_area: definition.schema_area,
      kind: definition.kind,
      from_version: definition.from_version,
      to_version: definition.to_version,
      counts: { not_implemented: 1, tuple_writes_planned: 0 },
      warnings: ["This migration is registered in the 0.5.1 manifest but is not implemented yet."],
      sample_diffs: [],
      tuple_writes_planned: 0,
      confirmation: definition.confirmation,
    };
  }

  if (migrationId === CONVERSATION_OWNER_IDENTITY_MIGRATION_ID) {
    const { conversationDocs, userDocs } = await loadConversationMigrationInputs();
    return deriveConversationOwnerIdentityPlan({
      conversations: conversationDocs as never[],
      users: userDocs as never[],
      now,
    });
  }
  if (migrationId === UNIVERSAL_REBAC_MIGRATION_ID) {
    const { teamDocs, userDocs, agentDocs, configDoc } = await loadUniversalMigrationInputs();
    return deriveUniversalRebacPlan({
      teams: teamDocs as Array<Record<string, any>>,
      users: userDocs as Array<Record<string, any>>,
      dynamicAgents: agentDocs as Array<Record<string, any>>,
      platformConfig: configDoc as Record<string, any> | null,
    });
  }
  if (migrationId === SKILL_HUB_TEAM_GRANTS_MIGRATION_ID) {
    const { hubDocs, hubSkillDocs, teamDocs } = await loadSkillHubTeamGrantMigrationInputs();
    return deriveSkillHubTeamGrantPlan({
      hubs: hubDocs as Array<Record<string, any>>,
      hubSkills: hubSkillDocs as Array<Record<string, any>>,
      teams: teamDocs as Array<Record<string, any>>,
    });
  }
  if (migrationId === ORGANIZATION_MEMBERSHIP_MIGRATION_ID) {
    const userDocs = await loadOrganizationMembershipMigrationInputs();
    return deriveOrganizationMembershipPlan(userDocs as Array<Record<string, any>>);
  }
  if (migrationId === AGENT_TOOL_MIGRATION_ID) {
    const agentDocs = await loadAgentToolMigrationInputs();
    return deriveAgentToolPlan(agentDocs as Array<Record<string, any>>);
  }
  if (migrationId === AGENT_ORG_ADMIN_MIGRATION_ID) {
    const agentDocs = await loadAgentToolMigrationInputs();
    return deriveAgentOrganizationInheritancePlan(agentDocs as Array<Record<string, any>>);
  }
  if (migrationId === AGENT_SHARED_TEAM_GRANTS_MIGRATION_ID) {
    const { agentDocs, teamDocs } = await loadAgentSharedTeamGrantInputs();
    return deriveAgentSharedTeamGrantsPlan(
      agentDocs as Array<Record<string, any>>,
      teamDocs as Array<Record<string, any>>,
    );
  }
  if (migrationId === ADMIN_SURFACE_RAG_DATASOURCES_ADMIN_GRANT_MIGRATION_ID) {
    const subjects = await loadOrgAdminSubjects();
    return deriveAdminSurfaceRagDatasourcesAdminGrantPlan(subjects);
  }
  if (migrationId === KNOWLEDGE_BASE_SHARED_TEAM_GRANTS_MIGRATION_ID) {
    const { ownershipDocs, teamSlugByMongoId } =
      await loadKnowledgeBaseSharedTeamGrantsInputs();
    return deriveKnowledgeBaseSharedTeamGrantsPlan(ownershipDocs, teamSlugByMongoId);
  }
  if (migrationId === DATA_SOURCE_GRANTS_BACKFILL_MIGRATION_ID) {
    const tuples = await loadKnowledgeBaseTuples();
    return deriveDataSourceGrantsBackfillPlan(tuples);
  }
  if (migrationId === MCP_TOOL_GRANTS_BACKFILL_MIGRATION_ID) {
    const { ownershipDocs, teamSlugByMongoId } = await loadMcpToolGrantsBackfillInputs();
    return deriveMcpToolGrantsBackfillPlan(ownershipDocs, teamSlugByMongoId);
  }
  if (migrationId === RBAC_INDEXES_MIGRATION_ID) {
    return deriveIndexPlan();
  }
  if (migrationId === SLACK_CHANNEL_REBAC_MIGRATION_ID) {
    const { grantDocs, routeDocs } = await loadMessagingRebacInputs("slack");
    return deriveMessagingRebacPlan({
      surface: {
        migrationId: SLACK_CHANNEL_REBAC_MIGRATION_ID,
        schemaArea: "slack_channel_rebac",
        confirmation: "MIGRATE slack_channel_rebac TO v2",
        subjectType: "slack_channel",
        idField: "channel_id",
        routeIdField: "channel_id",
      },
      grants: grantDocs as Array<Record<string, any>>,
      routes: routeDocs as Array<Record<string, any>>,
    });
  }
  if (migrationId === WEBEX_SPACE_REBAC_MIGRATION_ID) {
    const { grantDocs, routeDocs } = await loadMessagingRebacInputs("webex");
    return deriveMessagingRebacPlan({
      surface: {
        migrationId: WEBEX_SPACE_REBAC_MIGRATION_ID,
        schemaArea: "webex_space_rebac",
        confirmation: "MIGRATE webex_space_rebac TO v2",
        subjectType: "webex_space",
        idField: "space_id",
        routeIdField: "space_id",
      },
      grants: grantDocs as Array<Record<string, any>>,
      routes: routeDocs as Array<Record<string, any>>,
    });
  }
  if (migrationId === MESSAGING_TEAM_MAPPING_MIGRATION_ID) {
    const { teamDocs, slackDocs, webexDocs } = await loadMessagingTeamMappingInputs();
    return deriveMessagingTeamMappingPlan({
      teams: teamDocs as Array<Record<string, any>>,
      slackMappings: slackDocs as Array<Record<string, any>>,
      webexMappings: webexDocs as Array<Record<string, any>>,
    });
  }
  if (migrationId === MESSAGING_REBAC_INDEXES_MIGRATION_ID) {
    return deriveMessagingIndexPlan();
  }
  if (migrationId === MESSAGING_TEAM_VISIBILITY_MIGRATION_ID) {
    const { teamDocs, slackDocs, webexDocs } = await loadMessagingTeamMappingInputs();
    return deriveMessagingTeamVisibilityPlan({
      teams: teamDocs as Array<Record<string, any>>,
      slackMappings: slackDocs as Array<Record<string, any>>,
      webexMappings: webexDocs as Array<Record<string, any>>,
    });
  }
  if (migrationId === KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID) {
    return planKeycloakRbacReconciliationMigration(now);
  }

  throw new Error(`Migration is not plannable: ${migrationId}`);
}

async function recordCompletedMigration(input: {
  definition: MigrationDefinition;
  result: MigrationApplyResult;
  now: string;
  actor: string;
}): Promise<void> {
  const schemaMigrations = await getCollection<SchemaMigrationDoc>("schema_migrations");
  const schemaVersions = await getCollection<SchemaVersionDoc>("data_schema_versions");
  await schemaMigrations.updateOne(
    { _id: input.definition.id },
    {
      $set: {
        release: input.definition.release,
        schema_area: input.definition.schema_area,
        from_version: input.definition.from_version,
        to_version: input.definition.to_version,
        kind: input.definition.kind,
        status: "completed",
        planned_counts: input.result.counts,
        applied_counts: input.result.applied_counts,
        warnings: input.result.warnings,
        sample_diffs: input.result.sample_diffs,
        completed_at: input.now,
        updated_at: input.now,
        updated_by: input.actor,
      },
      $setOnInsert: { created_at: input.now, created_by: input.actor },
    },
    { upsert: true },
  );
  await schemaVersions.updateOne(
    { _id: input.definition.schema_area },
    {
      $set: {
        version: input.definition.to_version,
        updated_at: input.now,
        updated_by: input.actor,
        last_migration_id: input.definition.id,
      },
      $setOnInsert: { created_at: input.now },
    },
    { upsert: true },
  );
}

async function applyRuntimePlan(input: {
  definition: MigrationDefinition;
  plan: MigrationRuntimePlan;
  actor: string;
  now: string;
}): Promise<MigrationApplyResult> {
  let tupleWritesApplied = 0;
  if (input.plan.tuples && input.plan.tuples.length > 0) {
    const result = await writeOpenFgaTuples({ writes: input.plan.tuples, deletes: [] });
    tupleWritesApplied = result.writes;
  }

  let relationshipsUpserted = 0;
  if (input.plan.relationships && input.plan.relationships.length > 0) {
    const relationships = await getCollection("rebac_relationships");
    for (const relationship of input.plan.relationships) {
      await relationships.updateOne(
        {
          "subject.type": relationship.subject.type,
          "subject.id": relationship.subject.id,
          "subject.relation": relationship.subject.relation,
          action: relationship.action,
          "resource.type": relationship.resource.type,
          "resource.id": relationship.resource.id,
          source_type: "migration",
          source_id: input.definition.id,
        },
        {
          $set: {
            ...relationship,
            source_type: "migration",
            source_id: input.definition.id,
            status: "active",
            updated_at: input.now,
          },
          $setOnInsert: { created_at: input.now, created_by: input.actor },
        },
        { upsert: true },
      );
      relationshipsUpserted += 1;
    }
  }

  let membershipSourcesUpserted = 0;
  if (input.plan.membershipSources && input.plan.membershipSources.length > 0) {
    const membershipSources = await getCollection("team_membership_sources");
    for (const source of input.plan.membershipSources) {
      await membershipSources.updateOne(
        {
          team_slug: source.team_slug,
          user_subject: source.user_subject,
          relationship: source.relationship,
          source_type: "migration",
          source_id: input.definition.id,
        },
        {
          $set: {
            ...source,
            source_type: "migration",
            source_id: input.definition.id,
            managed: false,
            status: "active",
            updated_at: input.now,
          },
          $setOnInsert: { created_at: input.now, first_seen_at: input.now, created_by: input.actor },
        },
        { upsert: true },
      );
      membershipSourcesUpserted += 1;
    }
  }

  let indexesCreated = 0;
  if (input.plan.indexes) {
    for (const spec of input.plan.indexes) {
      const collection = await getCollection(spec.collection);
      await collection.createIndex(spec.keys, spec.options);
      indexesCreated += 1;
    }
  }

  let messagingTeamMappingsReconciled = 0;
  if (input.plan.teamMappingRepairs && input.plan.teamMappingRepairs.length > 0) {
    const teams = await getCollection("teams");
    for (const repair of input.plan.teamMappingRepairs) {
      const addToSet: Record<string, unknown> = {};
      if (repair.slack_channel) addToSet.slack_channels = repair.slack_channel;
      if (repair.webex_space) addToSet.webex_spaces = repair.webex_space;
      if (Object.keys(addToSet).length === 0) continue;
      await teams.updateOne(
        { _id: repair.team_id } as never,
        {
          $addToSet: addToSet,
          $set: { updated_at: input.now, updated_by: input.actor },
        },
      );
      messagingTeamMappingsReconciled += 1;
    }
  }

  const result: MigrationApplyResult = {
    ...input.plan,
    applied_counts: {
      tuple_writes_applied: tupleWritesApplied,
      relationships_upserted: relationshipsUpserted,
      membership_sources_upserted: membershipSourcesUpserted,
      indexes_created: indexesCreated,
      messaging_team_mappings_reconciled: messagingTeamMappingsReconciled,
    },
    applied_at: input.now,
    applied_by: input.actor,
  };

  await recordCompletedMigration({ definition: input.definition, result, now: input.now, actor: input.actor });
  return result;
}

export async function applyMigration(input: {
  migrationId: string;
  actor: string;
  confirmation: string;
  now?: string;
}): Promise<MigrationApplyResult> {
  const definition = getMigrationDefinition(input.migrationId);
  if (!definition) {
    throw new Error(`Unknown migration: ${input.migrationId}`);
  }
  if (input.confirmation !== definition.confirmation) {
    const error = new Error(`Confirmation must exactly match: ${definition.confirmation}`) as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 400;
    error.code = "CONFIRMATION_REQUIRED";
    throw error;
  }
  if (!definition.implemented) {
    const error = new Error("Migration is registered but not implemented") as Error & { statusCode?: number };
    error.statusCode = 409;
    throw error;
  }

  const now = input.now ?? new Date().toISOString();

  if (input.migrationId === KEYCLOAK_RBAC_RECONCILIATION_MIGRATION_ID) {
    return applyKeycloakRbacReconciliationMigration({ actor: input.actor, now });
  }

  if (input.migrationId !== CONVERSATION_OWNER_IDENTITY_MIGRATION_ID) {
    const plan = (await planMigration(input.migrationId, now)) as MigrationRuntimePlan;
    return applyRuntimePlan({ definition, plan, actor: input.actor, now });
  }
  const { conversations, conversationDocs, userDocs } = await loadConversationMigrationInputs();
  const result = await applyConversationOwnerIdentityMigration({
    conversations: conversationDocs as never[],
    users: userDocs as never[],
    conversationsCollection: conversations,
    actor: input.actor,
    now,
  });

  await recordCompletedMigration({ definition, result, now, actor: input.actor });
  return result;
}
