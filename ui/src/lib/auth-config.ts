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

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "oidc",
      name: "SSO",
      type: "oauth",
      wellKnown: process.env.OIDC_ISSUER
        ? `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`
        : undefined,
      // Request groups/memberOf scope if available
      authorization: { params: { scope: "openid email profile groups" } },
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
    async jwt({ token, account, profile }) {
      // Persist the OAuth access_token and id_token to the token right after signin
      if (account) {
        token.accessToken = account.access_token;
        token.idToken = account.id_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }

      // Extract and store groups from profile
      if (profile) {
        token.profile = profile;
        const groups = extractGroups(profile as Record<string, unknown>);
        token.groups = groups;
        token.isAuthorized = hasRequiredGroup(groups);
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

        session.user = {
          name: fullName,
          email: email,
          image: (profile.picture as string) || session.user?.image,
        };
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
