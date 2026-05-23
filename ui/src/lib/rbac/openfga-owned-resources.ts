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
  const object = `knowledge_base:${input.knowledgeBaseId}`;
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
