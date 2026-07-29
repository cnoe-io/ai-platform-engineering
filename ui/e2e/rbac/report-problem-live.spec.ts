import { expect, test, type APIResponse } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

/**
 * Live regression for the /api/tickets/report and /api/tickets/jira RBAC
 * gate (PR #272).
 *
 * Both routes were missing from the legacy withAuth route resolver
 * (resolveLegacyWithAuthRbacPolicy in api-middleware.ts) and fell through to
 * its fail-closed default -- admin_ui#manage (admin-only) -- instead of the
 * intended feedback#submit capability (member or admin). That silently
 * blocked every non-admin "Report a Problem" / TOME feedback submission with
 * "You do not have permission to perform this action."
 *
 * Unlike report-problem.spec.ts (which mocks these two endpoints and only
 * covers UI wiring/routing), this drives the real withAuth ->
 * requireRbacPermission -> OpenFGA check end to end for RBAC_USER_EMAIL.
 *
 * Each request deliberately omits `contextUrl`. Both route handlers check
 * ticket-provider config and body validation AFTER the RBAC gate but BEFORE
 * ever calling createGitHubTicket()/createJiraTicket() -- so once RBAC
 * passes, an incomplete body guarantees a 400/503 short-circuit and this
 * test can never create a real GitHub issue or Jira ticket, regardless of
 * whether this stack happens to carry live ticket-provider secrets.
 *
 * Run with:
 *   RUN_RBAC_E2E=1 CAIPE_UI_BASE_URL=... KEYCLOAK_URL=... KEYCLOAK_REALM=... \
 *   RBAC_USER_EMAIL=... RBAC_USER_PASSWORD=... \
 *   npx playwright test --config=playwright.rbac.config.ts e2e/rbac/report-problem-live.spec.ts
 */

const ADMIN_ONLY_CAPABILITY = "admin_ui#manage";
const FEEDBACK_CAPABILITY = "feedback#submit";

/**
 * Asserts the response never fell back to the buggy admin-only capability.
 * Deliberately agnostic to whether RBAC_USER_EMAIL happens to be bound to an
 * admin or a plain member fixture in a given stack: if it's denied, the
 * denial must be the correct feedback#submit gate, never admin_ui#manage.
 */
async function expectNeverAdminOnlyGate(response: APIResponse) {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  expect(body?.code, JSON.stringify(body)).not.toBe(ADMIN_ONLY_CAPABILITY);
  if (response.status() === 403) {
    expect(body?.code).toBe(FEEDBACK_CAPABILITY);
  } else {
    // RBAC passed: the incomplete body guarantees a validation/config
    // short-circuit before any real GitHub/Jira call is ever made.
    expect([400, 503]).toContain(response.status());
  }
}

test.describe("live report-problem RBAC gate", () => {
  test("POST /api/tickets/report never falls back to the admin-only capability", async ({ page }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env);

    const response = await page.request.post(`${env.baseUrl}/api/tickets/report`, {
      data: { description: "e2e report-problem-live regression -- do not action" },
    });

    await expectNeverAdminOnlyGate(response);
  });

  test("POST /api/tickets/jira never falls back to the admin-only capability", async ({ page }) => {
    const env = rbacEnvOrSkip();
    await signIn(page, env);

    const response = await page.request.post(`${env.baseUrl}/api/tickets/jira`, {
      data: { description: "e2e report-problem-live regression -- do not action" },
    });

    await expectNeverAdminOnlyGate(response);
  });
});
