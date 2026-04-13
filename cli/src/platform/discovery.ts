/**
 * /.well-known/agent.json endpoint discovery (FR-023).
 *
 * Fetches caipe-ui's agent discovery document and caches it for 24 hours in
 * ~/.config/caipe/agent-config.json.  All OAuth endpoint URLs and the
 * OAuth client_id are read from the discovery document when present, falling
 * back to conventional /oauth/* paths when absent or when discovery fails.
 *
 * This makes the CLI IdP-agnostic: caipe-ui can proxy OAuth to Okta today and
 * Keycloak tomorrow without any CLI change.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { globalConfigDir } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentOAuthConfig {
  authorization_endpoint?: string;
  token_endpoint?: string;
  device_authorization_endpoint?: string;
  client_id?: string;
  scopes?: string[];
}

export interface AgentConfig {
  oauth?: AgentOAuthConfig;
  /** ISO 8601 — when this cache entry expires */
  _cachedAt?: string;
}

// ---------------------------------------------------------------------------
// Cache path
// ---------------------------------------------------------------------------

function agentConfigPath(): string {
  return join(globalConfigDir(), "agent-config.json");
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Internal read/write
// ---------------------------------------------------------------------------

function readCache(): (AgentConfig & { _cachedAt: string }) | null {
  const p = agentConfigPath();
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as AgentConfig & { _cachedAt?: string };
    if (!parsed._cachedAt) return null;
    if (Date.now() - new Date(parsed._cachedAt).getTime() > CACHE_TTL_MS) return null;
    return parsed as AgentConfig & { _cachedAt: string };
  } catch {
    return null;
  }
}

function writeCache(config: AgentConfig): void {
  const dir = globalConfigDir();
  mkdirSync(dir, { recursive: true });
  const entry = { ...config, _cachedAt: new Date().toISOString() };
  writeFileSync(agentConfigPath(), JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch (or return cached) /.well-known/agent.json for the given server URL.
 *
 * Never throws — on any failure returns an empty config so callers fall back
 * to conventional /oauth/* paths.
 */
export async function discoverAgentConfig(serverUrl: string): Promise<AgentConfig> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const url = `${serverUrl}/.well-known/agent.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const json = (await res.json()) as AgentConfig;
    writeCache(json);
    return json;
  } catch {
    // Discovery is optional — fall back to conventional paths
    return {};
  }
}

/**
 * Invalidate the cached agent config (e.g. after server URL changes).
 */
export function clearAgentConfigCache(): void {
  const p = agentConfigPath();
  if (existsSync(p)) {
    try {
      writeFileSync(p, JSON.stringify({}));
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Resolved endpoints (discovery → fallback)
// ---------------------------------------------------------------------------

export interface ResolvedOAuthEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint: string;
  clientId: string;
  scopes: string[];
}

export function resolveOAuthEndpoints(
  serverUrl: string,
  config: AgentConfig,
  defaultClientId: string,
): ResolvedOAuthEndpoints {
  const oauth = config.oauth ?? {};
  return {
    authorizationEndpoint:
      oauth.authorization_endpoint ?? `${serverUrl}/oauth/authorize`,
    tokenEndpoint:
      oauth.token_endpoint ?? `${serverUrl}/oauth/token`,
    deviceAuthorizationEndpoint:
      oauth.device_authorization_endpoint ?? `${serverUrl}/oauth/device/code`,
    clientId: oauth.client_id ?? defaultClientId,
    scopes: oauth.scopes ?? ["openid", "profile", "email"],
  };
}
