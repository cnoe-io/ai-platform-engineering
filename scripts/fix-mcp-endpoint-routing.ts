// assisted-by Codex Codex-sonnet-4-6

/**
 * One-shot repair for the "bare AgentGateway MCP endpoint" class of
 * misconfiguration.
 *
 * Background: MCP servers routed through AgentGateway must be stored
 * with a target-qualified endpoint
 * (``http://agentgateway:4000/mcp/<server_id>``). A bare
 * ``http://agentgateway:4000/mcp`` falls through to AgentGateway's
 * ``/mcp`` route, which is not registered, and returns 404 on every
 * probe and tool call. The class first surfaced in production as the
 * Confluence card showing
 *     Failed to connect to MCP server: HTTP 404 Not Found from
 *     http://agentgateway:4000/mcp
 *
 * The Web UI BFF and the dynamic-agents probe now normalise endpoints
 * on save and on read respectively, but pre-existing Mongo rows still
 * carry the broken value. This script audits the ``mcp_servers``
 * collection and rewrites those rows to the canonical form.
 *
 * Behaviour:
 *   - DRY-RUN by default — prints the list of rows that would change
 *     plus the proposed `endpoint` value, no Mongo writes.
 *   - Pass ``--apply`` to actually write the corrected endpoints back.
 *   - Direct-upstream URLs (e.g. ``http://mcp-confluence:8000/mcp``)
 *     are left untouched because AgentGateway routing is opt-in per
 *     server and rewriting them would break stdio / in-cluster paths.
 *   - Idempotent: a second run after ``--apply`` is a no-op.
 *
 * Env:
 *   MONGODB_URI           Mongo connection string (required)
 *   MONGODB_DATABASE      Database name (default: ai_platform_engineering)
 *   MCP_SERVERS_COLLECTION  Collection name (default: mcp_servers)
 *   AGENT_GATEWAY_URL     AgentGateway base URL — used as the matcher
 *                         anchor (default: http://agentgateway:4000)
 */

import { MongoClient } from "mongodb";

export const MIGRATION_ID = "mcp_endpoint_routing_repair_v1";

export interface McpServerEndpointDoc {
  _id?: unknown;
  endpoint?: unknown;
  config_driven?: unknown;
  transport?: unknown;
}

export interface RepairCandidate {
  id: string;
  currentEndpoint: string;
  proposedEndpoint: string;
  reason:
    | "bare_gateway_base"
    | "gateway_root_only"
    | "wrong_target_suffix"
    | "trailing_slash";
}

export interface RepairPlan {
  candidates: RepairCandidate[];
  counts: {
    scanned: number;
    healthy: number;
    untouchedDirectUpstream: number;
    untouchedNonHttpTransports: number;
    untouchedConfigDriven: number;
    proposed: number;
  };
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function collapseSlashes(url: string): string {
  return url.replace(/([^:])\/{2,}/g, "$1/");
}

function withoutMcpSuffix(url: string): string {
  return url.endsWith("/mcp") ? url.slice(0, -"/mcp".length) : url;
}

function originOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i.exec(url);
  return match ? match[1] : "";
}

export function normalizeMcpEndpointForServer(input: {
  endpoint: string | undefined;
  serverId: string;
  agentGatewayBaseUrl: string;
}): string | undefined {
  const { endpoint, serverId, agentGatewayBaseUrl } = input;
  if (endpoint === undefined) return undefined;
  if (endpoint === "") return "";
  if (!serverId.trim()) return endpoint;

  const trimmedEndpoint = stripTrailingSlashes(collapseSlashes(endpoint));
  const trimmedBase = stripTrailingSlashes(collapseSlashes(agentGatewayBaseUrl));
  if (!trimmedBase) return endpoint;

  if (originOf(trimmedEndpoint) !== originOf(trimmedBase)) {
    return endpoint;
  }

  const baseWithMcp = trimmedBase.endsWith("/mcp")
    ? trimmedBase
    : `${trimmedBase}/mcp`;
  return `${baseWithMcp}/${serverId.trim()}`;
}

function classifyCandidate(
  currentEndpoint: string,
  agentGatewayBaseUrl: string,
): RepairCandidate["reason"] | null {
  const trimmedEndpoint = stripTrailingSlashes(collapseSlashes(currentEndpoint));
  const trimmedBase = stripTrailingSlashes(collapseSlashes(agentGatewayBaseUrl));
  if (originOf(trimmedEndpoint) !== originOf(trimmedBase)) return null;

  const withoutMcp = withoutMcpSuffix(trimmedEndpoint);
  const baseWithoutMcp = withoutMcpSuffix(trimmedBase);

  // Exact bare base (with or without /mcp).
  if (withoutMcp === baseWithoutMcp) {
    return trimmedEndpoint === baseWithoutMcp
      ? "gateway_root_only"
      : "bare_gateway_base";
  }

  // Trailing-slash variants of the bare base were already collapsed by
  // stripTrailingSlashes(); if we get here and the endpoint sits under
  // `{base}/mcp/<something>` that doesn't match the serverId, it's a
  // wrong-suffix case which the caller (using serverId) will detect.
  return null;
}

export function buildRepairPlan(
  servers: McpServerEndpointDoc[],
  agentGatewayBaseUrl: string,
): RepairPlan {
  const plan: RepairPlan = {
    candidates: [],
    counts: {
      scanned: 0,
      healthy: 0,
      untouchedDirectUpstream: 0,
      untouchedNonHttpTransports: 0,
      untouchedConfigDriven: 0,
      proposed: 0,
    },
  };

  for (const server of servers) {
    plan.counts.scanned += 1;
    const id =
      typeof server._id === "string"
        ? server._id
        : server._id !== undefined
          ? String(server._id)
          : "";
    if (!id) continue;

    const endpoint = typeof server.endpoint === "string" ? server.endpoint : "";
    if (!endpoint) {
      plan.counts.untouchedNonHttpTransports += 1;
      continue;
    }
    // We refuse to mutate config-driven servers — their source of truth
    // is config.yaml, not Mongo. If they're bad we tell the operator
    // and let them fix the config file.
    if (server.config_driven) {
      plan.counts.untouchedConfigDriven += 1;
      continue;
    }

    const trimmedBase = stripTrailingSlashes(collapseSlashes(agentGatewayBaseUrl));
    if (originOf(endpoint) !== originOf(trimmedBase)) {
      plan.counts.untouchedDirectUpstream += 1;
      continue;
    }

    const proposed = normalizeMcpEndpointForServer({
      endpoint,
      serverId: id,
      agentGatewayBaseUrl,
    });
    if (proposed === endpoint || proposed === undefined) {
      plan.counts.healthy += 1;
      continue;
    }

    // Classify so the dry-run output explains *why* the row is being
    // rewritten. Detection is broader than strict-match because we want
    // wrong-target-suffix repairs too.
    const baseReason = classifyCandidate(endpoint, agentGatewayBaseUrl);
    const reason: RepairCandidate["reason"] =
      baseReason ?? "wrong_target_suffix";

    plan.candidates.push({
      id,
      currentEndpoint: endpoint,
      proposedEndpoint: proposed,
      reason,
    });
    plan.counts.proposed += 1;
  }

  return plan;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "ai_platform_engineering";
  const collectionName = process.env.MCP_SERVERS_COLLECTION || "mcp_servers";
  const rawBase = (
    process.env.AGENT_GATEWAY_URL ||
    process.env.AGENTGATEWAY_URL ||
    "http://agentgateway:4000"
  ).trim();
  const agentGatewayBaseUrl = rawBase.endsWith("/mcp")
    ? rawBase.slice(0, -"/mcp".length)
    : rawBase;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(databaseName);
    const servers = await db
      .collection<McpServerEndpointDoc>(collectionName)
      .find({})
      .toArray();
    const plan = buildRepairPlan(servers, agentGatewayBaseUrl);

    console.log(
      JSON.stringify(
        {
          migration: MIGRATION_ID,
          apply,
          agentGatewayBaseUrl,
          ...plan,
        },
        null,
        2,
      ),
    );

    if (!apply) {
      if (plan.candidates.length > 0) {
        console.log(
          `\n[dry-run] ${plan.candidates.length} row(s) would be repaired. ` +
            `Re-run with --apply to write changes.`,
        );
      } else {
        console.log("\n[dry-run] No repairs needed.");
      }
      return;
    }

    if (plan.candidates.length === 0) {
      console.log("No repairs needed; nothing to apply.");
      return;
    }

    const collection = db.collection<McpServerEndpointDoc>(collectionName);
    const now = new Date().toISOString();
    let applied = 0;
    for (const candidate of plan.candidates) {
      const result = await collection.updateOne(
        { _id: candidate.id } as never,
        {
          $set: {
            endpoint: candidate.proposedEndpoint,
            updated_at: now,
          },
        },
      );
      if (result.modifiedCount === 1) {
        applied += 1;
        console.log(
          `  repaired ${candidate.id}: ${candidate.currentEndpoint} → ${candidate.proposedEndpoint}`,
        );
      } else {
        console.warn(
          `  skipped ${candidate.id}: modifiedCount=${result.modifiedCount} (matched=${result.matchedCount}). ` +
            `Row may have been edited concurrently — re-run dry-run to re-verify.`,
        );
      }
    }
    console.log(`\nApplied ${applied}/${plan.candidates.length} repairs.`);
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
