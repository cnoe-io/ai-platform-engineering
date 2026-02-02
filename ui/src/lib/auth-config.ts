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
 * - NEXT_PUBLIC_SSO_ENABLED: "true" to enable SSO, otherwise disabled
 * - OIDC_GROUP_CLAIM: The OIDC claim name for groups (default: auto-detect from memberOf, groups, etc.)
 * - OIDC_REQUIRED_GROUP: Group name required for access (default: "backstage-access")
 * - OIDC_REQUIRED_ADMIN_GROUP: Group name for admin access (default: none)
 * - OIDC_ENABLE_REFRESH_TOKEN: "true" to enable refresh token support (default: true if not set)
 */

// Check if refresh token support should be enabled
// Defaults to true for backward compatibility, but can be disabled if OIDC provider doesn't support it
export const ENABLE_REFRESH_TOKEN = process.env.OIDC_ENABLE_REFRESH_TOKEN !== "false";

// Group claim name - configurable via env var
// If not set, will auto-detect from common claim names
export const GROUP_CLAIM = process.env.OIDC_GROUP_CLAIM || "";

// Required group for authorization
export const REQUIRED_GROUP = process.env.OIDC_REQUIRED_GROUP || "backstage-access";

// Required admin group for admin access
export const REQUIRED_ADMIN_GROUP = process.env.OIDC_REQUIRED_ADMIN_GROUP || "";

// Default group claim names to check (in order of priority)
// Note: Duo SSO uses "members" for full group list, "groups" for limited set
const DEFAULT_GROUP_CLAIMS = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"];

// Helper to extract groups from OIDC claims
// Combines groups from multiple claims (Duo uses both "groups" and "members")
function extractGroups(profile: Record<string, unknown>): string[] {
  const allGroups = new Set<string>();

  // If a specific claim is configured, use only that
  if (GROUP_CLAIM) {
    const value = profile[GROUP_CLAIM];
    if (Array.isArray(value)) {
      value.map(String).forEach(g => allGroups.add(g));
    } else if (typeof value === "string") {
      value.split(/[,\s]+/).filter(Boolean).forEach(g => allGroups.add(g));
    } else {
      console.warn(`OIDC group claim "${GROUP_CLAIM}" not found in profile`);
    }
    return Array.from(allGroups);
  }

  // Auto-detect: check ALL common group claim names and combine them
  // This is important for Duo SSO which uses both "groups" and "members"
  for (const claim of DEFAULT_GROUP_CLAIMS) {
    const value = profile[claim];
    if (Array.isArray(value)) {
      value.map(String).forEach(g => allGroups.add(g));
    } else if (typeof value === "string") {
      // Some providers return comma-separated or space-separated groups
      value.split(/[,\s]+/).filter(Boolean).forEach(g => allGroups.add(g));
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

    // Get the token endpoint from the OIDC issuer
    const tokenEndpoint = `${issuer}/protocol/openid-connect/token`;

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
      idToken: refreshedTokens.id_token,
      expiresAt: Math.floor(Date.now() / 1000) + (refreshedTokens.expires_in || 3600),
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken, // Use new refresh token if provided
      error: undefined, // Clear any previous errors
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

        const expiryDate = new Date((account.expires_at || 0) * 1000).toISOString();
        console.log("[Auth] Initial sign-in, token expires at:", expiryDate);

        // Log whether refresh token support is available
        if (ENABLE_REFRESH_TOKEN) {
          if (account.refresh_token) {
            console.log("[Auth] ✅ Refresh token available - seamless token renewal enabled");
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
        
        // Debug logging (groups array is NOT stored in token)
        console.log('[Auth JWT] User groups count:', groups.length);
        console.log('[Auth JWT] Required admin group:', REQUIRED_ADMIN_GROUP);
        console.log('[Auth JWT] User role:', token.role);
        console.log('[Auth JWT] Is authorized:', token.isAuthorized);
      }

      // Return early if this is a forced update
      if (trigger === "update") {
        return token;
      }

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
        // Store access token and ID token for client-side use
        session.accessToken = token.accessToken as string;
        session.idToken = token.idToken as string; // Needed for decoding groups/claims client-side
        session.hasRefreshToken = !!token.refreshToken; // Indicate if refresh token is available
      }
      
      session.error = token.error as string | undefined;
      session.isAuthorized = token.isAuthorized as boolean;
      
      // Set role from token (OIDC group check only here)
      // MongoDB fallback check happens in API middleware (server-side only)
      session.role = (token.role as 'admin' | 'user') || 'user';

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
    idToken?: string; // Needed for client-side group extraction (not stored in cookie, fetched on demand)
    hasRefreshToken?: boolean; // Indicate if refresh token is available
    error?: string;
    // groups removed from session - too large (40+ groups = 8KB cookie!)
    // Instead, extract groups client-side from idToken when needed
    isAuthorized?: boolean;
    sub?: string; // User subject ID from OIDC
    role?: 'admin' | 'user';
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
    // groups removed - too large (40+ groups = 8KB cookie!)
    // profile removed - not needed
    isAuthorized?: boolean;
    role?: 'admin' | 'user';
  }
}
