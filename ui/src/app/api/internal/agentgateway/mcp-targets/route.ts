// assisted-by Codex Codex-sonnet-4-6

import { getCollection } from "@/lib/mongodb";
import type { MCPCredentialSource, MCPServerConfig } from "@/types/dynamic-agent";
import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

const COLLECTION_NAME = "mcp_servers";
const SAFE_TARGET_ID = /^[A-Za-z0-9._-]+$/;

interface AgentGatewayBridgeTarget {
  id: string;
  target_endpoint: string;
  credential_sources?: MCPCredentialSource[];
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function authorizeBridgeRequest(request: NextRequest): Response | null {
  const expected = process.env.AGENTGATEWAY_TARGETS_TOKEN?.trim();
  if (!expected) {
    return Response.json({ error: "AgentGateway targets token is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const actual = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!actual || !tokenMatches(actual, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function toBridgeTarget(server: MCPServerConfig): AgentGatewayBridgeTarget | null {
  if ((server as { source?: unknown }).source !== "agentgateway" || server.enabled === false) return null;

  const id = typeof server._id === "string" ? server._id.trim() : "";
  const targetEndpoint =
    typeof server.agentgateway_target_endpoint === "string"
      ? server.agentgateway_target_endpoint.trim()
      : "";
  if (!id || !SAFE_TARGET_ID.test(id) || !targetEndpoint) return null;

  return {
    id,
    target_endpoint: targetEndpoint,
    ...(Array.isArray(server.credential_sources)
      ? { credential_sources: server.credential_sources }
      : {}),
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const unauthorized = authorizeBridgeRequest(request);
  if (unauthorized) return unauthorized;

  const collection = await getCollection<MCPServerConfig>(COLLECTION_NAME);
  const servers = await collection
    .find({
      source: "agentgateway",
      enabled: { $ne: false },
    } as never)
    .toArray();
  const targets = servers.flatMap((server) => {
    const target = toBridgeTarget(server);
    return target ? [target] : [];
  });

  return Response.json({ targets });
}
