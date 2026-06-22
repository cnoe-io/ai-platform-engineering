// assisted-by Codex Codex-sonnet-4-6
/**
 * Shared env-var resolver and skip-guard for the RBAC e2e suite.
 *
 * Every spec calls `requireRbacEnv()` in a `test.beforeAll` so that:
 *   - When RUN_RBAC_E2E is NOT set, `test.skip()` is invoked and the
 *     suite is no-op'd out. This keeps the harness committable without
 *     forcing every dev to spin up Keycloak.
 *   - When RUN_RBAC_E2E=1 but a required var is missing, the test
 *     fails fast with a clear message rather than crashing inside a
 *     selector.
 */

import { test } from "@playwright/test";

export interface RbacEnv {
  baseUrl: string;
  keycloakUrl: string;
  keycloakRealm: string;
  user: { email: string; password: string; sub?: string };
  noAccess?: { email: string; password: string; sub?: string };
}

export function rbacEnvOrSkip(
  options: { requireNoAccess?: boolean; requireUserSub?: boolean } = {},
): RbacEnv {
  if (process.env.RUN_RBAC_E2E !== "1") {
    test.skip(true, "RUN_RBAC_E2E not set; skipping RBAC e2e harness.");
    // Unreachable but keeps TS happy.
    return null as unknown as RbacEnv;
  }

  const required = [
    "CAIPE_UI_BASE_URL",
    "KEYCLOAK_URL",
    "KEYCLOAK_REALM",
    "RBAC_USER_EMAIL",
    "RBAC_USER_PASSWORD",
    ...(options.requireUserSub === true ? (["RBAC_USER_SUB"] as const) : []),
    ...(options.requireNoAccess === true
      ? (["RBAC_NOACCESS_USER_EMAIL", "RBAC_NOACCESS_USER_PASSWORD"] as const)
      : []),
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `RBAC e2e suite is enabled but required env vars are missing: ${missing.join(", ")}`,
    );
  }

  const noAccess =
    process.env.RBAC_NOACCESS_USER_EMAIL && process.env.RBAC_NOACCESS_USER_PASSWORD
      ? {
          email: process.env.RBAC_NOACCESS_USER_EMAIL,
          password: process.env.RBAC_NOACCESS_USER_PASSWORD,
          ...(process.env.RBAC_NOACCESS_USER_SUB ? { sub: process.env.RBAC_NOACCESS_USER_SUB } : {}),
        }
      : undefined;

  return {
    baseUrl: process.env.CAIPE_UI_BASE_URL!,
    keycloakUrl: process.env.KEYCLOAK_URL!,
    keycloakRealm: process.env.KEYCLOAK_REALM!,
    user: {
      email: process.env.RBAC_USER_EMAIL!,
      password: process.env.RBAC_USER_PASSWORD!,
      ...(process.env.RBAC_USER_SUB ? { sub: process.env.RBAC_USER_SUB } : {}),
    },
    ...(noAccess ? { noAccess } : {}),
  };
}

export function rbacEnvWithNoAccessOrSkip(): RbacEnv & {
  noAccess: { email: string; password: string; sub?: string };
} {
  const env = rbacEnvOrSkip();
  if (!env.noAccess) {
    test.skip(
      true,
      "RBAC_NOACCESS_USER_EMAIL/RBAC_NOACCESS_USER_PASSWORD not set; skipping no-access persona coverage.",
    );
  }
  return env as RbacEnv & { noAccess: { email: string; password: string } };
}
