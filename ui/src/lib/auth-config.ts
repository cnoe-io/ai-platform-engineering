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
 */

// Group claim name - configurable via env var
// If not set, will auto-detect from common claim names
export const GROUP_CLAIM = process.env.OIDC_GROUP_CLAIM || "";

// Required group for authorization
export const REQUIRED_GROUP = process.env.OIDC_REQUIRED_GROUP || "backstage-access";

// Default group claim names to check (in order of priority)
const DEFAULT_GROUP_CLAIMS = ["memberOf", "groups", "group", "roles", "cognito:groups"];

// Helper to extract groups from OIDC claims
function extractGroups(profile: Record<string, unknown>): string[] {
  // If a specific claim is configured, use only that
  if (GROUP_CLAIM) {
    const value = profile[GROUP_CLAIM];
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === "string") {
      return value.split(/[,\s]+/).filter(Boolean);
    }
    // Claim not found or empty
    console.warn(`OIDC group claim "${GROUP_CLAIM}" not found in profile`);
    return [];
  }

  // Auto-detect: check various common group claim names
  for (const claim of DEFAULT_GROUP_CLAIMS) {
    const value = profile[claim];
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (typeof value === "string") {
      // Some providers return comma-separated or space-separated groups
      return value.split(/[,\s]+/).filter(Boolean);
    }
  }

  return [];
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

    const refreshedTokens = await response.json();

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
      // Request offline_access to get refresh tokens for seamless token renewal
      authorization: { params: { scope: "openid email profile groups offline_access" } },
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
        
        console.log("[Auth] Initial sign-in, token expires at:", 
          new Date((account.expires_at || 0) * 1000).toISOString());
      }

      // Extract and store groups from profile
      if (profile) {
        // Cast profile to Record for storage and group extraction
        const profileData = profile as unknown as Record<string, unknown>;
        token.profile = profileData;
        const groups = extractGroups(profileData);
        token.groups = groups;
        token.isAuthorized = hasRequiredGroup(groups);
      }

      // Return early if this is a forced update
      if (trigger === "update") {
        return token;
      }

      // Check if token needs refresh (refresh 5 minutes before expiry)
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = token.expiresAt as number | undefined;
      
      if (expiresAt) {
        const timeUntilExpiry = expiresAt - now;
        const shouldRefresh = timeUntilExpiry < 5 * 60; // Refresh if less than 5 min remaining

        if (shouldRefresh) {
          console.log(`[Auth] Token expires in ${timeUntilExpiry}s, refreshing...`);
          
          // Only attempt refresh if we have a refresh token
          if (token.refreshToken) {
            return await refreshAccessToken(token);
          } else {
            console.warn("[Auth] No refresh token available, cannot refresh");
            return {
              ...token,
              error: "RefreshTokenMissing",
            };
          }
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Send properties to the client
      session.accessToken = token.accessToken as string;
      session.idToken = token.idToken as string;
      session.error = token.error as string | undefined;
      session.groups = token.groups as string[];
      session.isAuthorized = token.isAuthorized as boolean;
      
      // If token refresh failed, log the user out
      if (token.error === "RefreshTokenExpired" || token.error === "RefreshTokenError") {
        console.error(`[Auth] Session invalid due to: ${token.error}`);
        session.error = token.error;
      }

      // Pass user info from token profile to session
      // Handle various OIDC provider claim formats (Duo, Okta, Azure AD, etc.)
      if (token.profile) {
        const profile = token.profile as Record<string, unknown>;

        // Extract name - support Duo (fullname, firstname/lastname) and standard (name, preferred_username)
        const fullName =
          (profile.fullname as string) ||
          (profile.name as string) ||
          `${(profile.firstname as string) || ""} ${(profile.lastname as string) || ""}`.trim() ||
          (profile.preferred_username as string) ||
          (profile.username as string) ||
          session.user?.name ||
          "User";

        // Extract email - fallback to username for some providers
        const email =
          (profile.email as string) ||
          (profile.username as string) ||
          session.user?.email;

        // Extract sub (subject) for unique user identifier
        const sub = (profile.sub as string) || (profile.id as string);

        session.user = {
          name: fullName,
          email: email,
          image: (profile.picture as string) || session.user?.image,
        };
        
        // Add sub to session for display in user menu
        session.sub = sub;
      }

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
  debug: process.env.NODE_ENV === "development",
};

// Extend next-auth types
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    idToken?: string;
    error?: string;
    groups?: string[];
    isAuthorized?: boolean;
    sub?: string; // User subject ID from OIDC
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: string;
    profile?: Record<string, unknown>;
    groups?: string[];
    isAuthorized?: boolean;
  }
}
