import { createHash } from "crypto";
import type { RbacCheckRequest, RbacCheckResult, KeycloakAuthzConfig } from "./types";

const parsedCacheTtlSec = parseInt(
  process.env.RBAC_CACHE_TTL_SECONDS || "60",
  10
);
const RBAC_CACHE_TTL_MS =
  Number.isFinite(parsedCacheTtlSec) && parsedCacheTtlSec >= 0
    ? parsedCacheTtlSec * 1000
    : 60_000;
const RBAC_CACHE_ENABLED = RBAC_CACHE_TTL_MS > 0;

const permissionDecisionCache = new Map<
  string,
  { result: RbacCheckResult; expiresAt: number }
>();

function cacheKey(accessToken: string, resource: string, scope: string): string {
  const tokenHash = createHash("sha256").update(accessToken).digest("hex");
  return `${tokenHash}:${resource}#${scope}`;
}

/** Remove expired entries (lazy cleanup on each permission check). */
function pruneExpiredPermissionCache(): void {
  const now = Date.now();
  for (const [key, entry] of permissionDecisionCache) {
    if (entry.expiresAt <= now) {
      permissionDecisionCache.delete(key);
    }
  }
}

const DEFAULT_CONFIG: KeycloakAuthzConfig = {
  serverUrl: process.env.KEYCLOAK_URL || "http://localhost:7080",
  realm: process.env.KEYCLOAK_REALM || "caipe",
  clientId: process.env.KEYCLOAK_RESOURCE_SERVER_ID || "caipe-platform",
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
};

function getTokenEndpoint(config: KeycloakAuthzConfig): string {
  return `${config.serverUrl}/realms/${config.realm}/protocol/openid-connect/token`;
}

/**
 * Check a single permission against Keycloak Authorization Services.
 * Uses UMA ticket grant with response_mode=decision for a boolean result.
 *
 * @returns RbacCheckResult with allowed=true if permitted, allowed=false otherwise
 */
export async function checkPermission(
  request: RbacCheckRequest,
  config: KeycloakAuthzConfig = DEFAULT_CONFIG
): Promise<RbacCheckResult> {
  const tokenEndpoint = getTokenEndpoint(config);
  const permission = `${request.resource}#${request.scope}`;
  const key = cacheKey(request.accessToken, request.resource, request.scope);

  if (RBAC_CACHE_ENABLED) {
    pruneExpiredPermissionCache();
    const cached = permissionDecisionCache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  try {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
      audience: config.clientId,
      permission,
      response_mode: "decision",
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${request.accessToken}`,
      },
      body: body.toString(),
    });

    if (response.ok) {
      const data = await response.json();
      const result: RbacCheckResult = { allowed: data.result === true };
      if (RBAC_CACHE_ENABLED && result.allowed) {
        permissionDecisionCache.set(key, {
          result,
          expiresAt: Date.now() + RBAC_CACHE_TTL_MS,
        });
      }
      return result;
    }

    if (response.status === 403) {
      return { allowed: false, reason: "DENY_NO_CAPABILITY" };
    }

    return { allowed: false, reason: `PDP error: ${response.status}` };
  } catch (error) {
    return { allowed: false, reason: "DENY_PDP_UNAVAILABLE" };
  }
}

/**
 * Check multiple permissions in a single call.
 * Evaluates each permission individually (Keycloak AuthZ does not support batch in decision mode).
 */
export async function checkPermissions(
  requests: RbacCheckRequest[],
  config: KeycloakAuthzConfig = DEFAULT_CONFIG
): Promise<Map<string, RbacCheckResult>> {
  const results = new Map<string, RbacCheckResult>();

  const checks = requests.map(async (req) => {
    const key = `${req.resource}#${req.scope}`;
    const result = await checkPermission(req, config);
    results.set(key, result);
  });

  await Promise.all(checks);
  return results;
}

/**
 * Get all effective permissions for a user.
 * Requests an RPT (Requesting Party Token) without specifying a permission,
 * which returns all granted permissions.
 */
export async function getEffectivePermissions(
  accessToken: string,
  config: KeycloakAuthzConfig = DEFAULT_CONFIG
): Promise<Record<string, string[]>> {
  const tokenEndpoint = getTokenEndpoint(config);

  try {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:uma-ticket",
      audience: config.clientId,
      response_mode: "permissions",
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${accessToken}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      return {};
    }

    const permissions: Array<{ rsname: string; scopes: string[] }> =
      await response.json();

    const result: Record<string, string[]> = {};
    for (const perm of permissions) {
      result[perm.rsname] = perm.scopes || [];
    }
    return result;
  } catch {
    return {};
  }
}
