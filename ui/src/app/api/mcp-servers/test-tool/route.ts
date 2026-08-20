/**
 * Invoke a saved MCP server tool for post-save testing.
 */

// assisted-by Codex Codex-sonnet-4-6

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import {
  readMcpToolApplicationSuccess,
  resolveMcpHeaderCredentials,
  isMcpCredentialUnavailableError,
} from "@/lib/mcp-credential-headers";
import {
  diagnosticAgentId,
  invokeHttpMcpTool,
  isAgentGatewayEndpoint,
} from "@/lib/mcp-http-server-client";
import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { MCPServerConfig } from "@/types/dynamic-agent";
import { trustedInteractionFromRequest } from "@/lib/authz/trusted-interaction";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "mcp_servers";

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  return value.trim();
}

function readParams(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("params must be a JSON object", 400, "VALIDATION_ERROR");
  }
  return value as Record<string, unknown>;
}

function diagnosticOpenFgaTuples(
  serverId: string,
  agentId: string,
  session: Awaited<ReturnType<typeof getAuthFromBearerOrSession>>["session"],
): OpenFgaTupleKey[] {
  const subject = typeof session?.sub === "string" ? session.sub.trim() : "";
  if (!subject) return [];
  return [
    { user: `user:${subject}`, relation: "user", object: `agent:${agentId}` },
    { user: `agent:${agentId}`, relation: "caller", object: `tool:${serverId}/*` },
  ];
}

async function grantDiagnosticAgentAccess(
  serverId: string,
  agentId: string,
  session: Awaited<ReturnType<typeof getAuthFromBearerOrSession>>["session"],
): Promise<OpenFgaTupleKey[]> {
  const writes = diagnosticOpenFgaTuples(serverId, agentId, session);
  if (!writes.length) return [];
  await writeOpenFgaTuples({ writes, deletes: [] });
  return writes;
}

async function revokeDiagnosticAgentAccess(tuples: OpenFgaTupleKey[]): Promise<void> {
  if (!tuples.length) return;
  try {
    await writeOpenFgaTuples({ writes: [], deletes: tuples });
  } catch (error) {
    console.warn("[mcp-servers/test-tool] failed to remove diagnostic AgentGateway tuples", error);
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const body = (await request.json()) as Record<string, unknown>;
  const serverId = readString(body.serverId, "serverId");
  const toolName = readString(body.toolName, "toolName");
  const params = readParams(body.params);
  const interaction = trustedInteractionFromRequest(request);

  await requireResourcePermission(
    session,
    { type: "mcp_server", id: serverId, action: "invoke" },
    { trustedContext: { interaction } },
  );

  const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
  const server = await collection.findOne({ _id: serverId });
  if (!server) throw new ApiError("MCP server not found", 404);
  if (!server.enabled) throw new ApiError("MCP server is disabled", 400);
  if (server.transport !== "http" || !server.endpoint) {
    throw new ApiError("Tool testing currently supports HTTP MCP servers", 400, "UNSUPPORTED_TRANSPORT");
  }

  const viaAgentGateway = isAgentGatewayEndpoint(server);
  const diagnosticAgent = diagnosticAgentId(serverId, session);
  const diagnosticTuples = viaAgentGateway
    ? await grantDiagnosticAgentAccess(serverId, diagnosticAgent, session)
    : [];

  try {
    let credentialResolution;
    try {
      credentialResolution = await resolveMcpHeaderCredentials({
        request,
        session,
        server,
        viaAgentGateway,
        retrievalCaller: "mcp-test-tool",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "MCP_AUTH_REQUIRED") {
        throw new ApiError(
          "A signed-in user token is required to test AgentGateway-routed MCP tools",
          401,
          "MCP_TEST_AUTH_REQUIRED",
        );
      }
      if (isMcpCredentialUnavailableError(error)) {
        throw new ApiError(
          error instanceof Error ? error.message : "MCP provider credential is unavailable",
          401,
          "MCP_CREDENTIAL_UNAVAILABLE",
        );
      }
      throw error;
    }

    const invoked = await invokeHttpMcpTool({
      request,
      session,
      server: server as MCPServerConfig & { endpoint: string },
      serverId,
      toolName,
      params,
      credentialResolution,
    });
    const payload = invoked.payload as { error?: { message?: unknown }; result?: unknown } | null;
    const errorMessage = typeof payload?.error?.message === "string" ? payload.error.message : undefined;
    const toolResult = payload?.result ?? invoked.payload;
    const applicationSuccess = readMcpToolApplicationSuccess(toolResult);
    const transportSuccess = invoked.ok && !payload?.error;

    return successResponse({
      server_id: serverId,
      tool_name: toolName,
      success: transportSuccess,
      application_success: applicationSuccess ?? transportSuccess,
      status: invoked.status,
      result: toolResult,
      credential_resolution: credentialResolution.sources,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  } finally {
    await revokeDiagnosticAgentAccess(diagnosticTuples);
  }
});
