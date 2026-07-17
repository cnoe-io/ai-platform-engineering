/**
 * Mint a short-lived signed agent context covering one or more MCP servers
 * for CLI/local callers invoking tools directly through AgentGateway.
 *
 * AgentGateway's openfga-authz-bridge rejects tools/call requests with
 * "missing or invalid signed agent context" once CAIPE_AGENT_CONTEXT_HMAC_SECRET
 * is set, because that header pair is normally only produced by the Dynamic
 * Agents runtime (or this UI's own diagnostic test-tool flow). A bare local
 * client authenticates with a user's bearer token but has no way to produce
 * that signature itself, since the HMAC secret must stay in-cluster. This
 * route lets an authenticated user mint one context that authorizes calls
 * against every server they request (or every server they can invoke, if
 * none are requested), since the signature itself carries no per-server
 * scope — scoping comes entirely from the OpenFGA `caller` tuples granted
 * for the minted agent id before signing.
 */

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import {
  buildAgentContextHeaders,
  grantDiagnosticAgentAccessForServers,
  multiServerAgentContextId,
  revokeDiagnosticAgentAccess,
} from "@/lib/mcp-http-server-client";
import { filterResourcesByPermission } from "@/lib/rbac/resource-authz";
import type { MCPServerConfig } from "@/types/dynamic-agent";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "mcp_servers";

function readRequestedServerIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new ApiError("serverIds must be an array of strings", 400, "VALIDATION_ERROR");
  }
  const ids = value.map((entry) => entry.trim()).filter(Boolean);
  return [...new Set(ids)];
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const body = request.headers.get("content-length") === "0" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
  const requestedServerIds = readRequestedServerIds(body.serverIds);

  const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
  const candidateServers =
    requestedServerIds !== undefined
      ? await collection.find({ _id: { $in: requestedServerIds }, enabled: true }).toArray()
      : await collection.find({ enabled: true }).toArray();

  const invokableServers = await filterResourcesByPermission(session, candidateServers, {
    type: "mcp_server",
    action: "invoke",
    id: (server: MCPServerConfig) => String(server._id),
  });

  if (requestedServerIds !== undefined) {
    const invokableIds = new Set(invokableServers.map((server) => String(server._id)));
    const missing = requestedServerIds.filter((id) => !invokableIds.has(id));
    if (missing.length > 0) {
      throw new ApiError(
        `Not authorized to invoke MCP server(s): ${missing.join(", ")}`,
        403,
        "mcp_server#invoke",
      );
    }
  } else if (invokableServers.length === 0) {
    throw new ApiError("No invokable MCP servers found for this user.", 404, "NO_INVOKABLE_SERVERS");
  }

  const serverIds = invokableServers.map((server) => String(server._id));
  const agentId = multiServerAgentContextId(session);
  const tuples = await grantDiagnosticAgentAccessForServers(serverIds, agentId, session);

  try {
    const headers = buildAgentContextHeaders(agentId);
    if (Object.keys(headers).length === 0) {
      throw new ApiError(
        "Agent context signing is not configured on this deployment.",
        503,
        "AGENT_CONTEXT_UNAVAILABLE",
      );
    }
    return successResponse({ headers, server_ids: serverIds });
  } finally {
    await revokeDiagnosticAgentAccess(tuples, "mcp-servers-agent-context");
  }
});
