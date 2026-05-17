// assisted-by Codex Codex-sonnet-4-6

import { readFile } from "node:fs/promises";
import path from "node:path";

import { MongoClient, type Db, type Document } from "mongodb";

export const MIGRATION_ID = "openfga_relationship_backfill_v1";
export const MIGRATION_SOURCE_ID = "backfill-universal-rebac";
const DEFAULT_STORE_NAME = "caipe-openfga";
const DEFAULT_MODEL_PATH = "deploy/openfga/model.fga";
const PLATFORM_CONFIG_ID = "platform_settings";

export interface OpenFgaTupleKey {
  user: string;
  relation: string;
  object: string;
}

export interface TeamDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  status?: string;
  members?: Array<{ user_id?: string; role?: string }>;
  resources?: {
    agents?: string[];
    agent_admins?: string[];
    tools?: string[];
    knowledge_bases?: string[];
    skills?: string[];
    tasks?: string[];
  };
}

export interface UserDoc {
  email?: string;
  keycloak_sub?: string;
  subject?: string;
  sub?: string;
  metadata?: {
    keycloak_sub?: string;
    sso_id?: string;
  };
}

export interface MembershipSourceDoc {
  team_slug?: string;
  user_email?: string;
  user_subject?: string;
  relationship?: "member" | "admin";
  status?: string;
}

export interface DynamicAgentDoc {
  _id?: unknown;
  id?: string;
  status?: string;
  deleted_at?: unknown;
}

export interface PlatformConfigDoc {
  default_agent_id?: string | null;
}

export interface RebacRelationshipRecord {
  subject: { type: string; id: string; relation?: string };
  action: string;
  resource: { type: string; id: string };
  source_type: "migration";
  source_id: string;
  status: "active";
  updated_at: string;
  created_at: string;
  created_by: string;
}

export interface MembershipSourceRecord {
  team_id: string;
  team_slug: string;
  user_email: string;
  user_subject: string;
  relationship: "member" | "admin";
  source_type: "migration";
  source_id: string;
  managed: boolean;
  status: "active";
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  created_by: string;
}

export interface MigrationRecord {
  _id: string;
  status: "running" | "completed" | "failed" | "skipped";
  apply: boolean;
  forced: boolean;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
  counts?: BackfillCounts;
  default_agent?: DefaultAgentResolution;
  errors?: string[];
}

interface MigrationRecordDocument extends Record<string, unknown> {
  _id: string;
}

export interface BackfillCounts {
  teamsScanned: number;
  membershipTuplesPlanned: number;
  resourceTuplesPlanned: number;
  defaultAgentTuplesPlanned: number;
  tuplesPlanned: number;
  tuplesWritten: number;
  membershipSourcesPlanned: number;
  membershipSourcesUpserted: number;
  relationshipsPlanned: number;
  relationshipsUpserted: number;
  invalidIdentifiers: number;
  unmappedUsers: number;
  warnings: number;
}

export interface DefaultAgentResolution {
  id: string | null;
  source: "db" | "env" | "fallback";
  status: "resolved" | "skipped" | "invalid";
}

export interface MigrationPlan {
  tuples: OpenFgaTupleKey[];
  membershipSources: MembershipSourceRecord[];
  relationships: RebacRelationshipRecord[];
  warnings: string[];
  defaultAgent: DefaultAgentResolution;
  counts: BackfillCounts;
}

export interface DeriveMigrationPlanInput {
  now: string;
  teams: unknown[];
  users: unknown[];
  membershipSources: unknown[];
  dynamicAgents: unknown[];
  platformConfig: PlatformConfigDoc | null;
  envDefaultAgentId: string | null;
}

export interface BackfillCollections {
  loadTeams(): Promise<unknown[]>;
  loadUsers(): Promise<unknown[]>;
  loadMembershipSources(): Promise<unknown[]>;
  loadPlatformConfig(): Promise<PlatformConfigDoc | null>;
  loadDynamicAgents(): Promise<unknown[]>;
  getMigrationRecord(id: string): Promise<MigrationRecord | Record<string, unknown> | null>;
  saveMigrationRecord(record: MigrationRecord): Promise<void>;
  upsertMembershipSources(records: MembershipSourceRecord[]): Promise<number>;
  upsertRelationships(records: RebacRelationshipRecord[]): Promise<number>;
}

export interface OpenFgaWriter {
  writeTuples(tuples: OpenFgaTupleKey[]): Promise<number | void>;
}

export interface RunBackfillInput {
  apply: boolean;
  force: boolean;
  now: string;
  modelText: string;
  collections: BackfillCollections;
  openFga: OpenFgaWriter;
  envDefaultAgentId: string | null;
}

export interface RunBackfillResult {
  status: "planned" | "completed" | "skipped";
  counts: BackfillCounts;
  defaultAgent: DefaultAgentResolution;
  migrationRecordId: string;
  warnings: string[];
}

interface ResourceGrant {
  ids?: string[];
  tupleSubjectRelation: "member" | "admin";
  tupleRelation: string;
  action: string;
  type: "agent" | "tool" | "knowledge_base" | "skill" | "task";
}

function teamId(team: TeamDoc): string {
  return typeof team._id === "string" ? team._id : String(team._id);
}

function relationshipForRole(role: string | undefined): "member" | "admin" {
  return role === "admin" || role === "owner" ? "admin" : "member";
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

export function isOpenFgaId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/.test(value);
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

function asTeam(value: unknown): TeamDoc {
  return (value ?? {}) as TeamDoc;
}

function asUser(value: unknown): UserDoc {
  return (value ?? {}) as UserDoc;
}

function asMembershipSource(value: unknown): MembershipSourceDoc {
  return (value ?? {}) as MembershipSourceDoc;
}

function asDynamicAgent(value: unknown): DynamicAgentDoc {
  return (value ?? {}) as DynamicAgentDoc;
}

function dynamicAgentId(agent: unknown): string | null {
  const doc = asDynamicAgent(agent);
  return normalizeString(doc.id) ?? normalizeString(doc._id);
}

function userSubject(user: unknown): string | null {
  const doc = asUser(user);
  return (
    normalizeString(doc.keycloak_sub) ??
    normalizeString(doc.metadata?.keycloak_sub) ??
    normalizeString(doc.subject) ??
    normalizeString(doc.sub) ??
    normalizeString(doc.metadata?.sso_id)
  );
}

function buildEmailSubjectIndex(users: unknown[], membershipSources: unknown[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const user of users) {
    const email = normalizeEmail(asUser(user).email);
    const subject = userSubject(user);
    if (email && subject && isOpenFgaId(subject)) out.set(email, subject);
  }
  for (const source of membershipSources.map(asMembershipSource)) {
    const email = normalizeEmail(source.user_email);
    const subject = normalizeString(source.user_subject);
    if (email && subject && isOpenFgaId(subject) && !out.has(email)) out.set(email, subject);
  }
  return out;
}

function isTeamEligible(team: TeamDoc): boolean {
  return !team.status || team.status === "active" || team.status === "pending_review";
}

export function resolveDefaultAgent(input: {
  platformConfig: PlatformConfigDoc | null;
  envDefaultAgentId: string | null;
  dynamicAgents: unknown[];
}): DefaultAgentResolution {
  const dbDefault = normalizeString(input.platformConfig?.default_agent_id);
  const envDefault = normalizeString(input.envDefaultAgentId);
  const id = dbDefault ?? envDefault;
  const source = dbDefault ? "db" : envDefault ? "env" : "fallback";
  if (!id) return { id: null, source: "fallback", status: "skipped" };
  if (!isOpenFgaId(id)) return { id, source, status: "invalid" };

  const availableIds = new Set(
    input.dynamicAgents
      .map((agent) => {
        const doc = asDynamicAgent(agent);
        if (doc.deleted_at || doc.status === "deleted" || doc.status === "archived") return null;
        return dynamicAgentId(doc);
      })
      .filter((agentId): agentId is string => Boolean(agentId))
  );
  if (availableIds.size === 0 || !availableIds.has(id)) {
    return { id, source, status: "invalid" };
  }
  return { id, source, status: "resolved" };
}

function addRelationship(
  relationships: RebacRelationshipRecord[],
  now: string,
  subject: { type: string; id: string; relation?: string },
  action: string,
  resource: { type: string; id: string }
): void {
  relationships.push({
    subject,
    action,
    resource,
    source_type: "migration",
    source_id: MIGRATION_SOURCE_ID,
    status: "active",
    updated_at: now,
    created_at: now,
    created_by: MIGRATION_SOURCE_ID,
  });
}

export function deriveMigrationPlan(input: DeriveMigrationPlanInput): MigrationPlan {
  const tuples: OpenFgaTupleKey[] = [];
  const membershipSources: MembershipSourceRecord[] = [];
  const relationships: RebacRelationshipRecord[] = [];
  const warnings: string[] = [];
  let invalidIdentifiers = 0;
  let unmappedUsers = 0;
  let membershipTuplesPlanned = 0;
  let resourceTuplesPlanned = 0;
  let defaultAgentTuplesPlanned = 0;

  const emailSubjectIndex = buildEmailSubjectIndex(input.users, input.membershipSources);
  const defaultAgent = resolveDefaultAgent({
    platformConfig: input.platformConfig,
    envDefaultAgentId: input.envDefaultAgentId,
    dynamicAgents: input.dynamicAgents,
  });

  for (const rawTeam of input.teams) {
    const team = asTeam(rawTeam);
    if (!isTeamEligible(team)) continue;
    const slug = normalizeString(team.slug);
    if (!slug) {
      warnings.push(`team ${teamId(team)} skipped: missing slug`);
      invalidIdentifiers += 1;
      continue;
    }
    if (!isOpenFgaId(slug)) {
      warnings.push(`team ${teamId(team)} skipped: invalid slug ${slug}`);
      invalidIdentifiers += 1;
      continue;
    }

    for (const member of team.members ?? []) {
      const email = normalizeEmail(member.user_id);
      if (!email) {
        warnings.push(`team ${slug} member skipped: missing user email`);
        unmappedUsers += 1;
        continue;
      }
      const subject = emailSubjectIndex.get(email) ?? email;
      if (!isOpenFgaId(subject)) {
        warnings.push(`team ${slug} member ${email} skipped: invalid subject ${subject}`);
        unmappedUsers += 1;
        continue;
      }
      const relationship = relationshipForRole(member.role);
      tuples.push({ user: `user:${subject}`, relation: relationship, object: `team:${slug}` });
      membershipTuplesPlanned += 1;
      membershipSources.push({
        team_id: teamId(team),
        team_slug: slug,
        user_email: email,
        user_subject: subject,
        relationship,
        source_type: "migration",
        source_id: MIGRATION_SOURCE_ID,
        managed: false,
        status: "active",
        first_seen_at: input.now,
        last_seen_at: input.now,
        created_at: input.now,
        updated_at: input.now,
        created_by: MIGRATION_SOURCE_ID,
      });
    }

    const resources = team.resources ?? {};
    const grants: ResourceGrant[] = [
      {
        type: "agent",
        action: "use",
        tupleRelation: "user",
        tupleSubjectRelation: "member",
        ids: resources.agents,
      },
      {
        type: "agent",
        action: "manage",
        tupleRelation: "manager",
        tupleSubjectRelation: "admin",
        ids: resources.agent_admins,
      },
      {
        type: "tool",
        action: "call",
        tupleRelation: "caller",
        tupleSubjectRelation: "member",
        ids: resources.tools,
      },
      {
        type: "knowledge_base",
        action: "read",
        tupleRelation: "reader",
        tupleSubjectRelation: "member",
        ids: resources.knowledge_bases,
      },
      {
        type: "skill",
        action: "use",
        tupleRelation: "user",
        tupleSubjectRelation: "member",
        ids: resources.skills,
      },
      {
        type: "task",
        action: "use",
        tupleRelation: "user",
        tupleSubjectRelation: "member",
        ids: resources.tasks,
      },
    ];
    for (const grant of grants) {
      for (const rawResourceId of grant.ids ?? []) {
        const resourceId = normalizeString(rawResourceId);
        if (!resourceId || !isOpenFgaId(resourceId)) {
          warnings.push(`team ${slug} ${grant.type} skipped: invalid id ${String(rawResourceId)}`);
          invalidIdentifiers += 1;
          continue;
        }
        tuples.push({
          user: `team:${slug}#${grant.tupleSubjectRelation}`,
          relation: grant.tupleRelation,
          object: `${grant.type}:${resourceId}`,
        });
        resourceTuplesPlanned += 1;
        addRelationship(
          relationships,
          input.now,
          { type: "team", id: slug, relation: grant.tupleSubjectRelation },
          grant.action,
          { type: grant.type, id: resourceId }
        );
      }
    }
  }

  if (defaultAgent.status === "resolved" && defaultAgent.id) {
    tuples.push({ user: "user:*", relation: "user", object: `agent:${defaultAgent.id}` });
    defaultAgentTuplesPlanned = 1;
    addRelationship(
      relationships,
      input.now,
      { type: "user", id: "*", relation: "typed_wildcard" },
      "use",
      { type: "agent", id: defaultAgent.id }
    );
  } else if (defaultAgent.status === "invalid") {
    warnings.push(`default agent skipped: invalid or unavailable id ${defaultAgent.id}`);
    invalidIdentifiers += 1;
  }

  const unique = uniqueTuples(tuples);
  return {
    tuples: unique,
    membershipSources,
    relationships,
    warnings,
    defaultAgent,
    counts: {
      teamsScanned: input.teams.length,
      membershipTuplesPlanned,
      resourceTuplesPlanned,
      defaultAgentTuplesPlanned,
      tuplesPlanned: unique.length,
      tuplesWritten: 0,
      membershipSourcesPlanned: membershipSources.length,
      membershipSourcesUpserted: 0,
      relationshipsPlanned: relationships.length,
      relationshipsUpserted: 0,
      invalidIdentifiers,
      unmappedUsers,
      warnings: warnings.length,
    },
  };
}

export function hasAgentUserTypedWildcard(modelText: string): boolean {
  const agentMatch = modelText.match(/type\s+agent\b[\s\S]*?(?=\ntype\s+\w|\s*$)/);
  const agentBlock = agentMatch?.[0] ?? modelText;
  const userLine = agentBlock
    .split(/\r?\n/)
    .find((line) => /^\s*define\s+user\s*:/.test(line));
  return Boolean(userLine?.includes("user:*"));
}

export async function runBackfill(input: RunBackfillInput): Promise<RunBackfillResult> {
  const existing = await input.collections.getMigrationRecord(MIGRATION_ID);
  const plan = deriveMigrationPlan({
    now: input.now,
    teams: await input.collections.loadTeams(),
    users: await input.collections.loadUsers(),
    membershipSources: await input.collections.loadMembershipSources(),
    dynamicAgents: await input.collections.loadDynamicAgents(),
    platformConfig: await input.collections.loadPlatformConfig(),
    envDefaultAgentId: input.envDefaultAgentId,
  });
  if (input.apply && !input.force && existing?.status === "completed") {
    return {
      status: "skipped",
      counts: plan.counts,
      defaultAgent: plan.defaultAgent,
      migrationRecordId: MIGRATION_ID,
      warnings: ["completed migration record already exists", ...plan.warnings],
    };
  }

  if (!input.apply) {
    const warnings = [...plan.warnings];
    if (plan.defaultAgent.status === "resolved" && !hasAgentUserTypedWildcard(input.modelText)) {
      warnings.push("OpenFGA model does not allow user:* on agent.user");
    }
    return {
      status: "planned",
      counts: { ...plan.counts, warnings: warnings.length },
      defaultAgent: plan.defaultAgent,
      migrationRecordId: MIGRATION_ID,
      warnings,
    };
  }

  await input.collections.saveMigrationRecord({
    _id: MIGRATION_ID,
    status: "running",
    apply: true,
    forced: input.force,
    started_at: input.now,
    updated_at: input.now,
    counts: plan.counts,
    default_agent: plan.defaultAgent,
  } as MigrationRecord);

  try {
    if (plan.defaultAgent.status === "resolved" && !hasAgentUserTypedWildcard(input.modelText)) {
      throw new Error("OpenFGA model does not allow user:* on agent.user");
    }
    if (plan.defaultAgent.status === "invalid") {
      throw new Error(`Default agent ${plan.defaultAgent.id} is invalid or unavailable`);
    }

    const tuplesWritten = (await input.openFga.writeTuples(plan.tuples)) ?? plan.tuples.length;
    const membershipSourcesUpserted = await input.collections.upsertMembershipSources(plan.membershipSources);
    const relationshipsUpserted = await input.collections.upsertRelationships(plan.relationships);
    const counts: BackfillCounts = {
      ...plan.counts,
      tuplesWritten,
      membershipSourcesUpserted,
      relationshipsUpserted,
    };
    await input.collections.saveMigrationRecord({
      _id: MIGRATION_ID,
      status: "completed",
      apply: true,
      forced: input.force,
      started_at: input.now,
      completed_at: input.now,
      updated_at: input.now,
      counts,
      default_agent: plan.defaultAgent,
    } as MigrationRecord);
    return {
      status: "completed",
      counts,
      defaultAgent: plan.defaultAgent,
      migrationRecordId: MIGRATION_ID,
      warnings: plan.warnings,
    };
  } catch (error) {
    await input.collections.saveMigrationRecord({
      _id: MIGRATION_ID,
      status: "failed",
      apply: true,
      forced: input.force,
      started_at: input.now,
      updated_at: input.now,
      counts: plan.counts,
      default_agent: plan.defaultAgent,
      errors: [error instanceof Error ? error.message : String(error)],
    } as MigrationRecord);
    throw error;
  }
}

function emptyCounts(): BackfillCounts {
  return {
    teamsScanned: 0,
    membershipTuplesPlanned: 0,
    resourceTuplesPlanned: 0,
    defaultAgentTuplesPlanned: 0,
    tuplesPlanned: 0,
    tuplesWritten: 0,
    membershipSourcesPlanned: 0,
    membershipSourcesUpserted: 0,
    relationshipsPlanned: 0,
    relationshipsUpserted: 0,
    invalidIdentifiers: 0,
    unmappedUsers: 0,
    warnings: 0,
  };
}

async function collectionArray(db: Db, name: string): Promise<unknown[]> {
  return db.collection(name).find({}).toArray();
}

export function mongoCollections(db: Db): BackfillCollections {
  return {
    loadTeams: () => collectionArray(db, "teams"),
    loadUsers: () => collectionArray(db, "users"),
    loadMembershipSources: () => collectionArray(db, "team_membership_sources"),
    loadPlatformConfig: async () =>
      (await db.collection("platform_config").findOne({ _id: PLATFORM_CONFIG_ID as unknown as Document })) as
        | PlatformConfigDoc
        | null,
    loadDynamicAgents: () => collectionArray(db, "dynamic_agents"),
    getMigrationRecord: async (id) =>
      (await db.collection<MigrationRecordDocument>("rbac_migrations").findOne({ _id: id })) as
        | MigrationRecord
        | null,
    saveMigrationRecord: async (record) => {
      const { _id, ...recordBody } = record;
      await db.collection<MigrationRecordDocument>("rbac_migrations").updateOne(
        { _id },
        {
          $set: recordBody as Record<string, unknown>,
          $setOnInsert: { created_at: record.updated_at },
        },
        { upsert: true }
      );
    },
    upsertMembershipSources: async (records) => {
      for (const record of records) {
        const { first_seen_at, created_at, created_by, ...recordBody } = record;
        await db.collection("team_membership_sources").updateOne(
          {
            team_slug: record.team_slug,
            user_subject: record.user_subject,
            relationship: record.relationship,
            source_type: "migration",
            source_id: MIGRATION_SOURCE_ID,
          },
          {
            $set: recordBody,
            $setOnInsert: {
              first_seen_at,
              created_at,
              created_by,
            },
          },
          { upsert: true }
        );
      }
      return records.length;
    },
    upsertRelationships: async (records) => {
      let upserted = 0;
      for (const record of records) {
        const { created_at, created_by, ...recordBody } = record;
        const existingNonMigration = await db.collection("rebac_relationships").findOne({
          "subject.type": record.subject.type,
          "subject.id": record.subject.id,
          "subject.relation": record.subject.relation,
          action: record.action,
          "resource.type": record.resource.type,
          "resource.id": record.resource.id,
          source_type: { $ne: "migration" },
        });
        if (existingNonMigration) continue;
        await db.collection("rebac_relationships").updateOne(
          {
            "subject.type": record.subject.type,
            "subject.id": record.subject.id,
            "subject.relation": record.subject.relation,
            action: record.action,
            "resource.type": record.resource.type,
            "resource.id": record.resource.id,
            source_type: "migration",
            source_id: MIGRATION_SOURCE_ID,
          },
          {
            $set: recordBody,
            $setOnInsert: {
              created_at,
              created_by,
            },
          },
          { upsert: true }
        );
        upserted += 1;
      }
      return upserted;
    },
  };
}

function openFgaHttpUrl(): string {
  const baseUrl = process.env.OPENFGA_HTTP?.trim();
  if (!baseUrl) throw new Error("OPENFGA_HTTP is required in apply mode");
  return baseUrl.replace(/\/+$/, "");
}

async function getOpenFgaStoreId(baseUrl: string): Promise<string> {
  const explicitStoreId = process.env.OPENFGA_STORE_ID?.trim();
  if (explicitStoreId) return explicitStoreId;
  const storeName = process.env.OPENFGA_STORE_NAME?.trim() || DEFAULT_STORE_NAME;
  const response = await fetch(`${baseUrl}/stores`, { method: "GET" });
  if (!response.ok) throw new Error(`OpenFGA store discovery failed: ${response.status}`);
  const body = (await response.json()) as { stores?: Array<{ id?: string; name?: string }> };
  const store = body.stores?.find((candidate) => candidate.name === storeName);
  if (!store?.id) throw new Error(`OpenFGA store ${storeName} was not found`);
  return store.id;
}

async function tupleExists(baseUrl: string, storeId: string, tuple: OpenFgaTupleKey): Promise<boolean> {
  const response = await fetch(`${baseUrl}/stores/${storeId}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tuple_key: tuple, page_size: 1 }),
  });
  if (!response.ok) throw new Error(`OpenFGA tuple read failed: ${response.status}`);
  const body = (await response.json()) as { tuples?: unknown[] };
  return (body.tuples ?? []).length > 0;
}

export function openFgaWriter(): OpenFgaWriter {
  return {
    writeTuples: async (tuples) => {
      const unique = uniqueTuples(tuples);
      if (unique.length === 0) return 0;
      const baseUrl = openFgaHttpUrl();
      const storeId = await getOpenFgaStoreId(baseUrl);
      const missing: OpenFgaTupleKey[] = [];
      for (const tuple of unique) {
        if (!(await tupleExists(baseUrl, storeId, tuple))) missing.push(tuple);
      }
      if (missing.length === 0) return 0;
      const response = await fetch(`${baseUrl}/stores/${storeId}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writes: { tuple_keys: missing } }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OpenFGA tuple write failed: ${response.status} ${body.slice(0, 200)}`);
      }
      return missing.length;
    },
  };
}

async function readModelText(): Promise<string> {
  const modelPath = process.env.OPENFGA_MODEL_FILE?.trim() || DEFAULT_MODEL_PATH;
  return readFile(path.resolve(process.cwd(), modelPath), "utf8");
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE;
  const apply = process.env.APPLY === "true";
  const force = process.env.FORCE === "true";
  if (!uri || !databaseName) {
    throw new Error("MONGODB_URI and MONGODB_DATABASE are required");
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await runBackfill({
      apply,
      force,
      now: new Date().toISOString(),
      modelText: await readModelText(),
      collections: mongoCollections(client.db(databaseName)),
      openFga: apply ? openFgaWriter() : { writeTuples: async () => 0 },
      envDefaultAgentId: process.env.DEFAULT_AGENT_ID ?? null,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

const isDirectRun =
  typeof require !== "undefined" && typeof module !== "undefined"
    ? require.main === module
    : process.argv[1]?.endsWith("backfill-universal-rebac.ts");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
