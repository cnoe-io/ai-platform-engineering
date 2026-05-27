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
   * unchecking a team in the UI genuinely revokes access — instead of
   * leaving a dangling tuple, the bug pattern that motivated PR 3 of the
   * 2026-05-27 fine-grained KB ReBAC plan.
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
  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];
  const object = `knowledge_base:${input.knowledgeBaseId}`;

  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({ user: `user:${input.ownerSubject}`, relation: "owner", object });
  }

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

  // Effective desired team slugs = owner ∪ shared. The union semantics
  // mirror `reconcileAgentRelationships` so an owner team that's also
  // listed in the shared-teams picker doesn't double-write OR get its
  // grant deleted on subsequent reconciles.
  const nextEffective = new Set<string>();
  if (nextOwnerSlug) nextEffective.add(nextOwnerSlug);
  for (const slug of nextSharedSlugs) nextEffective.add(slug);

  for (const slug of nextEffective) {
    writes.push(
      { user: `team:${slug}#member`, relation: "reader", object },
      { user: `team:${slug}#admin`, relation: "manager", object },
    );
  }

  const previousEffective = new Set<string>();
  if (previousOwnerSlug) previousEffective.add(previousOwnerSlug);
  for (const slug of previousSharedSlugs) previousEffective.add(slug);

  for (const slug of previousEffective) {
    if (nextEffective.has(slug)) continue;
    deletes.push(
      { user: `team:${slug}#member`, relation: "reader", object },
      { user: `team:${slug}#admin`, relation: "manager", object },
    );
  }

  return { writes: uniqueTuples(writes), deletes: uniqueTuples(deletes) };
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
