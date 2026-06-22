import type { MCPCredentialSource } from "@/types/dynamic-agent";

export type McpConnectionScope = "caller" | "pinned";

export function effectiveConnectionScope(source: MCPCredentialSource): McpConnectionScope {
  if (source.connection_scope === "pinned" || source.connection_scope === "caller") {
    return source.connection_scope;
  }
  const connectionId = source.provider_connection_id?.trim() ?? "";
  const providerKey = source.provider?.trim() ?? "";
  if (connectionId && !providerKey) {
    return "pinned";
  }
  return "caller";
}

export function findPinnedCredentialSource(
  sources: MCPCredentialSource[] | undefined,
  providerConnectionId: string,
): MCPCredentialSource | undefined {
  const normalizedId = providerConnectionId.trim();
  if (!normalizedId) return undefined;
  return (sources ?? []).find(
    (source) =>
      source.kind === "provider_connection" &&
      effectiveConnectionScope(source) === "pinned" &&
      source.provider_connection_id?.trim() === normalizedId,
  );
}

export function normalizeCustomProviderCredentialSource(
  source: MCPCredentialSource,
  providerConnections: Array<{ id: string; provider: string }>,
): MCPCredentialSource | null {
  const name = source.name.trim();
  if (!name) return null;

  const scope = effectiveConnectionScope(source);
  if (scope === "pinned") {
    const providerConnectionId = source.provider_connection_id?.trim();
    if (!providerConnectionId) return null;
    return {
      kind: "provider_connection",
      target: source.target,
      name,
      connection_scope: "pinned",
      provider_connection_id: providerConnectionId,
    };
  }

  const provider =
    source.provider?.trim() ||
    providerConnections.find((connection) => connection.id === source.provider_connection_id)?.provider;
  if (!provider) return null;

  return {
    kind: "provider_connection",
    target: source.target,
    name,
    connection_scope: "caller",
    provider,
    ...(source.fallback_env?.trim() ? { fallback_env: source.fallback_env.trim() } : {}),
  };
}
