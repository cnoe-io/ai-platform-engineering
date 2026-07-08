// assisted-by claude code claude-sonnet-4-6
// E2E tests for workflow run team-sharing.
// Verifies the Share button, dialog UI, and POST /api/workflow-runs/[id]/share call.

import { expect, test } from "@playwright/test";

import {
  buildDefaultWorkflowCatalog,
  installWorkflowBrowserMocks,
  WORKFLOW_TEAM_MEMBER_SESSION,
  WORKFLOW_OPS_TEAM,
  WORKFLOW_PLATFORM_TEAM,
  type WorkflowRunFixture,
} from "./_workflow-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

const RUNNING_RUN: WorkflowRunFixture = {
  _id: "wfrun-share-e2e",
  workflow_config_id: "wf-global-mcp",
  workflow_name: "Global SRE workflow",
  status: "running",
  current_step_index: 0,
  started_at: "2026-07-08T10:00:00.000Z",
  trigger_info: { triggered_by: "webui", user_email: WORKFLOW_TEAM_MEMBER_SESSION.email },
  steps: [
    {
      type: "step",
      index: 0,
      display_text: "Probe Jira issues",
      agent_id: "agent-sre-automation",
      status: "running",
      attempts: 1,
    },
  ],
  events: {},
};

const COMPLETED_RUN: WorkflowRunFixture = {
  ...RUNNING_RUN,
  _id: "wfrun-share-complete",
  status: "completed",
  steps: [{ ...RUNNING_RUN.steps[0], status: "completed", response: "Done." }],
};

const ALREADY_SHARED_RUN: WorkflowRunFixture = {
  ...RUNNING_RUN,
  _id: "wfrun-already-shared",
  shared_with_teams: [WORKFLOW_PLATFORM_TEAM.slug],
};

test.describe("mocked RBAC e2e — workflow run team-sharing", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked workflow run share regression.",
    );
  });

  test("Share button visible on running run", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: RUNNING_RUN,
    });

    await page.goto("/workflows/run/wfrun-share-e2e", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
  });

  test("Share button visible on completed run", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: COMPLETED_RUN,
    });

    await page.goto("/workflows/run/wfrun-share-complete", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
  });

  test("Share button NOT visible on cancelled run", async ({ page }) => {
    const cancelledRun: WorkflowRunFixture = {
      ...RUNNING_RUN,
      _id: "wfrun-share-cancelled",
      status: "cancelled",
      steps: [{ ...RUNNING_RUN.steps[0], status: "skipped" }],
    };

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: cancelledRun,
    });

    await page.goto("/workflows/run/wfrun-share-cancelled", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /share/i })).not.toBeVisible();
  });

  test("clicking Share opens dialog with TeamMultiPicker", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: [WORKFLOW_PLATFORM_TEAM.slug, WORKFLOW_OPS_TEAM.slug],
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: RUNNING_RUN,
    });

    await page.goto("/workflows/run/wfrun-share-e2e", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /share/i }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Share Workflow Run")).toBeVisible();
    await expect(page.getByText(/team members.*will be able to view/i)).toBeVisible();
  });

  test("dialog pre-populates selected teams from shared_with_teams", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: [WORKFLOW_PLATFORM_TEAM.slug, WORKFLOW_OPS_TEAM.slug],
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: ALREADY_SHARED_RUN,
    });

    await page.goto("/workflows/run/wfrun-already-shared", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /share/i }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    // The platform team chip should already be selected
    await expect(page.getByText(WORKFLOW_PLATFORM_TEAM.name)).toBeVisible();
  });

  test("Save in dialog calls POST /api/workflow-runs/[id]/share and closes dialog", async ({ page }) => {
    let shareCallBody: unknown = null;

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: [WORKFLOW_PLATFORM_TEAM.slug, WORKFLOW_OPS_TEAM.slug],
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: RUNNING_RUN,
    });

    await page.route("**/api/workflow-runs/wfrun-share-e2e/share", async (route) => {
      if (route.request().method() === "POST") {
        shareCallBody = await route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ shared_with_teams: [WORKFLOW_PLATFORM_TEAM.slug] }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/workflows/run/wfrun-share-e2e", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /share/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Click Save without changing anything
    await page.getByRole("button", { name: "Save" }).click();

    await expect.poll(() => shareCallBody).toBeTruthy();
    expect(shareCallBody).toMatchObject({ shared_with_teams: expect.any(Array) });

    // Dialog closes after successful save
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3000 });
  });

  test("Save shows error message when API returns 400", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: [WORKFLOW_PLATFORM_TEAM.slug],
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: RUNNING_RUN,
    });

    await page.route("**/api/workflow-runs/wfrun-share-e2e/share", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Unknown team slug(s): invalid-team" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/workflows/run/wfrun-share-e2e", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /share/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Unknown team slug/i)).toBeVisible({ timeout: 3000 });
    // Dialog should remain open on error
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("Cancel in dialog closes it without calling the API", async ({ page }) => {
    let shareCallMade = false;

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: [WORKFLOW_PLATFORM_TEAM.slug],
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: RUNNING_RUN,
    });

    await page.route("**/api/workflow-runs/wfrun-share-e2e/share", async (route) => {
      shareCallMade = true;
      await route.continue();
    });

    await page.goto("/workflows/run/wfrun-share-e2e", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /share/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3000 });
    expect(shareCallMade).toBe(false);
  });
});
