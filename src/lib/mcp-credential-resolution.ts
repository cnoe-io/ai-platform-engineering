/**
 * Shared MCP provider_connection credential resolution for BFF paths.
 */

import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { isCredentialFeatureEnabled } from "@/lib/feature-flags/credentials";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import type { MCPCredentialSource, MCPServerConfig } from "@/types/dynamic-agent";

export {
  effectiveConnectionScope,
  normalizeCustomProviderCredentialSource,
} from "@/lib/mcp-credential-scope";
export type { McpConnectionScope } from "@/lib/mcp-credential-scope";

export const MCP_CREDENTIAL_UNAVAILABLE = "MCP_CREDENTIAL_UNAVAILABLE";

export class McpCredentialUnavailableError extends Error {
  constructor(message = "MCP provider credential is unavailable") {
    super(message);
    this.name = "McpCredentialUnavailableError";
  }
}

export function isMcpCredentialUnavailableError(error: unknown): boolean {
  return (
    error instanceof McpCredentialUnavailableError ||
    (error instanceof Error && error.message === MCP_CREDENTIAL_UNAVAILABLE)
  );
}

export async function resolveProviderConnectionCredential(input: {
  session: ResourceAuthzSession;
  source: MCPCredentialSource;
  mcpServer?: Pick<MCPServerConfig, "_id" | "credential_sources">;
}): Promise<{ token: string; provider: string; providerConnectionId: string }> {
  if (!isCredentialFeatureEnabled()) {
    throw new McpCredentialUnavailableError("Credential features are disabled");
  }

  const subject = typeof input.session.sub === "string" ? input.session.sub.trim() : "";
  if (!subject) {
    throw new McpCredentialUnavailableError("Authenticated subject is required");
  }

  const service = await getProviderConnectionService();
  const ownerType = input.session.isServiceAccount === true ? "service_account" : "user";
  const providerConnectionId = input.source.provider_connection_id?.trim() ?? "";
  const providerKey = input.source.provider?.trim() ?? "";

  // Provider connections are always caller-scoped: resolve the CALLER's own
  // connection. Prefer the provider key; for legacy id-only ("pinned") sources,
  // derive the provider from the referenced connection, then resolve the
  // caller's own connection for that provider.
  let resolveProviderKey = providerKey;
  if (!resolveProviderKey && providerConnectionId) {
    const referenced = await service.getConnection(providerConnectionId);
    resolveProviderKey = referenced.provider;
  }
  if (!resolveProviderKey) {
    throw new McpCredentialUnavailableError("Provider connection is missing a provider");
  }

  const connection = (await service.listConnections({ type: ownerType, id: subject })).find(
    (candidate) => candidate.provider === resolveProviderKey && candidate.status === "connected",
  );

  if (!connection || connection.status !== "connected") {
    throw new McpCredentialUnavailableError("Provider connection is not connected");
  }

  // The caller's own connection is always permitted. (A connection resolved by
  // the caller's JWT subject is owned by definition, so no cross-user grant is
  // needed — pinned/all-callers sharing was removed for security.)
  const callerOwnsConnection =
    connection.owner.type === ownerType && connection.owner.id === subject;
  if (!callerOwnsConnection) {
    await requireResourcePermission(input.session, {
      type: "secret_ref",
      id: `provider_connection:${connection.id}`,
      action: "use",
    });
  }

  const token = await service.refreshConnection(connection.id);
  if (!token.accessToken?.trim()) {
    throw new McpCredentialUnavailableError("Provider connection token refresh failed");
  }

  return {
    token: token.accessToken.trim(),
    provider: connection.provider,
    providerConnectionId: connection.id,
  };
}
