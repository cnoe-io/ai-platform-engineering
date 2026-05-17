// assisted-by Codex Codex-sonnet-4-6

import type { DynamicAgentConfig } from "@/types/dynamic-agent";

import {
  isOpenFgaReconciliationEnabled,
  readOpenFgaTuples,
  writeOpenFgaTupleDiff,
  type OpenFgaTupleKey,
  type TeamResourceTupleDiff,
  type OpenFgaReconcileResult,
} from "./openfga";

export interface AgentToolTupleDiffInput {
  agentId: string;
  previousAllowedTools?: Record<string, string[]>;
  nextAllowedTools: Record<string, string[]>;
  ownerSubject?: string | null;
}

export interface ReconcileAgentToolTuplesInput extends AgentToolTupleDiffInput {
  failClosed?: boolean;
}

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

function normalizeAllowedTools(
  allowedTools?: Record<string, string[]>,
): Map<string, Set<string>> {
  const normalized = new Map<string, Set<string>>();
  for (const [serverId, tools] of Object.entries(allowedTools ?? {})) {
    if (!isValidOpenFgaId(serverId)) continue;
    const normalizedTools = new Set<string>();
    if (!Array.isArray(tools) || tools.length === 0) {
      normalizedTools.add("*");
    } else {
      for (const tool of tools) {
        if (isValidOpenFgaId(tool)) {
          normalizedTools.add(tool);
        }
      }
    }
    if (normalizedTools.size > 0) {
      normalized.set(serverId, normalizedTools);
    }
  }
  return normalized;
}

function agentToolTuple(agentId: string, serverId: string, toolName: string): OpenFgaTupleKey {
  return {
    user: `agent:${agentId}`,
    relation: "caller",
    object: `tool:${serverId}/${toolName}`,
  };
}

export function buildAgentToolTupleDiff(input: AgentToolTupleDiffInput): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.agentId)) {
    throw new Error(`Invalid OpenFGA agent id: ${input.agentId}`);
  }

  const previous = normalizeAllowedTools(input.previousAllowedTools);
  const next = normalizeAllowedTools(input.nextAllowedTools);
  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];

  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({
      user: `user:${input.ownerSubject}`,
      relation: "owner",
      object: `agent:${input.agentId}`,
    });
  }

  for (const [serverId, tools] of next) {
    const previousTools = previous.get(serverId) ?? new Set<string>();
    for (const toolName of tools) {
      if (!previousTools.has(toolName)) {
        writes.push(agentToolTuple(input.agentId, serverId, toolName));
      }
    }
  }

  for (const [serverId, tools] of previous) {
    const nextTools = next.get(serverId) ?? new Set<string>();
    for (const toolName of tools) {
      if (!nextTools.has(toolName)) {
        deletes.push(agentToolTuple(input.agentId, serverId, toolName));
      }
    }
  }

  return {
    writes: uniqueTuples(writes),
    deletes: uniqueTuples(deletes),
  };
}

export async function reconcileAgentToolTuples(
  input: ReconcileAgentToolTuplesInput,
): Promise<OpenFgaReconcileResult> {
  const diff = buildAgentToolTupleDiff(input);
  try {
    return await writeOpenFgaTupleDiff(diff);
  } catch (error) {
    if (input.failClosed ?? true) {
      throw error;
    }
    console.warn("[openfga-agent-tools] reconciliation failed:", error);
    return { enabled: isOpenFgaReconciliationEnabled(), writes: 0, deletes: 0 };
  }
}

export async function deleteAllAgentToolTuples(agentId: string): Promise<OpenFgaReconcileResult> {
  if (!isValidOpenFgaId(agentId)) {
    throw new Error(`Invalid OpenFGA agent id: ${agentId}`);
  }
  if (!isOpenFgaReconciliationEnabled()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }

  const tuples = await readOpenFgaTuples({
    tuple: { user: `agent:${agentId}`, relation: "caller" },
  });
  return writeOpenFgaTupleDiff({
    writes: [],
    deletes: tuples.tuples.map((tuple) => tuple.key),
  });
}

export function allowedToolsFromAgent(agent: Pick<DynamicAgentConfig, "allowed_tools">): Record<string, string[]> {
  return (agent.allowed_tools ?? {}) as Record<string, string[]>;
}
