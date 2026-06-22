/**
 * Shared MCP provider_connection credential resolution for BFF paths.
 */

import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { isCredentialFeatureEnabled } from "@/lib/feature-flags/credentials";
import {
  effectiveConnectionScope,
  findPinnedCredentialSource,
} from "@/lib/mcp-credential-scope";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import type { MCPCredentialSource, MCPServerConfig } from "@/types/dynamic-agent";

export {
  effectiveConnectionScope,
  findPinnedCredentialSource,
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

  const scope = effectiveConnectionScope(input.source);
  const service = await getProviderConnectionService();
  const ownerType = input.session.isServiceAccount === true ? "service_account" : "user";
  const providerConnectionId = input.source.provider_connection_id?.trim() ?? "";
  const providerKey = input.source.provider?.trim() ?? "";

  let connection;
  if (scope === "pinned") {
    if (!providerConnectionId) {
      throw new McpCredentialUnavailableError("Pinned provider connection id is required");
    }
    if (
      input.mcpServer &&
      !findPinnedCredentialSource(input.mcpServer.credential_sources, providerConnectionId)
    ) {
      throw new McpCredentialUnavailableError("Provider connection is not pinned on this MCP server");
    }
    connection = await service.getConnection(providerConnectionId);
  } else if (providerKey) {
    connection = (await service.listConnections({ type: ownerType, id: subject })).find(
      (candidate) => candidate.provider === providerKey && candidate.status === "connected",
    );
    if (!connection && providerConnectionId) {
      connection = await service.getConnection(providerConnectionId);
    }
  } else if (providerConnectionId) {
    connection = await service.getConnection(providerConnectionId);
  }

  if (!connection || connection.status !== "connected") {
    throw new McpCredentialUnavailableError("Provider connection is not connected");
  }

  const callerOwnsConnection =
    connection.owner.type === ownerType && connection.owner.id === subject;
  if (!callerOwnsConnection) {
    const pinnedOnServer =
      input.mcpServer &&
      findPinnedCredentialSource(input.mcpServer.credential_sources, connection.id);
    if (pinnedOnServer && input.mcpServer?._id) {
      await requireResourcePermission(input.session, {
        type: "mcp_server",
        id: String(input.mcpServer._id),
        action: "use",
      });
    } else {
      await requireResourcePermission(input.session, {
        type: "secret_ref",
        id: `provider_connection:${connection.id}`,
        action: "use",
      });
    }
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
