// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import {
  buildDefaultWorkflowCatalog,
  installWorkflowBrowserMocks,
  WORKFLOW_TEAM_MEMBER_SESSION,
  type WorkflowRunFixture,
} from "./_workflow-browser-fixtures";
import { mockedRbacEnabled } from "./_mocked-rbac";

const FAILED_GITHUB_RUN: WorkflowRunFixture = {
  _id: "wfrun-playwright-github-fail",
  workflow_config_id: "wf-team-platform",
  workflow_name: "Platform team workflow",
  status: "failed",
  current_step_index: 0,
  started_at: "2026-06-22T08:39:01.000Z",
  completed_at: "2026-06-22T08:39:19.000Z",
  trigger_info: { triggered_by: "webui", user_email: "generic-user@caipe.local" },
  steps: [
    {
      type: "step",
      index: 0,
      display_text: "Get My Github Profile",
      agent_id: "agent-sre-automation",
      status: "failed",
      error:
        "GitHub agent unavailable: MCP server failed to load with HTTP 400 error. Missing provider credential.",
      attempts: 1,
    },
    {
      type: "step",
      index: 1,
      display_text: "Get SRE Jiras",
      agent_id: "agent-sre-automation",
      status: "pending",
      attempts: 0,
    },
  ],
  events: {},
};

const COMPLETED_RUN: WorkflowRunFixture = {
  _id: "wfrun-playwright-complete",
  workflow_config_id: "wf-global-mcp",
  workflow_name: "Global SRE workflow",
  status: "completed",
  current_step_index: 1,
  started_at: "2026-06-22T07:00:00.000Z",
  completed_at: "2026-06-22T07:05:00.000Z",
  trigger_info: { triggered_by: "webui", user_email: WORKFLOW_TEAM_MEMBER_SESSION.email },
  steps: [
    {
      type: "step",
      index: 0,
      display_text: "Probe Jira issues",
      agent_id: "agent-sre-automation",
      status: "completed",
      response: "Found 3 open SRE issues.",
      attempts: 1,
    },
    {
      type: "step",
      index: 1,
      display_text: "Summarize findings",
      agent_id: "agent-sre-automation",
      status: "completed",
      response: "Summary written to workflow filesystem.",
      attempts: 1,
    },
  ],
  events: {},
};

test.describe("RBAC e2e — workflow run detail page", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked workflow run detail regression.",
    );
  });

  test("shows failed status, step error text, and trigger metadata", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: FAILED_GITHUB_RUN,
    });

    await page.goto("/workflows/run/wfrun-playwright-github-fail", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Failed", { exact: true })).toBeVisible();
    await expect(page.getByText("wfrun-playwright-github-fail")).toBeVisible();
    await expect(page.getByText("Get My Github Profile")).toBeVisible();
    await expect(page.getByText(/HTTP 400 error/i)).toBeVisible();
    await expect(page.getByText("Get SRE Jiras")).toBeVisible();
    await expect(page.getByText(/Failed at step 1 of 2/i)).toBeVisible();
    await expect(page.getByText(/Triggered by:/i)).toBeVisible();
    await expect(page.getByText("webui", { exact: true })).toBeVisible();
  });

  test("shows completed run progress and step responses", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
      workflowRun: COMPLETED_RUN,
    });

    await page.goto("/workflows/run/wfrun-playwright-complete", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Probe Jira issues")).toBeVisible();
    await expect(page.getByText("Summarize findings")).toBeVisible();
    await expect(page.getByText(/Completed 2 steps/i)).toBeVisible();
    await expect(page.getByTestId("workflow-step-response").first()).toContainText(
      "Found 3 open SRE issues.",
    );
    await expect(page.getByTestId("workflow-step-response").nth(1)).toContainText(
      "Summary written to workflow filesystem.",
    );
  });

  test("navigates to the run page after starting a workflow from the editor", async ({ page }) => {
    const mocks = await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      workflows: buildDefaultWorkflowCatalog(),
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });
    await page.getByText("Platform team workflow").click();
    await page.getByText("Run", { exact: true }).click();

    await expect.poll(() => mocks.runRequests.length).toBe(1);
    await expect(page).toHaveURL(/\/workflows\/run\/wfrun-playwright-rbac$/);
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
  });
});
