import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { decodeJwt } from "jose";
import { isMongoDBConfigured, getCollection } from '@/lib/mongodb';
import { decryptSecret } from '@/lib/crypto';
import type { OidcConfig } from '@/types/mongodb';

/**
 * Auth configuration for OIDC SSO
 *
 * Environment Variables Required:
 * - NEXTAUTH_URL: Base URL (e.g., http://localhost:3000 or https://your-domain.com)
 * - NEXTAUTH_SECRET: Random secret for JWT encryption
 * - OIDC_ISSUER: OIDC provider issuer URL
 * - OIDC_CLIENT_ID: OIDC client ID
 * - OIDC_CLIENT_SECRET: OIDC client secret
 * - SSO_ENABLED: "true" to enable SSO, otherwise disabled.
 *   If SSO does not appear enabled: check window.__APP_CONFIG__ in the browser.
 * - OIDC_GROUP_CLAIM: The OIDC claim name(s) for groups. Supports:
 *     - Single value: "memberOf"
 *     - Comma-separated: "groups,members,roles" (all checked, results combined)
 *     - Empty/unset: auto-detect from common claim names
 * - OIDC_REQUIRED_GROUP: Group name required for access (default: "" — no restriction)
 * - OIDC_REQUIRED_ADMIN_GROUP: Group name for admin access (default: none)
 * - OIDC_ENABLE_REFRESH_TOKEN: "true" to enable refresh token support (default: true if not set)
 */

// Refresh token support — disabled by setting OIDC_ENABLE_REFRESH_TOKEN=false
export const ENABLE_REFRESH_TOKEN = process.env.OIDC_ENABLE_REFRESH_TOKEN !== "false";

// Group claim name(s) - configurable via env var
// Supports single value or comma-separated list (e.g., "groups,members,roles")
// If not set, will auto-detect from common claim names
export const GROUP_CLAIM = process.env.OIDC_GROUP_CLAIM || "";

// Required group for authorization.
// Resolution order (effective value computed in resolveOidcGroupConfig):
//   1. OIDC_REQUIRED_GROUP env var, if set (even "" — empty string disables the check).
//   2. platform_config.oidc_config.requiredGroup from MongoDB, if set via the UI.
//   3. "" — no group restriction; any authenticated OIDC user may access.
//
// Default is open access: any authenticated user may log in unless an operator
// explicitly restricts via OIDC_REQUIRED_GROUP (IaC) or Admin → OIDC Config (UI).
export const REQUIRED_GROUP = process.env.OIDC_REQUIRED_GROUP ?? "";

// Required admin group for admin access
export const REQUIRED_ADMIN_GROUP = process.env.OIDC_REQUIRED_ADMIN_GROUP || "";

// Required group for dynamic agents (custom agents) access
// If not set, falls back to requiring admin group membership
export const REQUIRED_DYNAMIC_AGENTS_GROUP = process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP || "";

// Required group for read-only admin dashboard access
// Users in this group can view admin data but cannot make changes
// Leave empty to allow all authenticated users to view admin dashboard
export const REQUIRED_ADMIN_VIEW_GROUP = process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP || "";

// Default group claim names to check (in order of priority)
// Note: Duo SSO uses "members" for full group list, "groups" for limited set
const DEFAULT_GROUP_CLAIMS = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"];

/**
 * Effective OIDC group config — merges env vars (authoritative) with DB config (fallback).
 *
 * When an admin configures OIDC via the UI (no env vars), the group requirements
 * they set must actually be enforced at sign-in. This function reads DB config
 * for any field not already covered by env vars.
 *
 * Called once per initial sign-in (profile processing in JWT callback).
 */
export async function resolveOidcGroupConfig(): Promise<{
  requiredGroup: string;
  adminGroup: string;
  adminViewGroup: string;
  dynamicAgentsGroup: string;
  groupClaim: string;
}> {
  // Start with env-var values (highest priority). Read process.env directly
  // so changes made after module load (e.g. in tests) are picked up at call time.
  const result = {
    requiredGroup: process.env.OIDC_REQUIRED_GROUP ?? "",
    adminGroup: process.env.OIDC_REQUIRED_ADMIN_GROUP || "",
    adminViewGroup: process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP || "",
    dynamicAgentsGroup: process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP || "",
    groupClaim: process.env.OIDC_GROUP_CLAIM || "",
  };

  // Skip DB entirely only when ALL fields have explicit env overrides, so no
  // DB-configured value is silently dropped by a partial env configuration.
  const envFullyConfigured =
    process.env.OIDC_REQUIRED_GROUP !== undefined &&
    process.env.OIDC_REQUIRED_ADMIN_GROUP !== undefined &&
    process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP !== undefined &&
    process.env.OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP !== undefined &&
    process.env.OIDC_GROUP_CLAIM !== undefined;

  if (envFullyConfigured || !isMongoDBConfigured) return result;

  try {
    const col = await getCollection<OidcConfig>('platform_config');
    const doc = await col.findOne({ _id: 'oidc_config' as any });
    if (!doc) return result;

    // Fill in from DB only for fields not set via env var
    if (process.env.OIDC_REQUIRED_GROUP === undefined && doc.requiredGroup) {
      result.requiredGroup = doc.requiredGroup;
    }
    if (process.env.OIDC_REQUIRED_ADMIN_GROUP === undefined && doc.adminGroup) {
      result.adminGroup = doc.adminGroup;
    }
    if (process.env.OIDC_REQUIRED_ADMIN_VIEW_GROUP === undefined && doc.adminViewGroup) {
      result.adminViewGroup = doc.adminViewGroup;
    }
    if (process.env.OIDC_GROUP_CLAIM === undefined && doc.groupClaim) {
      result.groupClaim = doc.groupClaim;
    }
  } catch {
    // MongoDB unavailable — fall through with env values
  }

  return result;
}

/**
 * Helper to add groups from a claim value to a set
 */
function addGroupsFromValue(value: unknown, groups: Set<string>): void {
  if (Array.isArray(value)) {
    value.map(String).forEach(g => groups.add(g));
  } else if (typeof value === "string") {
    // Some providers return comma-separated or space-separated groups
    value.split(/[,\s]+/).filter(Boolean).forEach(g => groups.add(g));
  }
}

/**
 * Extract groups from OIDC claims with configurable claim name(s).
 * Mirrors the logic in server/src/server/rbac.py extract_groups_from_claims()
 *
 * Uses OIDC_GROUP_CLAIM if set (supports comma-separated for multiple claims),
 * otherwise checks ALL common claim names and combines groups from all
 * of them (using a set for deduplication).
 *
 * @param profile - OIDC profile/claims object
 * @param effectiveClaim - Override the module-level GROUP_CLAIM constant (e.g. from DB config)
 * @returns Array of unique group names
 */
function extractGroups(profile: Record<string, unknown>, effectiveClaim?: string): string[] {
  const allGroups = new Set<string>();
  const claimToUse = effectiveClaim ?? GROUP_CLAIM;

  // If specific claim(s) configured, use only those
  // Supports comma-separated list (e.g., "groups,members,roles")
  if (claimToUse) {
    const configuredClaims = claimToUse.split(",").map(c => c.trim()).filter(Boolean);
    for (const claimName of configuredClaims) {
      const value = profile[claimName];
      if (value !== undefined) {
        addGroupsFromValue(value, allGroups);
      }
    }
    if (allGroups.size === 0) {
      console.warn(`OIDC group claim(s) "${claimToUse}" not found in profile`);
    }
    return Array.from(allGroups);
  }

  // Auto-detect: check ALL common group claim names and combine them
  // This is important for Duo SSO which uses both "groups" and "members"
  for (const claim of DEFAULT_GROUP_CLAIMS) {
    const value = profile[claim];
    if (value !== undefined) {
      addGroupsFromValue(value, allGroups);
    }
  }

  return Array.from(allGroups);
}

/**
 * Parse a potentially comma-separated group string into an array of trimmed group names.
 * e.g. "group1, group2 , group3" → ["group1", "group2", "group3"]
 * Returns [] for empty/null values.
 */
function parseGroups(groupStr: string): string[] {
  if (!groupStr) return [];
  return groupStr.split(',').map(g => g.trim()).filter(Boolean);
}

/**
 * Check if a user (identified by their group list) is a member of ANY of the
 * specified required groups. Supports both simple names and full LDAP DN paths.
 * e.g. "caipe-users" matches "CN=caipe-users,OU=Groups,DC=example,DC=com"
 */
function userInAnyGroup(userGroups: string[], requiredGroupStr: string): boolean {
  const required = parseGroups(requiredGroupStr);
  if (required.length === 0) return false;

  return userGroups.some(userGroup => {
    const userGroupLower = userGroup.toLowerCase();
    return required.some(req => {
      const reqLower = req.toLowerCase();
      return userGroupLower === reqLower || userGroupLower.includes(`cn=${reqLower}`);
    });
  });
}

// Helper to check if user has required group.
// Supports comma-separated lists in OIDC_REQUIRED_GROUP: user must be in ANY listed group.
// The optional requiredGroup argument overrides the module-level constant — useful for
// callers that have already resolved the config (e.g. resolveOidcGroupConfig) or for
// unit tests that want to verify restriction logic without env-var side-effects.
export function hasRequiredGroup(groups: string[], requiredGroup = REQUIRED_GROUP): boolean {
  if (!requiredGroup) return true; // No group required
  return userInAnyGroup(groups, requiredGroup);
}

// Helper to check if user is in admin group.
// Supports comma-separated lists in OIDC_REQUIRED_ADMIN_GROUP.
export function isAdminUser(groups: string[]): boolean {
  if (!REQUIRED_ADMIN_GROUP) return false; // No admin group configured
  return userInAnyGroup(groups, REQUIRED_ADMIN_GROUP);
}

// Helper to check if user can access dynamic agents.
// If OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is set, only that group has access.
// Supports comma-separated lists. Falls back to admin-only if not configured.
export function canAccessDynamicAgents(groups: string[]): boolean {
  if (REQUIRED_DYNAMIC_AGENTS_GROUP) {
    return userInAnyGroup(groups, REQUIRED_DYNAMIC_AGENTS_GROUP);
  }
  // No explicit group configured → admins only
  return isAdminUser(groups);
}

// Helper to check if user can view admin dashboard (read-only).
// If OIDC_REQUIRED_ADMIN_VIEW_GROUP is not set, all authenticated users can view.
// Supports comma-separated lists.
export function canViewAdminDashboard(groups: string[]): boolean {
  if (!REQUIRED_ADMIN_VIEW_GROUP) return true; // No view group configured = all authenticated
  return userInAnyGroup(groups, REQUIRED_ADMIN_VIEW_GROUP);
}

/** Reset in-flight refresh map (for testing only). */
export function _resetInflightRefreshes(): void {
  _inflightRefreshes.clear();
}

// Safety net 1: In-flight deduplication.
// Maps the current refresh token → the pending exchange Promise so that
// concurrent callers (refetchInterval + TokenExpiryGuard) share one HTTP
// request instead of racing and triggering invalid_grant with rotating tokens.
type ExchangeResult = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
} | null; // null = graceful race (see safety net 2)

const _inflightRefreshes = new Map<string, Promise<ExchangeResult>>();

// ─────────────────────────────────────────────────────────────────────────────
// Server-side token store
// ─────────────────────────────────────────────────────────────────────────────
// Large OAuth tokens (refreshToken, idToken) are kept in server memory instead
// of the JWT cookie.  This keeps the encrypted cookie under the 4096-byte
// browser limit.  Only the accessToken and small metadata stay in the cookie.
//
// Trade-off: tokens are lost on process restart.  The accessToken (still in the
// cookie) remains valid until it expires; after that the user re-authenticates.
// For multi-replica deployments, use sticky sessions or a shared store (Redis).

interface CachedTokens {
  refreshToken?: string;
  idToken?: string;
  updatedAt: number;
}

const _serverTokenStore = new Map<string, CachedTokens>();
const _TOKEN_STORE_TTL = 24 * 60 * 60; // 24h — matches session maxAge

export function _getStoredTokens(sub: string | undefined): CachedTokens | undefined {
  if (!sub) return undefined;
  const entry = _serverTokenStore.get(sub);
  if (!entry) return undefined;
  if (Math.floor(Date.now() / 1000) - entry.updatedAt > _TOKEN_STORE_TTL) {
    _serverTokenStore.delete(sub);
    return undefined;
  }
  return entry;
}

function _storeTokens(sub: string | undefined, data: { refreshToken?: string; idToken?: string }): void {
  if (!sub) return;
  const existing = _serverTokenStore.get(sub);
  _serverTokenStore.set(sub, {
    refreshToken: data.refreshToken ?? existing?.refreshToken,
    idToken: data.idToken ?? existing?.idToken,
    updatedAt: Math.floor(Date.now() / 1000),
  });
}

/** Reset server-side token store (for testing only). */
export function _resetServerTokenStore(): void {
  _serverTokenStore.clear();
}

// Periodic cleanup of expired entries
if (typeof setInterval !== 'undefined') {
  const _cleanupTimer = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, value] of _serverTokenStore) {
      if (now - value.updatedAt > _TOKEN_STORE_TTL) {
        _serverTokenStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
  if (typeof _cleanupTimer === 'object' && 'unref' in _cleanupTimer) {
    (_cleanupTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Refresh the access token using the refresh token
 *
 * This function calls the OIDC token endpoint to exchange a refresh_token
 * for a new access_token and id_token.
 *
 * Safety nets:
 *   1. In-flight deduplication: concurrent calls with the same refresh token
 *      share a single HTTP exchange rather than racing.
 *   2. Graceful invalid_grant: if the provider rejects the token but the
 *      access token is still valid, we treat it as a race (another instance
 *      already refreshed) and return the existing token without an error.
 *
 * @param token - The JWT token containing the refresh token
 * @returns Updated token with new access_token and expiry
 */
async function refreshAccessToken(token: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  [key: string]: unknown;
}) {
  try {
    const issuer = process.env.OIDC_ISSUER;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;

    if (!issuer || !clientId || !clientSecret) {
      console.error("[Auth] Missing OIDC configuration for token refresh");
      return {
        ...token,
        error: "RefreshTokenMissingConfig",
      };
    }

    if (!token.refreshToken) {
      console.error("[Auth] No refresh token available");
      return {
        ...token,
        error: "RefreshTokenMissing",
      };
    }

    const currentRefreshToken = token.refreshToken as string;

    // Safety net 1: join an in-flight exchange for the same refresh token
    const existing = _inflightRefreshes.get(currentRefreshToken);
    if (existing) {
      console.log("[Auth] Joining in-flight token exchange (concurrent refresh detected)");
      const result = await existing;
      if (result === null) {
        // Another caller already handled the race; current access token is still valid
        return { ...token, error: undefined };
      }
      return {
        ...token,
        accessToken: result.access_token,
        idToken: result.id_token,
        expiresAt: Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
        refreshToken: result.refresh_token ?? currentRefreshToken,
        error: undefined,
      };
    }

    // Inner function that performs the actual HTTP exchange.
    // Returns the token data on success, null for graceful races, or throws on real errors.
    const doExchange = async (): Promise<ExchangeResult> => {
      // Discover the token endpoint from the OIDC issuer's well-known configuration.
      // Falls back to Keycloak-style path if discovery fails.
      let tokenEndpoint: string;
      try {
        const wellKnownUrl = `${issuer}/.well-known/openid-configuration`;
        const discoveryResponse = await fetch(wellKnownUrl, { next: { revalidate: 3600 } });
        if (discoveryResponse.ok) {
          const discoveryDoc = await discoveryResponse.json();
          tokenEndpoint = discoveryDoc.token_endpoint;
          console.log("[Auth] Token endpoint from OIDC discovery:", tokenEndpoint);
        } else {
          console.warn("[Auth] OIDC discovery failed, falling back to Keycloak-style path");
          tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
        }
      } catch (discoveryError) {
        console.warn("[Auth] OIDC discovery error, falling back to Keycloak-style path:", discoveryError);
        tokenEndpoint = `${issuer}/protocol/openid-connect/token`;
      }

      console.log("[Auth] Refreshing access token...");

      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          grant_type: "refresh_token",
          refresh_token: currentRefreshToken,
        }),
      });

      // Check content-type before parsing - OIDC providers may return HTML error pages
      const contentType = response.headers.get("content-type") || "";
      let data: any;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("[Auth] Token refresh returned non-JSON response:", text.substring(0, 200));
        throw new Error("RefreshTokenExpired");
      }

      if (!response.ok) {
        // Safety net 2: graceful invalid_grant handling.
        // When a peer (another Next.js instance or refetchInterval) already consumed
        // the rotating refresh token, we get invalid_grant back. If the access token
        // is still valid, treat this as a benign race rather than forcing a logout.
        if (data.error === "invalid_grant") {
          const now = Math.floor(Date.now() / 1000);
          const expiresAt = token.expiresAt as number | undefined;
          if (expiresAt && expiresAt > now) {
            console.warn(
              "[Auth] invalid_grant with valid access token — concurrent refresh race detected, keeping current token"
            );
            return null; // Signal: no error, keep existing token
          }
        }
        console.error("[Auth] Token refresh failed:", data);
        throw new Error("RefreshTokenExpired");
      }

      console.log("[Auth] Token refreshed successfully");
      return data as ExchangeResult;
    };

    // Register the exchange Promise so concurrent callers can join it (safety net 1)
    const exchangePromise = doExchange();
    _inflightRefreshes.set(currentRefreshToken, exchangePromise);

    let result: ExchangeResult;
    try {
      result = await exchangePromise;
    } finally {
      _inflightRefreshes.delete(currentRefreshToken);
    }

    if (result === null) {
      // Graceful race: access token still valid, no logout needed
      return { ...token, error: undefined };
    }

    return {
      ...token,
      accessToken: result.access_token,
      idToken: result.id_token,
      expiresAt: Math.floor(Date.now() / 1000) + (result.expires_in || 3600),
      refreshToken: result.refresh_token ?? currentRefreshToken, // Use new refresh token if provided
      error: undefined, // Clear any previous errors
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage === "RefreshTokenExpired") {
      return { ...token, error: "RefreshTokenExpired" };
    }
    console.error("[Auth] Error refreshing access token:", error);
    return {
      ...token,
      error: "RefreshTokenError",
    };
  }
}

// ---------------------------------------------------------------------------
// CredentialsProvider for local admin (bootstrap before OIDC is configured)
// ---------------------------------------------------------------------------

const localCredentialsProvider = CredentialsProvider({
  id: "credentials",
  name: "Admin Login",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
    totp: { label: "Authenticator Code", type: "text" },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null;

    const email = credentials.email.toLowerCase();

    // Per-email rate limiting before any DB or crypto work
    const { RateLimits } = await import('@/lib/rate-limit');
    const rateCheck = RateLimits.credentials(email);
    if (!rateCheck.allowed) {
      throw new Error("RateLimited");
    }

    // Lazy import to avoid circular dep and keep server-only code out of the module graph
    const { getLocalUser, verifyPassword, verifyTOTP, verifyAndConsumeBackupCode,
            isAccountLocked, recordFailedLogin, recordSuccessfulLogin } = await import('@/lib/local-auth');

    const user = await getLocalUser(email);
    if (!user) return null;

    // Check lockout before attempting verification (prevents timing oracle)
    if (await isAccountLocked(email)) {
      throw new Error("AccountLocked");
    }

    const passwordValid = await verifyPassword(user.password_hash, credentials.password);
    if (!passwordValid) {
      await recordFailedLogin(email);
      return null;
    }

    // TOTP check (mandatory if enabled).
    // Accepts both 6-digit TOTP codes and 10-char alphanumeric backup codes.
    if (user.totp_enabled) {
      if (!credentials.totp) {
        throw new Error("TotpRequired");
      }
      const code = credentials.totp.trim();
      const isTotpFormat = /^\d{6}$/.test(code);

      if (isTotpFormat) {
        // Standard TOTP
        const totpValid = user.totp_secret ? verifyTOTP(user.totp_secret, code) : false;
        if (!totpValid) {
          await recordFailedLogin(email);
          throw new Error("TotpInvalid");
        }
      } else {
        // Backup code (10-char alphanumeric)
        const backupValid = await verifyAndConsumeBackupCode(email, code);
        if (!backupValid) {
          await recordFailedLogin(email);
          throw new Error("TotpInvalid");
        }
      }
    }

    await recordSuccessfulLogin(email);

    return {
      id: user.email,
      email: user.email,
      name: user.name,
      role: 'admin',
    };
  },
});

// ---------------------------------------------------------------------------
// DB-backed OIDC config cache (30s TTL)
// ---------------------------------------------------------------------------

interface CachedOidcProvider {
  provider: NextAuthOptions['providers'][number] | null;
  cachedAt: number;
}

let _oidcProviderCache: CachedOidcProvider | null = null;
const OIDC_CACHE_TTL = 30 * 1000; // 30 seconds

async function getDbOidcProvider(): Promise<NextAuthOptions['providers'][number] | null> {
  const now = Date.now();
  if (_oidcProviderCache && now - _oidcProviderCache.cachedAt < OIDC_CACHE_TTL) {
    return _oidcProviderCache.provider;
  }

  try {
    const { getCollection, isMongoDBConfigured } = await import('@/lib/mongodb');
    const { decryptSecret } = await import('@/lib/crypto');
    if (!isMongoDBConfigured) {
      _oidcProviderCache = { provider: null, cachedAt: now };
      return null;
    }

    const collection = await getCollection<any>('platform_config');
    const doc = await collection.findOne({ _id: 'oidc_config' });

    if (!doc?.enabled) {
      _oidcProviderCache = { provider: null, cachedAt: now };
      return null;
    }

    const clientSecret = decryptSecret(doc.clientSecret);
    const enableRefresh = ENABLE_REFRESH_TOKEN;

    const provider: NextAuthOptions['providers'][number] = {
      id: "oidc",
      name: "SSO",
      type: "oauth",
      wellKnown: `${doc.issuer}/.well-known/openid-configuration`,
      authorization: {
        params: {
          scope: enableRefresh
            ? "openid email profile groups offline_access"
            : "openid email profile groups",
        },
      },
      idToken: true,
      checks: ["pkce", "state"],
      clientId: doc.clientId,
      clientSecret,
      profile(profile: Record<string, unknown>) {
        return {
          id: profile.sub as string,
          name: (profile.fullname || profile.name || profile.preferred_username ||
                 `${profile.firstname || ""} ${profile.lastname || ""}`.trim() ||
                 profile.username || profile.email) as string,
          email: (profile.email || profile.username) as string,
          image: profile.picture as string | null,
        };
      },
    } as any;

    _oidcProviderCache = { provider, cachedAt: now };
    return provider;
  } catch (err) {
    console.error('[Auth] Failed to load OIDC config from DB:', err);
    _oidcProviderCache = { provider: null, cachedAt: now };
    return null;
  }
}

/** Invalidate the OIDC provider cache (call after saving new OIDC config).
 *  Also flushes the Bearer-JWT validator's cached issuer/JWKS so API routes
 *  that authenticate via Bearer tokens (chat stream, dynamic-agents proxy)
 *  pick up the new OIDC issuer immediately instead of 401-ing until the
 *  separate cache's TTL (30s) expires. */
export function invalidateOidcCache(): void {
  _oidcProviderCache = null;
  // Lazy require to avoid a circular import at module load; jwt-validation
  // already imports the mongodb/types it needs from here.
  import('./jwt-validation').then((mod) => {
    try {
      mod.invalidateBearerJwtOidcCache();
    } catch {
      /* non-fatal */
    }
  });
}

/**
 * Returns NextAuth options with providers loaded dynamically.
 * - Env-var OIDC config (existing deployments) takes precedence.
 * - Falls back to DB-stored config (set via admin UI).
 * - Always includes the local CredentialsProvider as a recovery path.
 */
export async function getAuthOptions(): Promise<NextAuthOptions> {
  const providers: NextAuthOptions['providers'] = [];

  // Env vars take precedence over DB-configured OIDC
  const envOidcConfigured =
    !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET);

  if (envOidcConfigured) {
    // Use the static env-var OIDC provider (already in authOptions)
    providers.push((authOptions as any).providers[0]);
  } else {
    // Try DB-configured OIDC
    const dbProvider = await getDbOidcProvider();
    if (dbProvider) {
      providers.push(dbProvider);
    }
  }

  // Always include local credentials provider (admin recovery path)
  providers.push(localCredentialsProvider);

  return {
    ...authOptions,
    providers,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "oidc",
      name: "SSO",
      type: "oauth",
      wellKnown: process.env.OIDC_ISSUER
        ? `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`
        : undefined,
      // Request offline_access to get refresh tokens (if enabled)
      // Falls back to warning-only mode if refresh tokens not available
      authorization: {
        params: {
          scope: ENABLE_REFRESH_TOKEN
            ? "openid email profile groups offline_access"
            : "openid email profile groups"
        }
      },
      idToken: true,
      checks: ["pkce", "state"],
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      profile(profile) {
        // Handle various OIDC provider claim formats
        // Duo uses: fullname, firstname, lastname, username
        // Standard OIDC: name, preferred_username, email
        return {
          id: profile.sub,
          name: profile.fullname || profile.name || profile.preferred_username ||
                `${profile.firstname || ""} ${profile.lastname || ""}`.trim() ||
                profile.username || profile.email,
          email: profile.email || profile.username, // Some providers use username as email
          image: profile.picture,
        };
      },
    },
    // Local credentials provider always present — admin recovery path
    localCredentialsProvider,
  ],
  callbacks: {
    async jwt(params): Promise<any> {
      const { token, account, profile, trigger, user } = params;
      // Local credentials sign-in: embed role directly in token
      if (account?.provider === 'credentials' && user) {
        token.credentialsRole = (user as any).role ?? 'user';
        token.authMethod = 'credentials';
        token.isAuthorized = true;
        return token;
      }

      // Initial sign in - persist the OAuth tokens
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        // Any non-credentials provider reaching this branch went through OIDC
        token.authMethod = 'oidc';

        // Calculate refresh token expiry if refresh_expires_in is provided
        // Some OIDC providers (like Keycloak) include this field
        if (account.refresh_expires_in) {
          token.refreshTokenExpiresAt = Math.floor(Date.now() / 1000) + (account.refresh_expires_in as number);
        }

        const expiryDate = new Date((account.expires_at || 0) * 1000).toISOString();
        console.log("[Auth] Initial sign-in, token expires at:", expiryDate);

        // Log whether refresh token support is available
        if (ENABLE_REFRESH_TOKEN) {
          if (account.refresh_token) {
            console.log("[Auth] ✅ Refresh token available - seamless token renewal enabled");
            if (token.refreshTokenExpiresAt) {
              const refreshExpiryDate = new Date(token.refreshTokenExpiresAt * 1000).toISOString();
              console.log("[Auth] Refresh token expires at:", refreshExpiryDate);
            }
          } else {
            console.warn("[Auth] ⚠️  Refresh token not provided by OIDC provider - falling back to expiry warnings");
            console.warn("[Auth] Hint: Ensure OIDC provider supports 'offline_access' scope");
          }
        } else {
          console.log("[Auth] ℹ️  Refresh token support disabled (OIDC_ENABLE_REFRESH_TOKEN=false)");
        }
      }

      // Extract and check groups from profile (but DON'T store them - too large!)
      if (profile) {
        // Cast profile to Record for group extraction
        const profileData = profile as unknown as Record<string, unknown>;

        // Resolve effective group config first — we need groupClaim to extract correctly.
        // This ensures group requirements AND the claim name set via the OIDC UI are
        // enforced at sign-in, not just stored in MongoDB.
        const groupConfig = await resolveOidcGroupConfig();

        // Extract groups using the resolved claim name (env var OR DB-configured).
        const groups = extractGroups(profileData, groupConfig.groupClaim || undefined);

        // Only store the authorization result and role (NOT the groups array!)
        // Storing 40+ groups causes 8KB session cookies and browser crashes
        token.isAuthorized = userInAnyGroup(groups, groupConfig.requiredGroup) ||
          (!groupConfig.requiredGroup); // empty = no restriction
        // Record the effective required group so /unauthorized can display the
        // exact value that was enforced (env var / DB / empty) instead of
        // reaching for a hardcoded default on the client.
        token.requiredGroup = groupConfig.requiredGroup || '';
        token.role = userInAnyGroup(groups, groupConfig.adminGroup) && groupConfig.adminGroup
          ? 'admin' : 'user';
        token.canViewAdmin = token.role === 'admin' ||
          (!groupConfig.adminViewGroup) ||
          userInAnyGroup(groups, groupConfig.adminViewGroup);
        token.canAccessDynamicAgents = groupConfig.dynamicAgentsGroup
          ? userInAnyGroup(groups, groupConfig.dynamicAgentsGroup)
          : token.role === 'admin';
        token.groupsCheckedAt = Math.floor(Date.now() / 1000);

        // Debug logging (groups array is NOT stored in token)
        console.log('[Auth JWT] User groups count:', groups.length);
        console.log('[Auth JWT] Required group (resolved):', groupConfig.requiredGroup);
        console.log('[Auth JWT] Required admin group (resolved):', groupConfig.adminGroup);
        console.log('[Auth JWT] Required admin view group (resolved):', groupConfig.adminViewGroup);
        console.log('[Auth JWT] User role:', token.role);
        console.log('[Auth JWT] Can view admin:', token.canViewAdmin);
        console.log('[Auth JWT] Is authorized:', token.isAuthorized);
      }

      // NOTE: When trigger === "update" (from updateSession() or refetchInterval),
      // we intentionally DO NOT return early. The refresh logic below must run
      // so that proactive token refresh works. Previously, an early return here
      // caused updateSession() calls to return the stale token without refreshing.

      // Check if token needs refresh (refresh 5 minutes before expiry)
      // Only attempt if refresh token support is enabled
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = token.expiresAt as number | undefined;

      if (ENABLE_REFRESH_TOKEN && expiresAt) {
        const timeUntilExpiry = expiresAt - now;

        // Don't attempt refresh if token is already expired by more than 1 hour
        // This prevents infinite refresh loops when refresh token is invalid
        if (timeUntilExpiry < -3600) {
          console.warn(`[Auth] Token expired ${Math.abs(timeUntilExpiry)}s ago - refresh token likely invalid, marking session as expired`);
          return {
            ...token,
            error: "RefreshTokenExpired",
          };
        }

        const shouldRefresh = timeUntilExpiry < 5 * 60; // Refresh if less than 5 min remaining

        if (shouldRefresh) {
          // Don't attempt refresh if there's already an error (prevents loops)
          if (token.error) {
            console.warn(`[Auth] Token refresh already failed (${token.error}), skipping refresh attempt`);
            return token;
          }

          // Don't attempt refresh if suppressed (graceful invalid_grant already handled)
          // This prevents infinite refresh loops when the refresh token is consumed but
          // the access token is still valid.
          const suppressedUntil = token.refreshSuppressedUntil as number | undefined;
          if (suppressedUntil && now < suppressedUntil) {
            return token;
          }

          console.log(`[Auth] Token expires in ${timeUntilExpiry}s, attempting refresh...`);

          // Only attempt refresh if we have a refresh token
          if (token.refreshToken) {
            const refreshedToken = await refreshAccessToken(token) as typeof token;

            // If refresh returned the same access token (graceful invalid_grant race),
            // suppress further refresh attempts until the token expires to prevent
            // an infinite refresh loop.
            if (!refreshedToken.error && refreshedToken.accessToken === token.accessToken) {
              console.log(`[Auth] Refresh suppressed — access token still valid for ${timeUntilExpiry}s, will not retry`);
              return { ...refreshedToken, refreshSuppressedUntil: expiresAt };
            }

            // Re-evaluate group authorization every 4 hours using claims from
            // the fresh id_token. This ensures revoked group membership takes
            // effect within 4 hours rather than persisting for the full 24h session.
            const GROUP_RECHECK_INTERVAL = 4 * 60 * 60; // seconds
            const lastGroupCheck = (refreshedToken.groupsCheckedAt as number | undefined) ?? 0;
            const shouldRecheckGroups =
              !refreshedToken.error &&
              refreshedToken.idToken &&
              (now - lastGroupCheck) >= GROUP_RECHECK_INTERVAL;

            if (shouldRecheckGroups) {
              try {
                const claims = decodeJwt(refreshedToken.idToken as string);
                // Resolve config first so we use the correct claim name for extraction.
                const groupConfig = await resolveOidcGroupConfig();
                const groups = extractGroups(claims as Record<string, unknown>, groupConfig.groupClaim || undefined);
                console.log(`[Auth] Re-evaluating groups from refreshed id_token (last checked ${Math.round((now - lastGroupCheck) / 3600)}h ago), count: ${groups.length}`);
                return {
                  ...refreshedToken,
                  isAuthorized: userInAnyGroup(groups, groupConfig.requiredGroup) || !groupConfig.requiredGroup,
                  role: userInAnyGroup(groups, groupConfig.adminGroup) && groupConfig.adminGroup ? 'admin' : 'user',
                  canViewAdmin: (userInAnyGroup(groups, groupConfig.adminGroup) && groupConfig.adminGroup) ||
                    !groupConfig.adminViewGroup ||
                    userInAnyGroup(groups, groupConfig.adminViewGroup),
                  canAccessDynamicAgents: groupConfig.dynamicAgentsGroup
                    ? userInAnyGroup(groups, groupConfig.dynamicAgentsGroup)
                    : userInAnyGroup(groups, groupConfig.adminGroup) && !!groupConfig.adminGroup,
                  groupsCheckedAt: now,
                };
              } catch (err) {
                console.warn('[Auth] Failed to decode id_token for group re-check, keeping existing authorization:', err);
              }
            }

            return refreshedToken;
          } else {
            console.warn("[Auth] No refresh token available, falling back to expiry warnings");
            // Don't set error - just fall back to warning system
            // This allows graceful degradation if provider doesn't support refresh tokens
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      // IMPORTANT: Minimize what we store to keep cookie under 4096 bytes!
      // Don't store full tokens in session - they're huge (2KB+ each)
      // Only store what the client actually needs

      // Local credentials login: role is embedded in the token directly
      if (token.credentialsRole) {
        session.role = token.credentialsRole as 'admin' | 'user';
        session.authMethod = 'credentials';
        session.isAuthorized = true;
        session.canViewAdmin = true;
        session.canAccessDynamicAgents = true;
        return session;
      }

      // OIDC path: thread the auth method through so the UI can distinguish it
      // from local credentials for UX affordances (e.g. hiding the "Authenticated
      // via SSO" banner for local admins).
      session.authMethod = (token.authMethod as 'oidc' | 'credentials' | undefined) ?? 'oidc';

      // Only pass tokens if they're valid (not expired)
      if (!token.error) {
        // Store access token and ID token for client-side use
        session.accessToken = token.accessToken as string;
        session.idToken = token.idToken as string; // Needed for decoding groups/claims client-side
        session.hasRefreshToken = !!token.refreshToken; // Indicate if refresh token is available
      }

      session.error = token.error as string | undefined;
      session.isAuthorized = token.isAuthorized as boolean;
      session.expiresAt = token.expiresAt as number | undefined;
      // The actual required group that was enforced when this token was issued.
      // /unauthorized uses this to display the real value instead of a default.
      session.requiredGroup = (token.requiredGroup as string | undefined) ?? '';

      // Pass refresh token metadata (NOT the token itself - security)
      session.hasRefreshToken = !!token.refreshToken;
      session.refreshTokenExpiresAt = token.refreshTokenExpiresAt as number | undefined;

      // Set role from token (OIDC group check only here)
      // MongoDB fallback check happens in API middleware (server-side only)
      session.role = (token.role as 'admin' | 'user') || 'user';
      // For pre-upgrade JWTs that lack canViewAdmin, default to true when no
      // admin view group is configured (all authenticated users can view).
      session.canViewAdmin = (token.canViewAdmin as boolean)
        ?? (REQUIRED_ADMIN_VIEW_GROUP === '' ? true : false);
      // Admins always get dynamic agents access, regardless of what the JWT says.
      // This covers both pre-upgrade tokens (missing field) and tokens computed
      // before canAccessDynamicAgents() was updated to include the admin check.
      session.canAccessDynamicAgents = (token.canAccessDynamicAgents === true)
        || (session.role === 'admin');

      // If token refresh failed, mark session as invalid and DON'T include tokens
      if (token.error === "RefreshTokenExpired" || token.error === "RefreshTokenError") {
        console.error(`[Auth] Session invalid due to: ${token.error}`);
        session.error = token.error;
        // Clear tokens from session to reduce cookie size
        session.accessToken = undefined;
      }

      // User info is already populated by NextAuth from the profile() callback
      // We don't store profile in token anymore (saves session cookie size)
      // Just pass through the sub if available
      session.sub = token.sub as string | undefined;

      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  // Custom encode/decode: offload large OAuth tokens (refreshToken, idToken)
  // to server-side memory so the encrypted cookie stays under 4096 bytes.
  // The JWT callback and session callback are unaffected — tokens are
  // transparently rehydrated on decode and stripped on encode.
  jwt: {
    async encode({ token, secret, maxAge }) {
      if (token?.sub) {
        _storeTokens(token.sub, {
          refreshToken: token.refreshToken as string | undefined,
          idToken: token.idToken as string | undefined,
        });
      }
      const { refreshToken: _rt, idToken: _idt, ...slimToken } = (token ?? {}) as Record<string, unknown>;
      // Dynamic import avoids top-level ESM/CJS conflict with jose in test environments
      const { encode } = await import("next-auth/jwt");
      return encode({ token: slimToken as any, secret, maxAge });
    },
    async decode({ token, secret }) {
      const { decode } = await import("next-auth/jwt");
      const decoded = await decode({ token, secret });
      if (decoded?.sub) {
        const stored = _getStoredTokens(decoded.sub);
        if (stored) {
          if (stored.refreshToken) decoded.refreshToken = stored.refreshToken;
          if (stored.idToken) decoded.idToken = stored.idToken;
        }
      }
      return decoded;
    },
  },
  // Explicitly disable session store (we use JWT only)
  // This prevents NextAuth from trying to write SST files
  adapter: undefined,
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        // Reduce session cookie size by not storing everything in cookie
        maxAge: 24 * 60 * 60, // 24 hours
      },
    },
  },
  debug: process.env.NEXTAUTH_DEBUG === "true",
  // Disable NextAuth's internal logging persistence to prevent SST file errors
  logger: {
    error(code, metadata) {
      console.error('[NextAuth] Error:', code, metadata);
    },
    warn(code) {
      console.warn('[NextAuth] Warning:', code);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development") {
        console.debug('[NextAuth] Debug:', code, metadata);
      }
    },
  },
};

// Extend next-auth types
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    idToken?: string; // Needed for client-side group extraction (not stored in cookie, fetched on demand)
    hasRefreshToken?: boolean; // Whether refresh token is available
    error?: string;
    // groups removed from session - too large (40+ groups = 8KB cookie!)
    // Instead, extract groups client-side from idToken when needed
    isAuthorized?: boolean;
    sub?: string; // User subject ID from OIDC
    expiresAt?: number; // Access token expiry (Unix timestamp)
    refreshTokenExpiresAt?: number; // Refresh token expiry (Unix timestamp)
    role?: 'admin' | 'user';
    /** How the current session was established. 'credentials' = local admin
     *  (username/password + TOTP). 'oidc' = SSO via an OIDC provider. Used by
     *  UI surfaces that should read differently based on auth path. */
    authMethod?: 'credentials' | 'oidc';
    /** The required group that was enforced when this session was established.
     *  Empty string = no restriction. /unauthorized displays this rather than
     *  trusting a compile-time default, so admins see the actually-enforced
     *  group even when DB config has changed. */
    requiredGroup?: string;
    canViewAdmin?: boolean; // Whether user can view admin dashboard (read-only)
    canAccessDynamicAgents?: boolean; // Whether user can access custom agents
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshTokenExpiresAt?: number;
    error?: string;
    // groups removed - too large (40+ groups = 8KB cookie!)
    // profile removed - not needed
    isAuthorized?: boolean;
    role?: 'admin' | 'user';
    /** Set for local credentials login — bypasses OIDC group checks */
    credentialsRole?: 'admin' | 'user';
    /** Mirror of Session.authMethod — carries through on token refreshes. */
    authMethod?: 'credentials' | 'oidc';
    /** Mirror of Session.requiredGroup — carries through on token refreshes. */
    requiredGroup?: string;
    canViewAdmin?: boolean;
    canAccessDynamicAgents?: boolean;
    groupsCheckedAt?: number; // Unix timestamp of last group re-evaluation
    refreshSuppressedUntil?: number; // Unix timestamp — skip refresh attempts until this time (set after graceful invalid_grant)
  }
}
