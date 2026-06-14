// assisted-by Cursor:composer-2.5
//
// Server-facing OpenFGA reconciliation for owned/shareable resources.
// Tuple builders live in openfga-owned-resources.ts (pure, no Mongo/CAS).

import {
  reconcileTupleDiff,
  OpenFgaReconcileRequiredError,
  type TupleReconcileContext,
} from "@/lib/authz";
import {
  isOpenFgaReconciliationEnabled,
  readOpenFgaTuples,
  type OpenFgaReconcileResult,
  type OpenFgaTupleKey,
  type TeamResourceTupleDiff,
} from "./openfga";
import {
  buildConfigDrivenLlmModelRelationshipTupleDiff,
  buildConfigDrivenMcpServerRelationshipTupleDiff,
  buildDataSourceRelationshipTupleDiff,
  buildKnowledgeBaseRelationshipTupleDiff,
  buildLlmModelRelationshipTupleDiff,
  buildMcpServerRelationshipTupleDiff,
  buildMcpToolRelationshipTupleDiff,
  buildShareableResourceTupleDiff,
  type ConfigDrivenLlmModelRelationshipInput,
  type ConfigDrivenMcpServerRelationshipInput,
  type DataSourceRelationshipInput,
  type KnowledgeBaseRelationshipInput,
  type LlmModelRelationshipInput,
  type McpServerRelationshipInput,
  type McpToolRelationshipInput,
  type ShareableResourceInput,
} from "./openfga-owned-resources";

export { OpenFgaReconcileRequiredError } from "@/lib/authz";

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

function assertReconciliationEnabled(diff: TeamResourceTupleDiff): void {
  if (
    !isOpenFgaReconciliationEnabled() &&
    (diff.writes.length > 0 || diff.deletes.length > 0)
  ) {
    throw new OpenFgaReconcileRequiredError();
  }
}

async function reconcileOwnedResource(
  diff: TeamResourceTupleDiff,
  ctx?: TupleReconcileContext,
): Promise<OpenFgaReconcileResult> {
  assertReconciliationEnabled(diff);
  return reconcileTupleDiff(diff, ctx);
}

export async function reconcileShareableResource(
  input: ShareableResourceInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildShareableResourceTupleDiff(input));
}

export async function reconcileMcpServerRelationships(
  input: McpServerRelationshipInput,
  ctx?: TupleReconcileContext,
): Promise<OpenFgaReconcileResult> {
  const ownerKind = input.ownerSubjectKind ?? "user";
  return reconcileTupleDiff(buildMcpServerRelationshipTupleDiff(input), {
    ...ctx,
    source: ctx?.source ?? "mcp_server_create",
    caller:
      ctx?.caller ??
      (input.ownerSubject
        ? { type: ownerKind, id: input.ownerSubject }
        : undefined),
  });
}

export async function reconcileConfigDrivenMcpServerRelationships(
  input: ConfigDrivenMcpServerRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildConfigDrivenMcpServerRelationshipTupleDiff(input));
}

export async function reconcileLlmModelRelationships(
  input: LlmModelRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildLlmModelRelationshipTupleDiff(input));
}

export async function reconcileConfigDrivenLlmModelRelationships(
  input: ConfigDrivenLlmModelRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildConfigDrivenLlmModelRelationshipTupleDiff(input));
}

export async function reconcileKnowledgeBaseRelationships(
  input: KnowledgeBaseRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildKnowledgeBaseRelationshipTupleDiff(input));
}

export async function reconcileDataSourceRelationships(
  input: DataSourceRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildDataSourceRelationshipTupleDiff(input));
}

export async function reconcileMcpToolRelationships(
  input: McpToolRelationshipInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileOwnedResource(buildMcpToolRelationshipTupleDiff(input));
}

/**
 * Remove every tuple targeting `mcp_tool:<toolId>` so deleting a custom MCP
 * tool leaves no orphaned grants.
 */
export async function deleteAllMcpToolRelationshipTuples(
  toolId: string,
): Promise<OpenFgaReconcileResult> {
  if (!isOpenFgaReconciliationEnabled()) {
    throw new OpenFgaReconcileRequiredError();
  }

  const object = `mcp_tool:${toolId}`;
  const allTuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ tuple: { object }, continuationToken });
    allTuples.push(...page.tuples.map((tuple) => tuple.key));
    continuationToken = page.continuationToken;
  } while (continuationToken);

  const diff = {
    writes: [] as OpenFgaTupleKey[],
    deletes: allTuples.filter((tuple) => tuple.object === object),
  };
  assertReconciliationEnabled(diff);
  return reconcileTupleDiff(diff, { source: "mcp_tool_delete" });
}

const MCP_TOOL_WILDCARD_SUFFIX = "_*";

function mcpServerRelatedObjects(serverId: string): string[] {
  return [
    `mcp_server:${serverId}`,
    `mcp_tool:${serverId}${MCP_TOOL_WILDCARD_SUFFIX}`,
    `tool:${serverId}${MCP_TOOL_WILDCARD_SUFFIX}`,
    `tool:${serverId}/*`,
  ];
}

async function readAllTuplesForObject(object: string): Promise<OpenFgaTupleKey[]> {
  const tuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ tuple: { object }, continuationToken });
    tuples.push(...page.tuples.map((entry) => entry.key));
    continuationToken = page.continuationToken;
  } while (continuationToken);
  return tuples;
}

/**
 * Remove every OpenFGA tuple created for an MCP server: server grants,
 * legacy tool-prefix grants, gateway wildcard tool grants, and mcp_tool rows.
 */
export async function deleteAllMcpServerRelationshipTuples(
  serverId: string,
  ctx?: TupleReconcileContext,
): Promise<OpenFgaReconcileResult> {
  if (!isOpenFgaReconciliationEnabled()) {
    throw new OpenFgaReconcileRequiredError();
  }

  const deletes: OpenFgaTupleKey[] = [];
  for (const object of mcpServerRelatedObjects(serverId)) {
    deletes.push(...(await readAllTuplesForObject(object)));
  }

  const diff = { writes: [] as OpenFgaTupleKey[], deletes: uniqueTuples(deletes) };
  assertReconciliationEnabled(diff);
  return reconcileTupleDiff(diff, {
    ...ctx,
    source: ctx?.source ?? "mcp_server_delete",
  });
}
