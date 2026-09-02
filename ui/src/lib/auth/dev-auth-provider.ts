import { getConfig } from "@/lib/config";
import type { AdminTabGatesMap } from "@/lib/rbac/types";

export const DEV_AUTH_SUBJECT = "anonymous-local-dev";
export const DEV_AUTH_EMAIL = "anonymous@local";
export const DEV_AUTH_ORG = "caipe";

export interface DevAuthUser {
  email: string;
  name: string;
  role: "admin";
}

export interface DevAuthSession {
  sub: string;
  org: string;
  role: "admin";
  user: DevAuthUser;
  accessToken?: string;
  canViewAdmin: true;
  canAccessDynamicAgents: true;
}

/**
 * Local development auth provider.
 *
 * This is intentionally a provider, not a one-off bypass. In no-SSO local
 * development it supplies a stable admin principal so route handlers and UI
 * gates can exercise normal authz code without a real IdP session.
 */
export function isDevAnonymousAuthEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return Boolean(
    !getConfig("ssoEnabled") &&
      getConfig("allowDevAdminWhenSsoDisabled") &&
      getConfig("unsafeRbacBypassEnabled")
  );
}

export function getDevAnonymousUser(): DevAuthUser {
  return {
    email: DEV_AUTH_EMAIL,
    name: "Anonymous Local Admin",
    role: "admin",
  };
}

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const EXPIRY_SAFETY_MS = 30_000;

interface CachedDevAnonToken {
  accessToken: string;
  expiresAtMs: number;
}
// Minted dev-anonymous impersonation tokens are cached in-memory (single
// well-known subject, so a plain holder is enough) until shortly before
// expiry, mirroring the owner-token cache in scheduled-run-auth.ts.
let devAnonTokenCache: CachedDevAnonToken | null = null;

function keycloakUrl(): string | undefined {
  return process.env.KEYCLOAK_URL?.trim().replace(/\/$/, "");
}

function realm(): string {
  return process.env.KEYCLOAK_REALM?.trim() || "caipe";
}

function devAnonClientId(): string {
  return process.env.DEV_ANON_CLIENT_ID?.trim() || "caipe-dev-anon-runner";
}

function devAnonUserId(): string {
  return process.env.DEV_ANON_USER_ID?.trim() || DEV_AUTH_SUBJECT;
}

function platformAudience(): string {
  return (
    process.env.CAIPE_PLATFORM_AUDIENCE?.trim() ||
    process.env.KEYCLOAK_SCHEDULER_AUDIENCE?.trim() ||
    "caipe-platform"
  );
}

function tokenEndpoint(): string | undefined {
  const url = keycloakUrl();
  if (!url) return undefined;
  return `${url}/realms/${encodeURIComponent(realm())}/protocol/openid-connect/token`;
}

/**
 * Mint (and cache) a real Keycloak access token for the dev-anonymous
 * session via RFC 8693 token-exchange impersonation, mirroring
 * mintScheduledOwnerToken in scheduled-run-auth.ts, but targeting the
 * stable local-dev user instead of a real owner.
 *
 * This is a dev-mode convenience, not a security boundary: on any failure
 * (env vars unset, Keycloak unreachable, non-200 response) it logs a
 * warning and returns undefined so callers keep working token-less, e.g.
 * for non-docker-compose dev setups that never wired the exchange client.
 */
async function mintDevAnonAccessToken(): Promise<string | undefined> {
  if (devAnonTokenCache && devAnonTokenCache.expiresAtMs > Date.now()) {
    return devAnonTokenCache.accessToken;
  }

  const endpoint = tokenEndpoint();
  const clientSecret = process.env.DEV_ANON_CLIENT_SECRET?.trim();
  if (!endpoint || !clientSecret) {
    console.warn(
      "[dev-auth-provider] KEYCLOAK_URL or DEV_ANON_CLIENT_SECRET not set; dev-anonymous session will have no access token"
    );
    return undefined;
  }

  try {
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      client_id: devAnonClientId(),
      client_secret: clientSecret,
      requested_subject: devAnonUserId(),
      requested_token_type: ACCESS_TOKEN_TYPE,
      audience: platformAudience(),
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[dev-auth-provider] dev-anonymous token exchange failed: ${response.status} ${detail.slice(0, 300)}`
      );
      return undefined;
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      console.warn("[dev-auth-provider] dev-anonymous token exchange returned no access_token");
      return undefined;
    }

    const expiresInMs = (typeof data.expires_in === "number" ? data.expires_in : 300) * 1000;
    devAnonTokenCache = {
      accessToken: data.access_token,
      expiresAtMs: Date.now() + Math.max(0, expiresInMs - EXPIRY_SAFETY_MS),
    };
    return data.access_token;
  } catch (error) {
    console.warn("[dev-auth-provider] dev-anonymous token exchange threw:", error);
    return undefined;
  }
}

export async function getDevAnonymousSession(): Promise<DevAuthSession> {
  const user = getDevAnonymousUser();
  const accessToken = await mintDevAnonAccessToken();
  return {
    sub: DEV_AUTH_SUBJECT,
    org: DEV_AUTH_ORG,
    role: "admin",
    user,
    accessToken,
    canViewAdmin: true,
    canAccessDynamicAgents: true,
  };
}

export function allAdminTabGates(gatesShape: AdminTabGatesMap): AdminTabGatesMap {
  return Object.fromEntries(Object.keys(gatesShape).map((key) => [key, true])) as AdminTabGatesMap;
}
