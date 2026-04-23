import type { NextAuthOptions } from "next-auth";
import { decodeJwt } from "jose";

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
 *   (Also accepts NEXT_PUBLIC_SSO_ENABLED for backward compatibility.)
 *   If SSO does not appear enabled: check window.__APP_CONFIG__ in the browser.
 * - OIDC_GROUP_CLAIM: The OIDC claim name(s) for groups. Supports:
 *     - Single value: "memberOf"
 *     - Comma-separated: "groups,members,roles" (all checked, results combined)
 *     - Empty/unset: auto-detect from common claim names
 * - OIDC_REQUIRED_GROUP: Group name required for access (default: "backstage-access")
 * - OIDC_REQUIRED_ADMIN_GROUP: Group name for admin access (default: none)
 * - OIDC_ENABLE_REFRESH_TOKEN: "true" to enable refresh token support (default: true if not set)
 */

// Check if refresh token support should be enabled
// Defaults to true for backward compatibility, but can be disabled if OIDC provider doesn't support it
export const ENABLE_REFRESH_TOKEN = process.env.OIDC_ENABLE_REFRESH_TOKEN !== "false";

// Group claim name(s) - configurable via env var
// Supports single value or comma-separated list (e.g., "groups,members,roles")
// If not set, will auto-detect from common claim names
export const GROUP_CLAIM = process.env.OIDC_GROUP_CLAIM || "";

// Required group for authorization.
// Use ?? (nullish coalescing) so that setting OIDC_REQUIRED_GROUP="" disables
// the group check. || would treat "" as falsy and fall back to "backstage-access".
export const REQUIRED_GROUP = process.env.OIDC_REQUIRED_GROUP ?? "backstage-access";

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
 * @returns Array of unique group names
 */
function extractGroups(profile: Record<string, unknown>): string[] {
  const allGroups = new Set<string>();

  // If specific claim(s) configured, use only those
  // Supports comma-separated list (e.g., "groups,members,roles")
  if (GROUP_CLAIM) {
    const configuredClaims = GROUP_CLAIM.split(",").map(c => c.trim()).filter(Boolean);
    for (const claimName of configuredClaims) {
      const value = profile[claimName];
      if (value !== undefined) {
        addGroupsFromValue(value, allGroups);
      }
    }
    if (allGroups.size === 0) {
      console.warn(`OIDC group claim(s) "${GROUP_CLAIM}" not found in profile`);
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

// Helper to check if user has required group
export function hasRequiredGroup(groups: string[]): boolean {
  if (!REQUIRED_GROUP) return true; // No group required

  return groups.some((group) => {
    // Handle both simple group names and full DN paths
    // e.g., "backstage-access" or "CN=backstage-access,OU=Groups,DC=example,DC=com"
    const groupLower = group.toLowerCase();
    const requiredLower = REQUIRED_GROUP.toLowerCase();
    return groupLower === requiredLower || groupLower.includes(`cn=${requiredLower}`);
  });
}

// Helper to check if user is in admin group
export function isAdminUser(groups: string[]): boolean {
  if (!REQUIRED_ADMIN_GROUP) return false; // No admin group configured

  return groups.some((group) => {
    // Handle both simple group names and full DN paths
    const groupLower = group.toLowerCase();
    const adminGroupLower = REQUIRED_ADMIN_GROUP.toLowerCase();
    return groupLower === adminGroupLower || groupLower.includes(`cn=${adminGroupLower}`);
  });
}

// Helper to check if user can access dynamic agents.
// If OIDC_REQUIRED_DYNAMIC_AGENTS_GROUP is set, only that group has access
// (admin group membership does NOT automatically grant access in this case).
// If unset, falls back to admin-only access.
export function canAccessDynamicAgents(groups: string[]): boolean {
  if (REQUIRED_DYNAMIC_AGENTS_GROUP) {
    const requiredLower = REQUIRED_DYNAMIC_AGENTS_GROUP.toLowerCase();
    return groups.some(g => g.toLowerCase() === requiredLower || g.toLowerCase().includes(`cn=${requiredLower}`));
  }
  // No explicit group configured → admins only
  return isAdminUser(groups);
}

// Helper to check if user can view admin dashboard (read-only)
// If OIDC_REQUIRED_ADMIN_VIEW_GROUP is not set, all authenticated users can view
export function canViewAdminDashboard(groups: string[]): boolean {
  if (!REQUIRED_ADMIN_VIEW_GROUP) return true; // No view group configured = all authenticated users

  return groups.some((group) => {
    const groupLower = group.toLowerCase();
    const viewGroupLower = REQUIRED_ADMIN_VIEW_GROUP.toLowerCase();
    return groupLower === viewGroupLower || groupLower.includes(`cn=${viewGroupLower}`);
  });
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
  ],
  callbacks: {
    async jwt({ token, account, profile, trigger }) {
      // Initial sign in - persist the OAuth tokens
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

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

        // Extract groups for authorization check only (not stored in token)
        const groups = extractGroups(profileData);

        // Only store the authorization result and role (NOT the groups array!)
        // Storing 40+ groups causes 8KB session cookies and browser crashes
        token.isAuthorized = hasRequiredGroup(groups);
        token.role = isAdminUser(groups) ? 'admin' : 'user';
        token.canViewAdmin = token.role === 'admin' || canViewAdminDashboard(groups);
        token.canAccessDynamicAgents = canAccessDynamicAgents(groups);
        token.groupsCheckedAt = Math.floor(Date.now() / 1000);

        // Debug logging (groups array is NOT stored in token)
        console.log('[Auth JWT] User groups count:', groups.length);
        console.log('[Auth JWT] Required admin group:', REQUIRED_ADMIN_GROUP);
        console.log('[Auth JWT] Required admin view group:', REQUIRED_ADMIN_VIEW_GROUP);
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
                const groups = extractGroups(claims as Record<string, unknown>);
                const adminUser = isAdminUser(groups);
                console.log(`[Auth] Re-evaluating groups from refreshed id_token (last checked ${Math.round((now - lastGroupCheck) / 3600)}h ago), count: ${groups.length}`);
                return {
                  ...refreshedToken,
                  isAuthorized: hasRequiredGroup(groups),
                  role: adminUser ? 'admin' : 'user',
                  canViewAdmin: adminUser || canViewAdminDashboard(groups),
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
    canViewAdmin?: boolean;
    canAccessDynamicAgents?: boolean;
    groupsCheckedAt?: number; // Unix timestamp of last group re-evaluation
    refreshSuppressedUntil?: number; // Unix timestamp — skip refresh attempts until this time (set after graceful invalid_grant)
  }
}
