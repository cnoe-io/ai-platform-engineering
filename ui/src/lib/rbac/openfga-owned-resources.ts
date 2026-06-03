import {
  isOpenFgaReconciliationEnabled,
  readOpenFgaTuples,
  writeOpenFgaTupleDiff,
  type OpenFgaReconcileResult,
  type OpenFgaTupleKey,
  type TeamResourceTupleDiff,
} from "./openfga";
import { openFgaResourceId } from "./openfga-resource-ids";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function isValidOpenFgaId(value: unknown): value is string {
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

async function reconcileOwnedResource(diff: TeamResourceTupleDiff): Promise<OpenFgaReconcileResult> {
  try {
    return await writeOpenFgaTupleDiff(diff);
  } catch (error) {
    console.warn("[openfga-owned-resources] reconciliation failed:", error);
    return { enabled: isOpenFgaReconciliationEnabled(), writes: 0, deletes: 0 };
  }
}

interface OwnedResourceInput {
  ownerSubject?: string | null;
  ownerTeamSlug?: string | null;
  /**
   * Keycloak `sub` of the creator. Written once as an audit-only
   * `user:<sub> creator <type>:<id>` tuple and never deleted (spec
   * 2026-06-03, US2). Optional so legacy callers and types that don't
   * track provenance are unaffected.
   */
  creatorSubject?: string | null;
}

export interface McpServerRelationshipInput extends OwnedResourceInput {
  serverId: string;
}

export interface ConfigDrivenMcpServerRelationshipInput {
  serverId: string;
  organizationId?: string | null;
}

export interface LlmModelRelationshipInput extends OwnedResourceInput {
  modelId: string;
}

export interface ConfigDrivenLlmModelRelationshipInput {
  modelId: string;
  organizationId?: string | null;
}

/**
 * Input for `buildDataSourceRelationshipTupleDiff`.
 *
 * A `data_source` is conceptually 1:1 with a `knowledge_base` today: the
 * RAG server uses the same `<datasource_id>` for both. The separate
 * OpenFGA type was added in [deploy/openfga/model.fga] so future
 * ingest-only roles can be granted without leaking read access on the
 * KB content.
 */
export interface DataSourceRelationshipInput extends OwnedResourceInput {
  dataSourceId: string;
  nextSharedTeamSlugs?: readonly string[] | null;
  previousSharedTeamSlugs?: readonly string[] | null;
  previousOwnerTeamSlug?: string | null;
  /**
   * The knowledge_base id this data source inherits read/ingest/manage
   * from (spec 2026-06-03, US4). A data_source is 1:1 with its KB, so this
   * is normally the same value as `dataSourceId`. When set, the reconciler
   * writes the `data_source:<id> parent_kb knowledge_base:<id>` edge once.
   */
  parentKnowledgeBaseId?: string | null;
}

/**
 * Input for `buildMcpToolRelationshipTupleDiff`.
 *
 * `mcp_tool` is the new OpenFGA type for RAG custom MCP tools
 * (`PUT /v1/mcp/custom-tools/<tool_id>`). Distinct from the existing
 * `tool:<id>` type used by AgentGateway → MCP wiring, because the two
 * have different owners and lifecycles.
 */
export interface McpToolRelationshipInput extends OwnedResourceInput {
  toolId: string;
  nextSharedTeamSlugs?: readonly string[] | null;
  previousSharedTeamSlugs?: readonly string[] | null;
  previousOwnerTeamSlug?: string | null;
}

export interface KnowledgeBaseRelationshipInput extends OwnedResourceInput {
  knowledgeBaseId: string;
  /**
   * Desired set of team slugs that should have read+manage on this KB in
   * addition to the owner team. Mirrors the Agent editor's "Share with
   * Teams" multi-select (`reconcileAgentRelationships`). Invalid slugs are
   * silently dropped; duplicates are deduped. When omitted, only the owner
   * team is granted.
   */
  nextSharedTeamSlugs?: readonly string[] | null;
  /**
   * Previous set of shared team slugs persisted with this KB before this
   * reconcile call. Any slug in here that is NOT in `nextSharedTeamSlugs`
   * (and is also not the new owner team) is emitted as a delete so
   * unchecking a team in the UI genuinely revokes access instead of leaving
   * a dangling tuple.
   */
  previousSharedTeamSlugs?: readonly string[] | null;
  /**
   * Previous owner-team slug, if it differed from the new owner. Allows
   * deleting the old owner-team grant when the KB is transferred to a
   * different owning team (a future feature; today the route never sets
   * this). Treated symmetrically with shared-team removals.
   */
  previousOwnerTeamSlug?: string | null;
}

function normalizeTeamSlugs(raw: readonly string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (!trimmed || !isValidOpenFgaId(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Shared shareable-resource core (spec 2026-06-03-unified-shareable-resource-rbac)
//
// `buildTeamGrantTuples` is the single home for the owner-team + share-with-
// teams effective-set diff that every shareable type used to re-implement:
// write `team:<t>#member <r>` (for each member relation `r`) + `team:<t>#admin
// manager` for each team in `{owner} ∪ shared`, and delete the matching tuples
// for each team in `previousEffective \ nextEffective`. The owner team is
// treated as "wanted" so duplicating it in the shared list is a no-op, and a
// team promoted from shared → owner is never deleted.
//
// `buildShareableResourceTupleDiff` layers the audit-only `creator` tuple, the
// optional personal `owner` subject, and (for data_source) the `parent_kb`
// inheritance edge on top of the team-grant diff. The per-type builders
// (`buildKnowledgeBaseRelationshipTupleDiff`, `buildDataSourceRelationshipTupleDiff`,
// `buildMcpToolRelationshipTupleDiff`) and the agent reconciler are thin
// adapters over these primitives (FR-003 / SC-006).
// ════════════════════════════════════════════════════════════════════════

export interface TeamGrantTuplesInput {
  /** Fully-qualified OpenFGA object, e.g. `data_source:ds-1`. */
  object: string;
  /**
   * The relations a team MEMBER receives on this object (admins always get
   * `manager` in addition). Defaults to `["reader"]`. The agent type passes
   * `["user"]`; `mcp_tool` passes `["reader", "user"]`.
   */
  memberRelations?: readonly string[];
  ownerTeamSlug?: string | null;
  previousOwnerTeamSlug?: string | null;
  nextSharedTeamSlugs?: readonly string[] | null;
  previousSharedTeamSlugs?: readonly string[] | null;
}

/**
 * Compute the owner-team + shared-teams write/delete tuple diff for a single
 * object. Pure and order-deterministic: writes are emitted owner-first then in
 * `nextSharedTeamSlugs` order, each team contributing its member relations in
 * order followed by `#admin manager`. Deletes mirror that shape for retired
 * teams. Does NOT emit owner-subject, creator, or parent_kb tuples — those are
 * layered by `buildShareableResourceTupleDiff`.
 */
export function buildTeamGrantTuples(
  input: TeamGrantTuplesInput,
): TeamResourceTupleDiff {
  const { object } = input;
  const memberRelations =
    input.memberRelations && input.memberRelations.length > 0
      ? input.memberRelations
      : ["reader"];

  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];

  const nextOwnerSlug =
    input.ownerTeamSlug && isValidOpenFgaId(input.ownerTeamSlug)
      ? input.ownerTeamSlug
      : null;
  const previousOwnerSlug =
    input.previousOwnerTeamSlug && isValidOpenFgaId(input.previousOwnerTeamSlug)
      ? input.previousOwnerTeamSlug
      : null;

  const nextSharedSlugs = normalizeTeamSlugs(input.nextSharedTeamSlugs);
  const previousSharedSlugs = normalizeTeamSlugs(input.previousSharedTeamSlugs);

  // Effective desired team slugs = owner ∪ shared. Union semantics mean an
  // owner team that also appears in the shared list neither double-writes nor
  // gets deleted on subsequent reconciles.
  const nextEffective = new Set<string>();
  if (nextOwnerSlug) nextEffective.add(nextOwnerSlug);
  for (const slug of nextSharedSlugs) nextEffective.add(slug);

  for (const slug of nextEffective) {
    for (const relation of memberRelations) {
      writes.push({ user: `team:${slug}#member`, relation, object });
    }
    writes.push({ user: `team:${slug}#admin`, relation: "manager", object });
  }

  const previousEffective = new Set<string>();
  if (previousOwnerSlug) previousEffective.add(previousOwnerSlug);
  for (const slug of previousSharedSlugs) previousEffective.add(slug);

  for (const slug of previousEffective) {
    if (nextEffective.has(slug)) continue;
    for (const relation of memberRelations) {
      deletes.push({ user: `team:${slug}#member`, relation, object });
    }
    deletes.push({ user: `team:${slug}#admin`, relation: "manager", object });
  }

  return { writes: uniqueTuples(writes), deletes: uniqueTuples(deletes) };
}

/**
 * Canonical input for any group-owned, share-with-teams resource. See
 * `docs/docs/specs/2026-06-03-unified-shareable-resource-rbac/contracts/reconciler-and-route.md`
 * (R1).
 */
export interface ShareableResourceInput {
  objectType: string;
  objectId: string;
  /** Keycloak `sub` of the creator → `user:<sub> creator <type>:<id>` (audit-only, never deleted). */
  creatorSubject?: string | null;
  /** Optional personal/service-account owner subject → `user:<sub> owner <type>:<id>`. */
  ownerSubject?: string | null;
  ownerTeamSlug?: string | null;
  /** Transfer: revokes the old owner team's grants when it differs from `ownerTeamSlug`. */
  previousOwnerTeamSlug?: string | null;
  nextSharedTeamSlugs?: readonly string[] | null;
  previousSharedTeamSlugs?: readonly string[] | null;
  /** Member relations beyond the default `reader` — e.g. `["ingestor"]`, `["user"]`. */
  extraMemberRelations?: readonly string[];
  /** Override the member-relation set entirely (agent uses `["user"]`, not `reader`+extras). */
  memberRelations?: readonly string[];
  /** data_source only → writes `data_source:<id> parent_kb knowledge_base:<parentKnowledgeBaseId>`. */
  parentKnowledgeBaseId?: string | null;
}

/**
 * Build the full tuple diff for a shareable resource: creator (once, audit-
 * only) → owner-subject (optional) → team grants → parent_kb edge (data_source).
 * The emission order is fixed so the per-type exact-order tests stay green.
 */
export function buildShareableResourceTupleDiff(
  input: ShareableResourceInput,
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.objectId)) {
    throw new Error(`Invalid OpenFGA ${input.objectType} id: ${input.objectId}`);
  }
  const object = `${input.objectType}:${input.objectId}`;
  const writes: OpenFgaTupleKey[] = [];

  // 1. creator — provenance only, written once, never deleted (FR-011).
  if (input.creatorSubject && isValidOpenFgaId(input.creatorSubject)) {
    writes.push({ user: `user:${input.creatorSubject}`, relation: "creator", object });
  }

  // 2. optional personal owner subject.
  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({ user: `user:${input.ownerSubject}`, relation: "owner", object });
  }

  // 3. owner-team + shared-team grants (the shared primitive).
  const memberRelations =
    input.memberRelations && input.memberRelations.length > 0
      ? input.memberRelations
      : ["reader", ...(input.extraMemberRelations ?? [])];
  const teamGrants = buildTeamGrantTuples({
    object,
    memberRelations,
    ownerTeamSlug: input.ownerTeamSlug,
    previousOwnerTeamSlug: input.previousOwnerTeamSlug,
    nextSharedTeamSlugs: input.nextSharedTeamSlugs,
    previousSharedTeamSlugs: input.previousSharedTeamSlugs,
  });
  writes.push(...teamGrants.writes);

  // 4. data_source inheritance edge (the model's first tuple-to-userset).
  if (
    input.parentKnowledgeBaseId &&
    isValidOpenFgaId(input.parentKnowledgeBaseId)
  ) {
    writes.push({
      user: `knowledge_base:${input.parentKnowledgeBaseId}`,
      relation: "parent_kb",
      object,
    });
  }

  // creator and parent_kb are never in a delete set — only team grants are.
  return { writes: uniqueTuples(writes), deletes: teamGrants.deletes };
}

export async function reconcileShareableResource(
  input: ShareableResourceInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildShareableResourceTupleDiff(input));
}

export function buildMcpServerRelationshipTupleDiff(
  input: McpServerRelationshipInput
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.serverId)) {
    throw new Error(`Invalid OpenFGA MCP server id: ${input.serverId}`);
  }
  const writes: OpenFgaTupleKey[] = [];
  const object = `mcp_server:${input.serverId}`;
  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({ user: `user:${input.ownerSubject}`, relation: "owner", object });
  }
  if (input.ownerTeamSlug && isValidOpenFgaId(input.ownerTeamSlug)) {
    writes.push(
      { user: `team:${input.ownerTeamSlug}#member`, relation: "user", object },
      { user: `team:${input.ownerTeamSlug}#member`, relation: "invoker", object },
      { user: `team:${input.ownerTeamSlug}#admin`, relation: "manager", object },
    );
  }
  return { writes: uniqueTuples(writes), deletes: [] };
}

export function buildConfigDrivenMcpServerRelationshipTupleDiff(
  input: ConfigDrivenMcpServerRelationshipInput
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.serverId)) {
    throw new Error(`Invalid OpenFGA MCP server id: ${input.serverId}`);
  }
  const organizationId = input.organizationId || "caipe";
  if (!isValidOpenFgaId(organizationId)) {
    throw new Error(`Invalid OpenFGA organization id: ${organizationId}`);
  }

  const object = `mcp_server:${input.serverId}`;
  return {
    writes: uniqueTuples([
      { user: `organization:${organizationId}#member`, relation: "reader", object },
      { user: `organization:${organizationId}#member`, relation: "user", object },
      { user: `organization:${organizationId}#member`, relation: "invoker", object },
      { user: `organization:${organizationId}#admin`, relation: "manager", object },
    ]),
    deletes: [],
  };
}

export function buildLlmModelRelationshipTupleDiff(
  input: LlmModelRelationshipInput
): TeamResourceTupleDiff {
  const modelObjectId = openFgaResourceId("llm_model", input.modelId);
  if (!isValidOpenFgaId(modelObjectId)) {
    throw new Error(`Invalid OpenFGA LLM model id: ${input.modelId}`);
  }
  const writes: OpenFgaTupleKey[] = [];
  const object = `llm_model:${modelObjectId}`;
  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({ user: `user:${input.ownerSubject}`, relation: "owner", object });
  }
  if (input.ownerTeamSlug && isValidOpenFgaId(input.ownerTeamSlug)) {
    writes.push(
      { user: `team:${input.ownerTeamSlug}#member`, relation: "reader", object },
      { user: `team:${input.ownerTeamSlug}#admin`, relation: "manager", object },
    );
  }
  return { writes: uniqueTuples(writes), deletes: [] };
}

export function buildConfigDrivenLlmModelRelationshipTupleDiff(
  input: ConfigDrivenLlmModelRelationshipInput
): TeamResourceTupleDiff {
  const modelObjectId = openFgaResourceId("llm_model", input.modelId);
  if (!isValidOpenFgaId(modelObjectId)) {
    throw new Error(`Invalid OpenFGA LLM model id: ${input.modelId}`);
  }
  const organizationId = input.organizationId || "caipe";
  if (!isValidOpenFgaId(organizationId)) {
    throw new Error(`Invalid OpenFGA organization id: ${organizationId}`);
  }

  const object = `llm_model:${modelObjectId}`;
  return {
    writes: uniqueTuples([
      { user: `organization:${organizationId}#member`, relation: "reader", object },
      { user: `organization:${organizationId}#admin`, relation: "manager", object },
    ]),
    deletes: [],
  };
}

export function buildKnowledgeBaseRelationshipTupleDiff(
  input: KnowledgeBaseRelationshipInput
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.knowledgeBaseId)) {
    throw new Error(`Invalid OpenFGA knowledge base id: ${input.knowledgeBaseId}`);
  }
  // Thin adapter over the shared core (FR-003): a KB member gets
  // `reader` + `ingestor`; the diff order (owner-subject → reader →
  // ingestor → manager) is preserved by `buildShareableResourceTupleDiff`.
  return buildShareableResourceTupleDiff({
    objectType: "knowledge_base",
    objectId: input.knowledgeBaseId,
    creatorSubject: input.creatorSubject,
    ownerSubject: input.ownerSubject,
    ownerTeamSlug: input.ownerTeamSlug,
    previousOwnerTeamSlug: input.previousOwnerTeamSlug,
    nextSharedTeamSlugs: input.nextSharedTeamSlugs,
    previousSharedTeamSlugs: input.previousSharedTeamSlugs,
    extraMemberRelations: ["ingestor"],
  });
}

export async function reconcileMcpServerRelationships(
  input: McpServerRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildMcpServerRelationshipTupleDiff(input));
}

export async function reconcileConfigDrivenMcpServerRelationships(
  input: ConfigDrivenMcpServerRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildConfigDrivenMcpServerRelationshipTupleDiff(input));
}

export async function reconcileLlmModelRelationships(
  input: LlmModelRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildLlmModelRelationshipTupleDiff(input));
}

export async function reconcileConfigDrivenLlmModelRelationships(
  input: ConfigDrivenLlmModelRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildConfigDrivenLlmModelRelationshipTupleDiff(input));
}

export async function reconcileKnowledgeBaseRelationships(
  input: KnowledgeBaseRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildKnowledgeBaseRelationshipTupleDiff(input));
}

// NOTE: `mirrorKnowledgeBaseDiffToDataSource` (PR #1703) was retired by spec
// 2026-06-03 (US4). The data_source now inherits read/ingest/manage from its
// knowledge_base via the `parent_kb` tuple-to-userset edge, so team grants are
// written once on `knowledge_base:<id>` and need not be duplicated onto the
// data_source. Callers write the inheritance edge via
// `buildDataSourceRelationshipTupleDiff({ parentKnowledgeBaseId })` instead.

/**
 * Build a data_source tuple diff with the same owner + shared-teams
 * semantics as `buildKnowledgeBaseRelationshipTupleDiff`. The relation
 * pair on a shared team is the same (`team:<slug>#member reader`,
 * `team:<slug>#admin manager`) — see [deploy/openfga/model.fga] for
 * the `data_source` type definition.
 */
export function buildDataSourceRelationshipTupleDiff(
  input: DataSourceRelationshipInput
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.dataSourceId)) {
    throw new Error(`Invalid OpenFGA data source id: ${input.dataSourceId}`);
  }
  return buildShareableResourceTupleDiff({
    objectType: "data_source",
    objectId: input.dataSourceId,
    creatorSubject: input.creatorSubject,
    ownerSubject: input.ownerSubject,
    ownerTeamSlug: input.ownerTeamSlug,
    nextSharedTeamSlugs: input.nextSharedTeamSlugs,
    previousSharedTeamSlugs: input.previousSharedTeamSlugs,
    previousOwnerTeamSlug: input.previousOwnerTeamSlug,
    parentKnowledgeBaseId: input.parentKnowledgeBaseId,
  });
}

export async function reconcileDataSourceRelationships(
  input: DataSourceRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildDataSourceRelationshipTupleDiff(input));
}

/**
 * Build an mcp_tool tuple diff. Non-admin team members get `reader` +
 * `user` on the tool (so they can call it via the RAG server), and team
 * admins get `manager` (so they can update or delete it via
 * `PUT/DELETE /v1/mcp/custom-tools/<tool_id>`). Mirrors the
 * relation set on the `mcp_tool` type in [deploy/openfga/model.fga].
 */
export function buildMcpToolRelationshipTupleDiff(
  input: McpToolRelationshipInput
): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.toolId)) {
    throw new Error(`Invalid OpenFGA mcp tool id: ${input.toolId}`);
  }
  return buildShareableResourceTupleDiff({
    objectType: "mcp_tool",
    objectId: input.toolId,
    creatorSubject: input.creatorSubject,
    ownerSubject: input.ownerSubject,
    ownerTeamSlug: input.ownerTeamSlug,
    nextSharedTeamSlugs: input.nextSharedTeamSlugs,
    previousSharedTeamSlugs: input.previousSharedTeamSlugs,
    previousOwnerTeamSlug: input.previousOwnerTeamSlug,
    // mcp_tool exposes a `user` relation in addition to `reader`,
    // because the can_call permission grants invocation. Member-level
    // grants need both, mirroring `mcp_server` invokers.
    extraMemberRelations: ["user"],
  });
}

export async function reconcileMcpToolRelationships(
  input: McpToolRelationshipInput
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildMcpToolRelationshipTupleDiff(input));
}

/**
 * Remove every tuple targeting `mcp_tool:<toolId>` so deleting a custom MCP
 * tool leaves no orphaned grants (owner, shared-team, creator, or caller).
 * Closes FR-028 — previously the DELETE path dropped the config but left the
 * OpenFGA tuples dangling, so a future tool reusing the id would inherit stale
 * access. Idempotent: a no-op when reconciliation is disabled.
 */
export async function deleteAllMcpToolRelationshipTuples(
  toolId: string
): Promise<OpenFgaReconcileResult> {
  if (!isValidOpenFgaId(toolId)) {
    throw new Error(`Invalid OpenFGA mcp tool id: ${toolId}`);
  }
  if (!isOpenFgaReconciliationEnabled()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }

  const object = `mcp_tool:${toolId}`;
  const allTuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ tuple: { object }, continuationToken });
    allTuples.push(...page.tuples.map((tuple) => tuple.key));
    continuationToken = page.continuationToken;
  } while (continuationToken);

  return writeOpenFgaTupleDiff({
    writes: [],
    deletes: allTuples.filter((tuple) => tuple.object === object),
  });
}

export async function deleteAllMcpServerRelationshipTuples(
  serverId: string
): Promise<OpenFgaReconcileResult> {
  if (!isValidOpenFgaId(serverId)) {
    throw new Error(`Invalid OpenFGA MCP server id: ${serverId}`);
  }
  if (!isOpenFgaReconciliationEnabled()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }

  const allTuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ continuationToken });
    allTuples.push(...page.tuples.map((tuple) => tuple.key));
    continuationToken = page.continuationToken;
  } while (continuationToken);

  return writeOpenFgaTupleDiff({
    writes: [],
    deletes: allTuples.filter((tuple) => tuple.user === `mcp_server:${serverId}` || tuple.object === `mcp_server:${serverId}`),
  });
}
