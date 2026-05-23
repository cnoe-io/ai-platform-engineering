// assisted-by Codex Codex-sonnet-4-6

import { MongoClient } from "mongodb";

export const MIGRATION_ID = "openfga_agent_tool_backfill_v1";
const DEFAULT_STORE_NAME = "caipe-openfga";
const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

export interface OpenFgaTupleKey {
  user: string;
  relation: string;
  object: string;
}

export interface DynamicAgentDoc {
  _id?: unknown;
  id?: string;
  allowed_tools?: Record<string, string[]>;
  deleted_at?: unknown;
  status?: string;
}

export interface AgentToolBackfillPlan {
  tuples: OpenFgaTupleKey[];
  agentIds: string[];
  warnings: string[];
  counts: {
    agentsScanned: number;
    agentsWithTools: number;
    tuplesPlanned: number;
    invalidIdentifiers: number;
  };
}

export interface AgentToolTupleDiff {
  writes: OpenFgaTupleKey[];
  deletes: OpenFgaTupleKey[];
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function isValidOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

function isValidToolName(value: unknown): value is string {
  return value === "*" || isValidOpenFgaId(value);
}

function agentId(agent: DynamicAgentDoc): string | null {
  return normalizeString(agent.id) ?? normalizeString(agent._id);
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

export function deriveAgentToolBackfillPlan(agents: DynamicAgentDoc[]): AgentToolBackfillPlan {
  const tuples: OpenFgaTupleKey[] = [];
  const agentIds: string[] = [];
  const warnings: string[] = [];
  let invalidIdentifiers = 0;
  let agentsWithTools = 0;

  for (const agent of agents) {
    const id = agentId(agent);
    if (!id || !isValidOpenFgaId(id)) {
      invalidIdentifiers += 1;
      warnings.push(`Skipping dynamic agent with invalid id: ${String(id ?? agent._id ?? agent.id)}`);
      continue;
    }
    agentIds.push(id);
    const allowedTools = agent.allowed_tools ?? {};
    if (Object.keys(allowedTools).length === 0) continue;
    agentsWithTools += 1;

    for (const [serverId, tools] of Object.entries(allowedTools)) {
      if (!isValidOpenFgaId(serverId)) {
        invalidIdentifiers += 1;
        warnings.push(`Skipping invalid MCP server id for agent ${id}: ${serverId}`);
        continue;
      }
      const toolNames = Array.isArray(tools) && tools.length > 0 ? tools : ["*"];
      for (const toolName of toolNames) {
        if (!isValidToolName(toolName)) {
          invalidIdentifiers += 1;
          warnings.push(`Skipping invalid tool id for agent ${id}/${serverId}: ${toolName}`);
          continue;
        }
        tuples.push({
          user: `agent:${id}`,
          relation: "caller",
          object: `tool:${serverId}/${toolName}`,
        });
      }
    }
  }

  const unique = uniqueTuples(tuples);
  return {
    tuples: unique,
    agentIds: Array.from(new Set(agentIds)),
    warnings,
    counts: {
      agentsScanned: agents.length,
      agentsWithTools,
      tuplesPlanned: unique.length,
      invalidIdentifiers,
    },
  };
}

export function buildAgentToolTupleDiff(input: {
  desiredTuples: OpenFgaTupleKey[];
  existingTuples: OpenFgaTupleKey[];
}): AgentToolTupleDiff {
  const desired = uniqueTuples(input.desiredTuples);
  const existing = uniqueTuples(input.existingTuples);
  const desiredKeys = new Set(desired.map((tuple) => `${tuple.user}\n${tuple.relation}\n${tuple.object}`));
  const existingKeys = new Set(existing.map((tuple) => `${tuple.user}\n${tuple.relation}\n${tuple.object}`));
  return {
    writes: desired.filter((tuple) => !existingKeys.has(`${tuple.user}\n${tuple.relation}\n${tuple.object}`)),
    deletes: existing.filter((tuple) => !desiredKeys.has(`${tuple.user}\n${tuple.relation}\n${tuple.object}`)),
  };
}

async function getOpenFgaStoreId(baseUrl: string, storeName: string): Promise<string> {
  const response = await fetch(`${baseUrl}/stores`);
  if (!response.ok) {
    throw new Error(`OpenFGA store lookup failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { stores?: Array<{ id?: string; name?: string }> };
  const store = (payload.stores ?? []).find((item) => item.name === storeName);
  if (!store?.id) {
    throw new Error(`OpenFGA store ${storeName} was not found`);
  }
  return store.id;
}

async function readAgentToolTuples(
  baseUrl: string,
  storeId: string,
  agentIds: string[]
): Promise<OpenFgaTupleKey[]> {
  const tuples: OpenFgaTupleKey[] = [];
  const agentUsers = new Set(agentIds.map((id) => `agent:${id}`));
  let continuationToken: string | undefined;
  do {
    const response = await fetch(`${baseUrl}/stores/${storeId}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page_size: 100,
        ...(continuationToken ? { continuation_token: continuationToken } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenFGA tuple read failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      tuples?: Array<{ key?: OpenFgaTupleKey }>;
      continuation_token?: string;
    };
    for (const tuple of payload.tuples ?? []) {
      if (
        tuple.key &&
        agentUsers.has(tuple.key.user) &&
        tuple.key.relation === "caller" &&
        tuple.key.object.startsWith("tool:")
      ) {
        tuples.push({
          user: tuple.key.user,
          relation: tuple.key.relation,
          object: tuple.key.object,
        });
      }
    }
    continuationToken = payload.continuation_token || undefined;
  } while (continuationToken);
  return uniqueTuples(tuples);
}

async function writeTupleDiff(baseUrl: string, storeId: string, diff: AgentToolTupleDiff): Promise<void> {
  if (diff.writes.length === 0 && diff.deletes.length === 0) return;
  const response = await fetch(`${baseUrl}/stores/${storeId}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(diff.writes.length > 0 ? { writes: { tuple_keys: diff.writes } } : {}),
      ...(diff.deletes.length > 0 ? { deletes: { tuple_keys: diff.deletes } } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenFGA tuple write failed: ${response.status} ${await response.text()}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "ai_platform_engineering";
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(databaseName);
    const agents = await db
      .collection<DynamicAgentDoc>("dynamic_agents")
      .find({ deleted_at: { $exists: false } })
      .toArray();
    const plan = deriveAgentToolBackfillPlan(agents);
    console.log(JSON.stringify({ migration: MIGRATION_ID, apply, ...plan }, null, 2));

    if (!apply) return;
    const baseUrl = process.env.OPENFGA_HTTP;
    if (!baseUrl) {
      throw new Error("OPENFGA_HTTP is required when --apply is set");
    }
    const storeId = process.env.OPENFGA_STORE_ID || (await getOpenFgaStoreId(baseUrl, process.env.OPENFGA_STORE_NAME || DEFAULT_STORE_NAME));
    const existingTuples = await readAgentToolTuples(baseUrl, storeId, plan.agentIds);
    const diff = buildAgentToolTupleDiff({ desiredTuples: plan.tuples, existingTuples });
    console.log(JSON.stringify({ migration: MIGRATION_ID, openfgaDiff: diff }, null, 2));
    await writeTupleDiff(baseUrl, storeId, diff);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
