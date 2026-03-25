import type { NextAuthOptions } from "next-auth";

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
 *   If SSO does not appear enabled: check window.__APP_CONFIG__ in the browser
 *   or GET /api/debug/auth-status.
 * - OIDC_GROUP_CLAIM: The OIDC claim name(s) for groups. Supports:
 *     - Single value: "memberOf"
 *     - Comma-separated: "groups,members,roles" (all checked, results combined)
 *     - Empty/unset: auto-detect from common claim names
 * - OIDC_REQUIRED_GROUP: Group name required for access (default: "backstage-access"; set to empty to disable)
 * - OIDC_REQUIRED_ADMIN_GROUP: Group name for admin access (default: none)
 * - OIDC_ENABLE_REFRESH_TOKEN: "true" to enable refresh token support (default: true if not set)
 * - OIDC_IDP_HINT: Keycloak IdP alias to auto-redirect (e.g., "duo-sso"). Omit to show login form.
 */

// Check if refresh token support should be enabled
// Defaults to true for backward compatibility, but can be disabled if OIDC provider doesn't support it
export const ENABLE_REFRESH_TOKEN = process.env.OIDC_ENABLE_REFRESH_TOKEN !== "false";

// Group claim name(s) - configurable via env var
// Supports single value or comma-separated list (e.g., "groups,members,roles")
// If not set, will auto-detect from common claim names
export const GROUP_CLAIM = process.env.OIDC_GROUP_CLAIM || "";

// Required group for authorization
export const REQUIRED_GROUP = process.env.OIDC_REQUIRED_GROUP ?? "backstage-access";

// Required admin group for admin access
export const REQUIRED_ADMIN_GROUP = process.env.OIDC_REQUIRED_ADMIN_GROUP || "";

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

/**
 * Refresh the access token using the refresh token
 *
 * This function calls the OIDC token endpoint to exchange a refresh_token
 * for a new access_token and id_token.
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
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    // Check content-type before parsing - OIDC providers may return HTML error pages
    const contentType = response.headers.get("content-type") || "";
    let refreshedTokens: any;

    if (contentType.includes("application/json")) {
      refreshedTokens = await response.json();
    } else {
      // Response is not JSON (likely HTML error page)
      const text = await response.text();
      console.error("[Auth] Token refresh returned non-JSON response:", text.substring(0, 200));
      return {
        ...token,
        error: "RefreshTokenExpired",
      };
    }

    if (!response.ok) {
      console.error("[Auth] Token refresh failed:", refreshedTokens);
      return {
        ...token,
        error: "RefreshTokenExpired",
      };
    }

    console.log("[Auth] Token refreshed successfully");

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshedTokens.expires_in || 3600),
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (error) {
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
      // Keycloak issues regular refresh tokens for confidential clients
      // without needing offline_access scope. Requesting offline_access
      // requires extra Keycloak config and causes login failures if not
      // enabled on the client/realm. Regular refresh tokens are sufficient.
      authorization: {
        params: {
          scope: "openid email profile groups",
          ...(process.env.OIDC_IDP_HINT ? { kc_idp_hint: process.env.OIDC_IDP_HINT } : {}),
        }
      },
      idToken: true,
      checks: ["pkce", "state"],
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
      profile(profile) {
        // Build display name from available claims.
        // Keycloak sends standard OIDC: name, given_name, family_name
        // Duo SSO sends: fullname, firstname, lastname, username
        const composedName =
          `${profile.given_name || profile.firstname || ""} ${profile.family_name || profile.lastname || ""}`.trim();
        const name =
          profile.name || profile.fullname || composedName ||
          profile.preferred_username || profile.username || profile.email;

        console.log("[Auth profile] Claims:", {
          name: profile.name,
          given_name: profile.given_name,
          family_name: profile.family_name,
          fullname: profile.fullname,
          preferred_username: profile.preferred_username,
          resolved: name,
        });

        return {
          id: profile.sub,
          name,
          email: profile.email || profile.username,
          image: profile.picture,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, account, profile, trigger, session: updateData }) {
      // Strip idToken from existing sessions — it adds ~1KB and pushes
      // the cookie over the 4096-byte limit, causing chunking loops.
      if (token.idToken) {
        delete token.idToken;
      }

      // Force-refresh when admin changes roles/permissions and calls
      // update({ forceRefresh: true }) from the client.
      if (
        trigger === "update" &&
        updateData &&
        typeof updateData === "object" &&
        (updateData as Record<string, unknown>).forceRefresh &&
        token.refreshToken
      ) {
        console.log("[Auth] Force-refreshing token (role/permission change)");
        const refreshed = await refreshAccessToken(token) as typeof token;
        // Re-extract realm roles from the fresh access token
        if (refreshed.accessToken && !refreshed.error) {
          try {
            const parts = (refreshed.accessToken as string).split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(
                Buffer.from(parts[1], "base64url").toString()
              );
              const ra = payload.realm_access;
              if (ra && Array.isArray(ra.roles)) {
                refreshed.realmRoles = ra.roles;
                console.log("[Auth] Updated realm roles from refreshed token:", ra.roles);
              }
            }
          } catch (e) {
            console.warn("[Auth] Could not decode refreshed access token for realm roles:", e);
          }
        }
        return refreshed;
      }

      // Initial sign in - persist the OAuth tokens (NOT id_token).
      if (account) {
        token.accessToken = account.access_token;
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

        // Extract Keycloak realm_access.roles (098 RBAC)
        const realmAccess = profileData.realm_access as { roles?: string[] } | undefined;
        if (realmAccess?.roles) {
          token.realmRoles = realmAccess.roles;
        }

        // Extract org claim for multi-tenant isolation (FR-020)
        if (typeof profileData.org === "string") {
          token.org = profileData.org;
        }

        // Debug logging (groups array is NOT stored in token)
        console.log('[Auth JWT] User groups count:', groups.length);
        console.log('[Auth JWT] Required admin group:', REQUIRED_ADMIN_GROUP);
        console.log('[Auth JWT] Required admin view group:', REQUIRED_ADMIN_VIEW_GROUP);
        console.log('[Auth JWT] User role:', token.role);
        console.log('[Auth JWT] Can view admin:', token.canViewAdmin);
        console.log('[Auth JWT] Is authorized:', token.isAuthorized);
        if (token.realmRoles) {
          console.log('[Auth JWT] Keycloak realm roles:', token.realmRoles);
        }
        if (token.org) {
          console.log('[Auth JWT] Org (tenant):', token.org);
        }
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

          console.log(`[Auth] Token expires in ${timeUntilExpiry}s, attempting refresh...`);

          // Only attempt refresh if we have a refresh token
          if (token.refreshToken) {
            return await refreshAccessToken(token);
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
        session.accessToken = token.accessToken as string;
        session.hasRefreshToken = !!token.refreshToken;
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

      // 098 RBAC: Keycloak realm roles and org claim for enterprise RBAC
      session.realmRoles = token.realmRoles as string[] | undefined;
      session.org = token.org as string | undefined;

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
  debug: process.env.NODE_ENV === "development",
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
    hasRefreshToken?: boolean;
    error?: string;
    isAuthorized?: boolean;
    sub?: string;
    expiresAt?: number;
    refreshTokenExpiresAt?: number;
    role?: 'admin' | 'user';
    canViewAdmin?: boolean;
    realmRoles?: string[];  // Keycloak realm_access.roles (098 RBAC)
    org?: string;           // Tenant identifier from org claim (FR-020)
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    refreshTokenExpiresAt?: number;
    error?: string;
    isAuthorized?: boolean;
    role?: 'admin' | 'user';
    canViewAdmin?: boolean;
    realmRoles?: string[];  // Keycloak realm_access.roles (098 RBAC)
    org?: string;           // Tenant identifier from org claim (FR-020)
  }
}
