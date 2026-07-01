import type { MCPCredentialSource } from "@/types/dynamic-agent";

// Provider-connection credential sources are always caller-scoped: each caller
// resolves their OWN connection (by provider key, or by the connection id's
// provider). The legacy "pinned" scope — a single admin connection reused for
// every caller — was removed because it let one user act as another's identity
// against the upstream MCP. The `connection_scope` field is still accepted on
// the wire for backward-compatible parsing of old documents, but is ignored.
export type McpConnectionScope = "caller";

// Always caller-scoped now (the "pinned"/all-callers scope was removed). The
// source argument is accepted and ignored so existing call sites compile.
export function effectiveConnectionScope(source?: MCPCredentialSource): McpConnectionScope {
  void source;
  return "caller";
}

export function normalizeCustomProviderCredentialSource(
  source: MCPCredentialSource,
  providerConnections: Array<{ id: string; provider: string }>,
): MCPCredentialSource | null {
  const name = source.name.trim();
  if (!name) return null;

  // Resolve the provider key directly, or derive it from a (possibly legacy
  // pinned) connection id so the source becomes caller-scoped.
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
