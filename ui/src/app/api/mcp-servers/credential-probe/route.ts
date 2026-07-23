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
      viaAgentGateway: false,
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

  // Make the probe request with resolved headers
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let probeResult: CredentialProbeResult;
  try {
    const headers = new Headers({ accept: "application/json, text/event-stream;q=0.9, */*;q=0.1" });
    for (const [key, value] of Object.entries(resolution.headers)) {
      headers.set(key, value);
    }
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers,
    });
    probeResult = {
      ok: response.status < 500 && response.status !== 404,
      status: response.status,
      credentialOrigins: resolution.sources.map((s) => ({
        name: s.name,
        origin: s.origin,
        ...(s.provider ? { provider: s.provider } : {}),
      })),
      missingCredentials,
    };
  } catch (error) {
    probeResult = {
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect",
      credentialOrigins: resolution.sources.map((s) => ({
        name: s.name,
        origin: s.origin,
        ...(s.provider ? { provider: s.provider } : {}),
      })),
      missingCredentials,
    };
  } finally {
    clearTimeout(timeout);
  }

  return successResponse(probeResult);
});
