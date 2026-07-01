import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

import {
  isOpenFgaConfigured,
  isOpenFgaReconciliationEnabled,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "./openfga";
import { buildAgentRelationshipTupleDiff } from "./openfga-agent-tools";
import { caipeOrgKey } from "./organization";

const MAX_SAMPLE_TUPLES = 50;

export interface AgentToolOpenFgaSyncAgent {
  agent_id: string;
  name: string;
  config_driven: boolean;
  enabled: boolean;
  expected_tuples: number;
  present_tuples: number;
  missing_tuples: number;
  errors: string[];
}

export interface AgentToolOpenFgaSyncReport {
  checked_at: string;
  status: {
    mongodb_configured: boolean;
    openfga_configured: boolean;
    reconcile_enabled: boolean;
  };
  counts: {
    agents_scanned: number;
    config_driven_agents: number;
    expected_tuples: number;
    present_tuples: number;
    missing_tuples: number;
    applied_tuples: number;
    error_agents: number;
  };
  agents: AgentToolOpenFgaSyncAgent[];
  missing_samples: OpenFgaTupleKey[];
  applied_samples: OpenFgaTupleKey[];
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

function tupleKeysEqual(left: OpenFgaTupleKey, right: OpenFgaTupleKey): boolean {
  return left.user === right.user && left.relation === right.relation && left.object === right.object;
}

function normalizeSharedTeamSlugs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function desiredTuplesForAgent(agent: DynamicAgentConfig, organizationId: string): OpenFgaTupleKey[] {
  const agentSubject = `agent:${String(agent._id)}`;
  const sharedTeamSlugs = normalizeSharedTeamSlugs(agent.shared_with_teams);
  const diff = buildAgentRelationshipTupleDiff({
    agentId: String(agent._id),
    previousAllowedTools: {},
    nextAllowedTools: agent.allowed_tools ?? {},
    ownerSubject: agent.owner_subject ?? agent.owner_id,
    organizationId,
    ownerTeamSlug: agent.owner_team_slug ?? null,
    nextSharedTeamSlugs: sharedTeamSlugs,
    previousSharedTeamSlugs: [],
    globalUserAccess: agent.visibility === "global",
  });
  return uniqueTuples(
    diff.writes.filter(
      (tuple) =>
        tuple.user === agentSubject &&
        tuple.relation === "caller" &&
        tuple.object.startsWith("tool:"),
    ),
  );
}

async function tupleExists(tuple: OpenFgaTupleKey): Promise<boolean> {
  const result = await readOpenFgaTuples({ tuple, pageSize: 1 });
  return result.tuples.some((entry) => tupleKeysEqual(entry.key, tuple));
}

async function loadDynamicAgents(): Promise<DynamicAgentConfig[]> {
  const collection = await getCollection<DynamicAgentConfig>("dynamic_agents");
  return collection
    .find({} as never, {
      projection: {
        _id: 1,
        name: 1,
        allowed_tools: 1,
        owner_subject: 1,
        owner_id: 1,
        owner_team_slug: 1,
        shared_with_teams: 1,
        visibility: 1,
        config_driven: 1,
        enabled: 1,
      },
    })
    .sort({ name: 1 })
    .toArray();
}

export async function checkAgentToolOpenFgaSync(): Promise<AgentToolOpenFgaSyncReport> {
  const report: AgentToolOpenFgaSyncReport = {
    checked_at: new Date().toISOString(),
    status: {
      mongodb_configured: isMongoDBConfigured,
      openfga_configured: isOpenFgaConfigured(),
      reconcile_enabled: isOpenFgaReconciliationEnabled(),
    },
    counts: {
      agents_scanned: 0,
      config_driven_agents: 0,
      expected_tuples: 0,
      present_tuples: 0,
      missing_tuples: 0,
      applied_tuples: 0,
      error_agents: 0,
    },
    agents: [],
    missing_samples: [],
    applied_samples: [],
  };

  if (!isMongoDBConfigured || !isOpenFgaReconciliationEnabled()) {
    return report;
  }

  const organizationId = caipeOrgKey();
  const agents = await loadDynamicAgents();
  report.counts.agents_scanned = agents.length;
  report.counts.config_driven_agents = agents.filter((agent) => agent.config_driven === true).length;

  for (const agent of agents) {
    const agentReport: AgentToolOpenFgaSyncAgent = {
      agent_id: String(agent._id),
      name: agent.name || String(agent._id),
      config_driven: agent.config_driven === true,
      enabled: agent.enabled !== false,
      expected_tuples: 0,
      present_tuples: 0,
      missing_tuples: 0,
      errors: [],
    };

    let desired: OpenFgaTupleKey[];
    try {
      desired = desiredTuplesForAgent(agent, organizationId);
    } catch (error) {
      agentReport.errors.push(error instanceof Error ? error.message : String(error));
      report.counts.error_agents += 1;
      report.agents.push(agentReport);
      continue;
    }

    agentReport.expected_tuples = desired.length;
    report.counts.expected_tuples += desired.length;

    try {
      for (const tuple of desired) {
        if (await tupleExists(tuple)) {
          agentReport.present_tuples += 1;
          report.counts.present_tuples += 1;
        } else {
          agentReport.missing_tuples += 1;
          report.counts.missing_tuples += 1;
          if (report.missing_samples.length < MAX_SAMPLE_TUPLES) {
            report.missing_samples.push(tuple);
          }
        }
      }
    } catch (error) {
      agentReport.errors.push(error instanceof Error ? error.message : String(error));
      report.counts.error_agents += 1;
    }

    report.agents.push(agentReport);
  }

  return report;
}

export async function applyAgentToolOpenFgaSync(): Promise<AgentToolOpenFgaSyncReport> {
  const before = await checkAgentToolOpenFgaSync();
  if (!isMongoDBConfigured || !isOpenFgaReconciliationEnabled() || before.counts.missing_tuples === 0) {
    return before;
  }

  const organizationId = caipeOrgKey();
  const agents = await loadDynamicAgents();
  const missingTuples: OpenFgaTupleKey[] = [];

  for (const agent of agents) {
    let desired: OpenFgaTupleKey[];
    try {
      desired = desiredTuplesForAgent(agent, organizationId);
    } catch {
      continue;
    }
    for (const tuple of desired) {
      if (!(await tupleExists(tuple))) {
        missingTuples.push(tuple);
      }
    }
  }

  const uniqueMissing = uniqueTuples(missingTuples);
  let applied = 0;
  if (uniqueMissing.length > 0) {
    const result = await writeOpenFgaTuples({ writes: uniqueMissing, deletes: [] });
    applied = result.writes;
  }

  const after = await checkAgentToolOpenFgaSync();
  after.counts.applied_tuples = applied;
  after.applied_samples = uniqueMissing.slice(0, MAX_SAMPLE_TUPLES);
  return after;
}
