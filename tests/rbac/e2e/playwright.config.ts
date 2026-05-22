/**
 * Playwright config for the spec-102 RBAC e2e suite — task T056.
 *
 * Scope
 * -----
 * The Playwright suite owns ONLY the `surface: ui_bff` rows that need a
 * real browser session (login flow, SSO redirect, cookie-set, audit-log
 * tail). Every other surface (supervisor / mcp / dynamic_agents / rag /
 * slack_bot) is exercised by the pytest matrix-driver
 * (`tests/rbac/unit/py/test_matrix_driver.py`).
 *
 * Why a separate config (vs. the dev `next` test runner)?
 *  - Playwright lives outside `ui/`. It depends on the **e2e stack**,
 *    not the local `next dev` server. The e2e lane is just
 *    `docker-compose.dev.yaml` with a few `${VAR:-default}` substitutions
 *    activated by `make test-rbac-up` (see Makefile E2E_COMPOSE_ENV).
 *  - Port band: caipe-ui MUST stay on host :3000 (Keycloak's caipe-ui
 *    client only allow-lists http://localhost:3000/* as a redirect URI,
 *    see deploy/keycloak/realm-config.json). Mongo + supervisor move to
 *    the 28xxx band (28017, 28000) to avoid collisions with a host-side
 *    Mongo on 27017 and an in-stack agent-splunk that publishes 8010.
 *  - Each persona is a Playwright "project" — Playwright runs the same
 *    spec set once per project, mints a real Keycloak token via the
 *    fixture in `tests/rbac/fixtures/keycloak.ts`, and stores it in the
 *    test storage state so the spec can hit BFF routes without re-doing
 *    the OIDC dance per test.
 *
 * Honour env overrides
 * --------------------
 * The Makefile's `test-rbac-up` target sets the canonical URLs; specs
 * SHOULD read them via `process.env` rather than hard-coding. We document
 * the canonical names here so `quickstart.md` can reference them.
 *
 *   E2E_UI_URL          default http://localhost:3000   (IdP-pinned; not remapped)
 *   E2E_KC_URL          default http://localhost:7080   (dev publishes this; not remapped)
 *   E2E_KC_REALM        default cnoe
 *   E2E_AUDIT_API       default http://localhost:28000/_test/audit (supervisor stub)
 *
 * Artifacts
 * ---------
 * Per spec the Playwright artifacts (trace, screenshot, video) live in
 * `tests/rbac/e2e/test-results/`. The CI workflow (T060) uploads this
 * directory on failure.
 */

import { defineConfig, devices } from "@playwright/test";

const UI_BASE_URL = process.env.E2E_UI_URL ?? "http://localhost:3000";

// Per-spec timeout (ms). The OIDC redirect dance + BFF cold start can
// approach the default 30s on slower runners; bump to 60s to be safe.
const TEST_TIMEOUT_MS = 60_000;

// Retry once on CI to absorb single-flake cases (Keycloak start-up, mongo
// connection delay). Locally we never retry — fast feedback on real
// regressions.
const RETRIES = process.env.CI ? 1 : 0;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "test-results",
  timeout: TEST_TIMEOUT_MS,
  retries: RETRIES,
  // Up to 4 workers locally; CI uses 2 to fit in the standard runner's
  // 4-core quota without saturating Keycloak (which is the long-pole
  // bottleneck — every test run mints fresh tokens).
  workers: process.env.CI ? 2 : 4,
  fullyParallel: true,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  use: {
    baseURL: UI_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  // One project per persona. The persona fixture
  // (tests/rbac/fixtures/keycloak.ts) is idempotent and cached, so the
  // same token can be reused across the spec set.
  projects: [
    {
      name: "alice_admin",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      metadata: { persona: "alice_admin" },
    },
    {
      name: "bob_chat_user",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      metadata: { persona: "bob_chat_user" },
    },
    {
      name: "carol_kb_ingestor",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      metadata: { persona: "carol_kb_ingestor" },
    },
    {
      name: "dave_no_role",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      metadata: { persona: "dave_no_role" },
    },
    {
      name: "eve_dynamic_agent_user",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      metadata: { persona: "eve_dynamic_agent_user" },
    },
    // frank_service_account uses client_credentials grant — no browser
    // path. We exclude it from the Playwright projects intentionally;
    // the matrix-driver pytest covers it.
  ],
});
