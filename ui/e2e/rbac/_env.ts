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
  user: { email: string; password: string };
  noAccess: { email: string; password: string };
}

export function rbacEnvOrSkip(): RbacEnv {
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
    "RBAC_NOACCESS_USER_EMAIL",
    "RBAC_NOACCESS_USER_PASSWORD",
  ] as const;

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `RBAC e2e suite is enabled but required env vars are missing: ${missing.join(", ")}`,
    );
  }

  return {
    baseUrl: process.env.CAIPE_UI_BASE_URL!,
    keycloakUrl: process.env.KEYCLOAK_URL!,
    keycloakRealm: process.env.KEYCLOAK_REALM!,
    user: {
      email: process.env.RBAC_USER_EMAIL!,
      password: process.env.RBAC_USER_PASSWORD!,
    },
    noAccess: {
      email: process.env.RBAC_NOACCESS_USER_EMAIL!,
      password: process.env.RBAC_NOACCESS_USER_PASSWORD!,
    },
  };
}
