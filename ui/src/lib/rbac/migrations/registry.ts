import { getCollection } from "@/lib/mongodb";
import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { caipeOrgKey } from "@/lib/rbac/organization";

import {
  applyConversationOwnerIdentityMigration,
  CONVERSATION_OWNER_IDENTITY_CONFIRMATION,
  CONVERSATION_OWNER_IDENTITY_MIGRATION_ID,
  deriveConversationOwnerIdentityPlan,
} from "./conversation-owner-identity";
import type { MigrationApplyResult, MigrationDefinition, MigrationListItem, MigrationPlanResult } from "./types";

export const RELEASE_051 = "0.5.1";
const UNIVERSAL_REBAC_MIGRATION_ID = "universal_rebac_relationship_backfill_v1";
const AGENT_TOOL_MIGRATION_ID = "agent_tool_openfga_backfill_v1";
export const AGENT_ORG_ADMIN_MIGRATION_ID = "agent_org_admin_inheritance_v1";
const RBAC_INDEXES_MIGRATION_ID = "rbac_indexes_v1";
const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

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

const RBAC_INDEX_SPECS: NonNullable<MigrationRuntimePlan["indexes"]> = [
  { collection: "schema_migrations", keys: { release: 1, status: 1 } },
  { collection: "rebac_relationships", keys: { "resource.type": 1, "resource.id": 1, action: 1, status: 1 } },
  { collection: "team_membership_sources", keys: { team_slug: 1, user_subject: 1, relationship: 1 } },
  { collection: "audit_events", keys: { type: 1, ts: -1 } },
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

async function loadAgentToolMigrationInputs() {
  const dynamicAgents = await getCollection("dynamic_agents");
  return dynamicAgents.find({}).toArray();
}

export function getMigrationDefinition(migrationId: string): MigrationDefinition | null {
  return MIGRATION_DEFINITIONS.find((migration) => migration.id === migrationId) ?? null;
}

export async function listReleaseMigrations(): Promise<{ release: string; migrations: MigrationListItem[] }> {
  const versions = await getCollection<SchemaVersionDoc>("data_schema_versions");
  const runs = await getCollection<SchemaMigrationDoc>("schema_migrations");
  const [versionDocs, runDocs] = await Promise.all([
    versions.find({}).toArray(),
    runs.find({ release: RELEASE_051 }).toArray(),
  ]);
  const versionByArea = new Map(versionDocs.map((doc) => [doc._id, doc]));
  const runById = new Map(runDocs.map((doc) => [doc._id, doc]));

  return {
    release: RELEASE_051,
    migrations: MIGRATION_DEFINITIONS.map((definition) => {
      const version = versionByArea.get(definition.schema_area);
      const run = runById.get(definition.id);
      return {
        ...definition,
        current_version: version?.version ?? null,
        target_version: definition.to_version,
        status: run?.status ?? "not_started",
        last_run_at: run?.completed_at ?? run?.updated_at,
      };
    }),
  };
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
  if (migrationId === AGENT_TOOL_MIGRATION_ID) {
    const agentDocs = await loadAgentToolMigrationInputs();
    return deriveAgentToolPlan(agentDocs as Array<Record<string, any>>);
  }
  if (migrationId === AGENT_ORG_ADMIN_MIGRATION_ID) {
    const agentDocs = await loadAgentToolMigrationInputs();
    return deriveAgentOrganizationInheritancePlan(agentDocs as Array<Record<string, any>>);
  }
  if (migrationId === RBAC_INDEXES_MIGRATION_ID) {
    return deriveIndexPlan();
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

  const result: MigrationApplyResult = {
    ...input.plan,
    applied_counts: {
      tuple_writes_applied: tupleWritesApplied,
      relationships_upserted: relationshipsUpserted,
      membership_sources_upserted: membershipSourcesUpserted,
      indexes_created: indexesCreated,
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
