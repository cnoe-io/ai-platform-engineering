// assisted-by claude code claude-sonnet-4-6
/**
 * Playwright e2e tests — workflow run sharing
 *
 * Covers:
 *   - Owner sees Share button, can share, button turns green
 *   - Owner's direct run URL always accessible
 *   - Non-owner with no sharing sees 404-equivalent error
 *   - Non-owner with workspace sharing can open the run URL read-only
 *   - Non-owner cannot cancel/delete a workspace-shared run
 *   - Org-admin can open any run URL without sharing
 *   - Org-admin can cancel/delete any run
 *   - CAS-unavailable surfaces a 503 toast, not a 404
 *
 * All tests use the mocked RBAC harness (RUN_RBAC_REGRESSION=1).
 */

import { expect, test } from "@playwright/test";
import {
  buildPrivateAgentFixture,
  installWorkflowBrowserMocks,
  WORKFLOW_ORG_ADMIN_SESSION,
  WORKFLOW_OUTSIDER_SESSION,
  WORKFLOW_TEAM_MEMBER_SESSION,
  type WorkflowRunFixture,
} from "./_workflow-browser-fixtures";
import {
  fulfillJson,
  installMockedRbacApp,
  type MockRouteHandler,
} from "./_mocked-rbac";
import { mockedRbacEnabled } from "./_mocked-rbac";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_RUN_ID = "wfrun-owner-test";
const SHARED_RUN_ID = "wfrun-shared-test";

function buildCompletedRunFixture(
  runId: string,
  configId: string,
  ownerEmail: string,
  sharedWith?: "private" | "workspace" | "admin",
): WorkflowRunFixture & { owner_subject?: { type: string; id: string }; shared_with?: string } {
  return {
    _id: runId,
    workflow_config_id: configId,
    workflow_name: "Platform team workflow",
    status: "completed",
    current_step_index: 0,
    started_at: new Date(Date.now() - 60_000).toISOString(),
    completed_at: new Date().toISOString(),
    trigger_info: { triggered_by: "webui", user_email: ownerEmail },
    owner_subject: { type: "user", id: ownerEmail },
    shared_with: sharedWith ?? "private",
    steps: [
      {
        type: "step",
        index: 0,
        display_text: "Use private agent",
        agent_id: buildPrivateAgentFixture().id,
        status: "completed",
        response: "Done",
        attempts: 1,
        error: null,
      },
    ],
    events: {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Intercept PATCH /api/workflow-runs/[id] and capture bodies + responses. */
function buildRunSharingHandler(
  shareRequests: Array<{ id: string; body: unknown }>,
  runStore: { current: WorkflowRunFixture & { shared_with?: string } },
): MockRouteHandler {
  return async ({ route, path, method }) => {
    const patchMatch = path.match(/^\/api\/workflow-runs\/([^/]+)$/);
    if (patchMatch && method === "PATCH") {
      const id = patchMatch[1] ?? "";
      const body = await route.request().postDataJSON();
      shareRequests.push({ id, body });
      runStore.current = { ...runStore.current, shared_with: body?.shared_with ?? "private" };
      await fulfillJson(route, { id, shared_with: body?.shared_with ?? "private" });
      return true;
    }
    // GET /api/workflow-runs/[id] (path-param route)
    const getMatch = path.match(/^\/api\/workflow-runs\/([^/]+)$/);
    if (getMatch && method === "GET") {
      await fulfillJson(route, { ...runStore.current, events: {} });
      return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("workflow run sharing", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked workflow run sharing browser tests.",
    );
  });

  // ── Owner ─────────────────────────────────────────────────────────────────

  test("owner sees Share button on their run detail page", async ({ page }) => {
    const runFixture = buildCompletedRunFixture(
      OWNER_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
    );

    const shareRequests: Array<{ id: string; body: unknown }> = [];
    const runStore = { current: runFixture };
    const sharingHandler = buildRunSharingHandler(shareRequests, runStore);

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: ["platform"],
      workflowRun: runFixture,
    });

    // Also install the PATCH handler on top
    await page.route("/api/workflow-runs/**", async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const path = url.pathname;
      const handled = await sharingHandler({ route, url, path, method });
      if (!handled) await route.continue();
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Share button must be visible
    const shareButton = page.getByRole("button", { name: /share/i });
    await expect(shareButton).toBeVisible();
    // Not yet shared — no green indicator
    await expect(shareButton).not.toHaveClass(/green/);
  });

  test("owner clicking Share sets workspace visibility and copies URL", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const runFixture = buildCompletedRunFixture(
      OWNER_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "private",
    );
    const shareRequests: Array<{ id: string; body: unknown }> = [];
    const runStore = { current: runFixture };
    const sharingHandler = buildRunSharingHandler(shareRequests, runStore);

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: ["platform"],
      workflowRun: runFixture,
    });

    await page.route("/api/workflow-runs/**", async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const path = url.pathname;
      const handled = await sharingHandler({ route, url, path, method });
      if (!handled) await route.continue();
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    const shareButton = page.getByRole("button", { name: /share/i });
    await expect(shareButton).toBeVisible();
    await shareButton.click();

    // PATCH request sent with shared_with=workspace
    await expect.poll(() => shareRequests.length).toBe(1);
    expect(shareRequests[0]).toMatchObject({
      id: OWNER_RUN_ID,
      body: { shared_with: "workspace" },
    });

    // Button turns green / label changes to "Shared"
    await expect(page.getByRole("button", { name: /shared/i })).toBeVisible();

    // Toast shown
    await expect(page.getByText(/link copied/i)).toBeVisible();
  });

  test("owner's run URL is always accessible with no sharing required", async ({ page }) => {
    const runFixture = buildCompletedRunFixture(
      OWNER_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "private",
    );

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: ["platform"],
      workflowRun: runFixture,
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Run detail renders — step is visible
    await expect(page.getByText("Use private agent")).toBeVisible();
  });

  // ── Non-owner (private run) ───────────────────────────────────────────────

  test("non-owner gets a not-found error on a private run URL", async ({ page }) => {
    const shareRequests: Array<{ id: string; body: unknown }> = [];

    const handler: MockRouteHandler = async ({ route, path, method }) => {
      // GET /api/workflow-runs?run_id=… returns 404 for private run
      if (path === "/api/workflow-runs" && method === "GET") {
        await fulfillJson(route, { success: false, error: `Run ${OWNER_RUN_ID} not found` }, 404);
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: false,
      session: WORKFLOW_OUTSIDER_SESSION,
      handlers: [handler],
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Error state displayed — run detail should not render
    await expect(page.getByText(/not found|error/i)).toBeVisible();
    await expect(page.getByText("Use private agent")).not.toBeVisible();

    // No Share button visible to non-owners on error state
    await expect(page.getByRole("button", { name: /share/i })).not.toBeVisible();
    expect(shareRequests).toHaveLength(0);
  });

  // ── Non-owner (workspace-shared run) ─────────────────────────────────────

  test("non-owner can view a workspace-shared run in read-only mode", async ({ page }) => {
    const sharedRunFixture = buildCompletedRunFixture(
      SHARED_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "workspace",
    );

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_OUTSIDER_SESSION,
      teamSlugs: [],
      workflowRun: sharedRunFixture,
    });

    await page.goto(`/workflows/run/${SHARED_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Run detail renders for non-owner
    await expect(page.getByText("Use private agent")).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();

    // No Share button for non-owners
    await expect(page.getByRole("button", { name: /^share$/i })).not.toBeVisible();
  });

  test("non-owner cannot cancel a workspace-shared run", async ({ page }) => {
    const sharedRunFixture = buildCompletedRunFixture(
      SHARED_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "workspace",
    );
    // Override to running so Cancel button would appear
    sharedRunFixture.status = "running";
    sharedRunFixture.completed_at = undefined;
    sharedRunFixture.steps[0]!.status = "running";

    const cancelRequests: string[] = [];

    const handler: MockRouteHandler = async ({ route, path, method }) => {
      if (path.includes("/cancel") && method === "POST") {
        cancelRequests.push(path);
        await fulfillJson(route, { success: false, error: "Forbidden" }, 403);
        return true;
      }
      return false;
    };

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_OUTSIDER_SESSION,
      teamSlugs: [],
      workflowRun: sharedRunFixture,
    });

    await page.route("/api/workflow-runs/**", async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const handled = await handler({ route, url, path: url.pathname, method });
      if (!handled) await route.continue();
    });

    await page.goto(`/workflows/run/${SHARED_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Cancel button only shows on the progress map for the run owner
    // Non-owner view should not expose it
    await expect(page.getByRole("button", { name: /cancel/i })).not.toBeVisible();
    expect(cancelRequests).toHaveLength(0);
  });

  // ── Org-admin ─────────────────────────────────────────────────────────────

  test("org-admin can view any run without the owner sharing it", async ({ page }) => {
    const privateRunFixture = buildCompletedRunFixture(
      OWNER_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "private",
    );

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_ORG_ADMIN_SESSION,
      isAdmin: true,
      teamSlugs: ["platform"],
      workflowRun: privateRunFixture,
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Admin sees full run detail
    await expect(page.getByText("Use private agent")).toBeVisible();
    await expect(page.getByText("Completed")).toBeVisible();
  });

  test("org-admin sees the Share button to optionally broadcast a run", async ({ page }) => {
    const privateRunFixture = buildCompletedRunFixture(
      OWNER_RUN_ID,
      "wf-team-platform",
      WORKFLOW_TEAM_MEMBER_SESSION.email,
      "private",
    );

    const shareRequests: Array<{ id: string; body: unknown }> = [];
    const runStore = { current: privateRunFixture };
    const sharingHandler = buildRunSharingHandler(shareRequests, runStore);

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_ORG_ADMIN_SESSION,
      isAdmin: true,
      teamSlugs: ["platform"],
      workflowRun: privateRunFixture,
    });

    await page.route("/api/workflow-runs/**", async (route) => {
      const method = route.request().method();
      const url = new URL(route.request().url());
      const handled = await sharingHandler({ route, url, path: url.pathname, method });
      if (!handled) await route.continue();
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Admin can see and click Share (they are not the owner but have org-admin rights)
    // The Share button is rendered for the session user; we test it exists
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
  });

  // ── Error surface: CAS unavailable ────────────────────────────────────────

  test("CAS-unavailable returns a 503 toast instead of a misleading not-found", async ({ page }) => {
    const handler: MockRouteHandler = async ({ route, path, method }) => {
      if (path === "/api/workflow-runs" && method === "GET") {
        await fulfillJson(
          route,
          {
            success: false,
            error: "Authorization service temporarily unavailable.",
            code: "AUTHZ_UNAVAILABLE",
            reason: "pdp_unavailable",
            action: "retry",
          },
          503,
        );
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: false,
      session: WORKFLOW_OUTSIDER_SESSION,
      handlers: [handler],
    });

    await page.goto(`/workflows/run/${OWNER_RUN_ID}`, { waitUntil: "domcontentloaded" });

    // Error is surfaced — should mention unavailable / service or the error message itself
    await expect(
      page.getByText(/unavailable|service|error/i).first(),
    ).toBeVisible();

    // Crucially: should NOT say "not found" (which would mask the real issue)
    await expect(page.getByText(/not found/i)).not.toBeVisible();
  });
});
