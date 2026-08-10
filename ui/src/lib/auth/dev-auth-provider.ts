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

export function getDevAnonymousSession(): DevAuthSession {
  const user = getDevAnonymousUser();
  return {
    sub: DEV_AUTH_SUBJECT,
    org: DEV_AUTH_ORG,
    role: "admin",
    user,
    canViewAdmin: true,
    canAccessDynamicAgents: true,
  };
}

export function allAdminTabGates(gatesShape: AdminTabGatesMap): AdminTabGatesMap {
  return Object.fromEntries(Object.keys(gatesShape).map((key) => [key, true])) as AdminTabGatesMap;
}
