/**
 * Test MCP server credential_sources by making a live probe request with resolved headers.
 */

// assisted-by claude code claude-sonnet-4-6

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { isMcpCredentialUnavailableError, resolveMcpHeaderCredentials } from "@/lib/mcp-credential-headers";
import { isAgentGatewayEndpoint } from "@/lib/mcp-http-server-client";
import type { McpCredentialResolution } from "@/lib/mcp-credential-headers";
import type { MCPCredentialSource } from "@/types/dynamic-agent";
import { NextRequest } from "next/server";

interface CredentialProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  credentialOrigins: { name: string; origin: string; provider?: string }[];
  missingCredentials: string[];
}

function normalizedUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("Endpoint URL is required", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError("Endpoint URL must be a valid URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError("Endpoint URL must use http or https", 400);
  }
  return parsed.toString().replace(/\/$/, "");
}

function parseSseJson(text: string): unknown | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    try {
      return JSON.parse(data);
    } catch {
      continue;
    }
  }
  return null;
}

async function readJsonOrSse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    const payload = parseSseJson(text);
    if (payload !== null) return payload;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function initializeError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return "MCP initialize returned an invalid response";
  const message = (payload as { error?: { message?: unknown } }).error?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const result = (payload as { result?: unknown }).result;
  return result && typeof result === "object"
    ? null
    : "MCP initialize returned an invalid JSON-RPC response";
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(
    session,
    { type: "organization", id: caipeOrgKey(), action: "use" },
    { bypassForOrgAdmin: true },
  );

  const body = await request.json();
  const url = normalizedUrl(body.url);
  const credentialSources = (body.credential_sources ?? []) as MCPCredentialSource[];

  // Build a minimal MCPServerConfig shape for credential resolution
  const fakeServer = {
    _id: "probe",
    name: "probe",
    endpoint: url,
    transport: "http" as const,
    credential_sources: credentialSources,
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let resolution: McpCredentialResolution;
  try {
    resolution = await resolveMcpHeaderCredentials({
      request,
      session,
      server: fakeServer,
      viaAgentGateway: isAgentGatewayEndpoint(fakeServer),
      retrievalCaller: "mcp-credential-probe",
    });
  } catch (error) {
    if (isMcpCredentialUnavailableError(error)) {
      return successResponse<CredentialProbeResult>({
        ok: false,
        error: "One or more credentials could not be resolved. Check that connected apps are authorized.",
        credentialOrigins: [],
        missingCredentials: [],
      });
    }
    throw error;
  }

  const missingCredentials = resolution.sources
    .filter((s) => s.origin === "none")
    .map((s) => s.name);

  const credentialOrigins = resolution.sources.map((s) => ({
    name: s.name,
    origin: s.origin,
    ...(s.provider ? { provider: s.provider } : {}),
  }));
  if (missingCredentials.length > 0) {
    return successResponse<CredentialProbeResult>({
      ok: false,
      error: "One or more credentials could not be resolved. Check that connected apps are authorized.",
      credentialOrigins,
      missingCredentials,
    });
  }

  // A GET 405 is valid for Streamable HTTP servers that do not expose an SSE
  // listener, so it cannot prove the MCP connection works. Perform the actual
  // protocol initialize exchange with the same resolved headers instead.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let probeResult: CredentialProbeResult;
  try {
    const headers = new Headers({
      accept: "application/json, text/event-stream;q=0.9, */*;q=0.1",
      "content-type": "application/json",
    });
    for (const [key, value] of Object.entries(resolution.headers)) {
      headers.set(key, value);
    }
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "credential-probe-initialize",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "caipe-ui-credential-probe", version: "1.0.0" },
        },
      }),
    });
    const payload = await readJsonOrSse(response);
    const protocolError = response.ok ? initializeError(payload) : null;
    probeResult = {
      ok: response.ok && protocolError === null,
      status: response.status,
      ...(!response.ok
        ? { error: `MCP initialize failed with HTTP ${response.status}` }
        : protocolError
          ? { error: protocolError }
          : {}),
      credentialOrigins,
      missingCredentials,
    };
  } catch (error) {
    probeResult = {
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect",
      credentialOrigins,
      missingCredentials,
    };
  } finally {
    clearTimeout(timeout);
  }

  return successResponse(probeResult);
});
