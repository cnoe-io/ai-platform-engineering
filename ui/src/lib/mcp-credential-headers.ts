/**
 * Resolve MCP server credential_sources into outbound HTTP headers for probe/test paths.
 */

// assisted-by Codex Codex-sonnet-4-6

import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialRetrievalService } from "@/lib/credentials/retrieval-service-factory";
import { isCredentialFeatureEnabled } from "@/lib/feature-flags/credentials";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import type { MCPCredentialSource, MCPServerConfig } from "@/types/dynamic-agent";
import type { NextRequest } from "next/server";

export type McpCredentialOrigin = "secret_ref" | "provider_connection" | "fallback_env" | "none";

export interface McpCredentialSourceDebug {
  name: string;
  kind: MCPCredentialSource["kind"];
  origin: McpCredentialOrigin;
  provider?: string;
  provider_connection_id?: string;
}

export interface McpCredentialResolution {
  headers: Record<string, string>;
  sources: McpCredentialSourceDebug[];
}

function isProviderBearerSource(headerName: string): boolean {
  const normalized = headerName.trim().toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "x-caipe-token" ||
    normalized === "x-caipe-provider-token"
  );
}

export function providerCredentialHeader(sourceName: string, viaAgentGateway: boolean): string {
  return viaAgentGateway && isProviderBearerSource(sourceName) ? "X-CAIPE-Provider-Token" : sourceName;
}

export function providerCredentialValue(
  credential: string,
  sourceName: string,
  headerName: string,
  viaAgentGateway: boolean,
): string {
  if (viaAgentGateway && headerName.toLowerCase() === "x-caipe-provider-token") {
    return credential.replace(/^Bearer\s+/i, "");
  }
  if (sourceName.toLowerCase() === "authorization" && !credential.toLowerCase().startsWith("bearer ")) {
    return `Bearer ${credential}`;
  }
  return credential;
}

function credentialServiceHeaders(caller: string): Headers {
  return new Headers({
    authorization: `Bearer ${caller}`,
    "x-caipe-credential-caller": "mcp_runtime",
    "x-caipe-credential-audience": process.env.CREDENTIAL_SERVICE_AUDIENCE || "caipe-credential-service",
  });
}

async function resolveProviderConnectionCredential(
  session: ResourceAuthzSession,
  source: MCPCredentialSource,
): Promise<{ token: string; provider: string; providerConnectionId: string } | null> {
  if (!isCredentialFeatureEnabled()) return null;

  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) return null;

  const service = await getProviderConnectionService();
  const ownerType = session.isServiceAccount === true ? "service_account" : "user";
  const providerConnectionId = source.provider_connection_id?.trim() ?? "";
  const providerKey = source.provider?.trim() ?? "";

  const connection = providerConnectionId
    ? await service.getConnection(providerConnectionId)
    : (await service.listConnections({ type: ownerType, id: subject })).find(
        (candidate) => candidate.provider === providerKey && candidate.status === "connected",
      );

  if (!connection || connection.status !== "connected") return null;

  const callerOwnsConnection =
    connection.owner.type === ownerType && connection.owner.id === subject;
  if (!callerOwnsConnection) {
    await requireResourcePermission(session, {
      type: "secret_ref",
      id: `provider_connection:${connection.id}`,
      action: "use",
    });
  }

  const token = await service.refreshConnection(connection.id);
  if (!token.accessToken?.trim()) return null;

  return {
    token: token.accessToken.trim(),
    provider: connection.provider,
    providerConnectionId: connection.id,
  };
}

async function resolveSourceCredential(
  session: ResourceAuthzSession,
  source: MCPCredentialSource,
  viaAgentGateway: boolean,
  retrievalCaller: string,
): Promise<{ credential: string; origin: McpCredentialOrigin; debug: McpCredentialSourceDebug } | null> {
  if (source.target !== "header") return null;

  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) return null;

  const baseDebug: McpCredentialSourceDebug = {
    name,
    kind: source.kind,
    origin: "none",
    ...(source.provider ? { provider: source.provider } : {}),
    ...(source.provider_connection_id ? { provider_connection_id: source.provider_connection_id } : {}),
  };

  if (source.kind === "secret_ref" && source.secret_ref) {
    const service = await getCredentialRetrievalService();
    const result = await service.retrieve({
      headers: credentialServiceHeaders(retrievalCaller),
      body: { secret_ref: source.secret_ref, intended_use: "mcp_server" },
      session,
    });
    return {
      credential: result.credential,
      origin: "secret_ref",
      debug: { ...baseDebug, origin: "secret_ref" },
    };
  }

  if (source.kind === "provider_connection") {
    try {
      const exchanged = await resolveProviderConnectionCredential(session, source);
      if (exchanged) {
        return {
          credential: exchanged.token,
          origin: "provider_connection",
          debug: {
            ...baseDebug,
            origin: "provider_connection",
            provider: exchanged.provider,
            provider_connection_id: exchanged.providerConnectionId,
          },
        };
      }
    } catch {
      // Fall through to static env fallback when configured.
    }

    const fallbackEnv = source.fallback_env?.trim();
    if (fallbackEnv) {
      const envValue = process.env[fallbackEnv]?.trim();
      if (envValue) {
        return {
          credential: envValue,
          origin: "fallback_env",
          debug: { ...baseDebug, origin: "fallback_env" },
        };
      }
    }

    return {
      credential: "",
      origin: "none",
      debug: { ...baseDebug, origin: "none" },
    };
  }

  return null;
}

export function userAuthorizationHeader(
  request: NextRequest,
  session: ResourceAuthzSession & { accessToken?: string },
): string | null {
  const sessionToken = typeof session.accessToken === "string" ? session.accessToken.trim() : "";
  if (sessionToken) {
    return sessionToken.toLowerCase().startsWith("bearer ") ? sessionToken : `Bearer ${sessionToken}`;
  }

  const requestAuthorization = request.headers.get("authorization")?.trim();
  return requestAuthorization?.toLowerCase().startsWith("bearer ") ? requestAuthorization : null;
}

export async function resolveMcpHeaderCredentials(input: {
  request: NextRequest;
  session: ResourceAuthzSession & { accessToken?: string };
  server: MCPServerConfig;
  viaAgentGateway: boolean;
  retrievalCaller?: string;
}): Promise<McpCredentialResolution> {
  const headers: Record<string, string> = {};
  const sources: McpCredentialSourceDebug[] = [];
  const retrievalCaller = input.retrievalCaller ?? "mcp-http-server-client";

  for (const source of input.server.credential_sources ?? []) {
    const resolved = await resolveSourceCredential(
      input.session,
      source,
      input.viaAgentGateway,
      retrievalCaller,
    );
    if (!resolved) continue;

    sources.push(resolved.debug);
    if (resolved.origin === "none" || !resolved.credential) continue;

    const headerName = providerCredentialHeader(source.name, input.viaAgentGateway);
    headers[headerName] = providerCredentialValue(
      resolved.credential,
      source.name,
      headerName,
      input.viaAgentGateway,
    );
  }

  if (input.viaAgentGateway) {
    const authorization = userAuthorizationHeader(input.request, input.session);
    if (!authorization) {
      throw new Error("MCP_AUTH_REQUIRED");
    }
    headers.Authorization = authorization;
  }

  return { headers, sources };
}

export function readMcpToolApplicationSuccess(toolResult: unknown): boolean | undefined {
  if (!toolResult || typeof toolResult !== "object") return undefined;
  const record = toolResult as Record<string, unknown>;
  if (record.isError === true) return false;

  const structured = record.structuredContent;
  if (structured && typeof structured === "object") {
    const fromStructured = parseEmbeddedToolSuccess((structured as { result?: unknown }).result);
    if (fromStructured !== undefined) return fromStructured;
  }

  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (!item || typeof item !== "object") continue;
      if ((item as { type?: unknown }).type !== "text") continue;
      const fromText = parseEmbeddedToolSuccess((item as { text?: unknown }).text);
      if (fromText !== undefined) return fromText;
    }
  }

  return undefined;
}

function parseEmbeddedToolSuccess(value: unknown): boolean | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as { success?: unknown };
    return typeof parsed.success === "boolean" ? parsed.success : undefined;
  } catch {
    return undefined;
  }
}
