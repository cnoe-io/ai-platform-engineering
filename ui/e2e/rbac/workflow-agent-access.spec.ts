// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  MOCK_RBAC_EMAIL,
  mockedRbacEnabled,
  postJson,
} from "./_mocked-rbac";

const GLOBAL_ACCESS_LABEL = "(all users)";

type WorkflowScenario = {
  name: string;
  workflowId: string;
  workflowName: string;
  visibility: "global" | "team";
  sharedWithTeams?: string[];
  gapTarget: string;
  expectedGrant: {
    resource: { type: "agent"; id: string };
    grantee: { type: "everyone" } | { type: "team"; id: string };
    capability: "use";
  };
};

type InstalledMocks = {
  grantRequests: unknown[];
  saveRequests: unknown[];
  runRequests: unknown[];
};

const agent = {
  _id: "agent-private",
  id: "agent-private",
  name: "Private agent",
  description: "A private test agent",
};

const team = {
  _id: "team-platform",
  slug: "platform",
  name: "Platform Team",
};

function workflowFixture(scenario: WorkflowScenario) {
  return {
    _id: scenario.workflowId,
    name: scenario.workflowName,
    description: "Playwright RBAC fixture",
    owner_id: MOCK_RBAC_EMAIL,
    visibility: scenario.visibility,
    shared_with_teams: scenario.sharedWithTeams ?? null,
    config_driven: false,
    created_at: "2026-06-12T16:00:00.000Z",
    updated_at: "2026-06-12T16:00:00.000Z",
    steps: [
      {
        type: "step",
        display_text: "Use private agent",
        agent_id: agent.id,
        prompt: "Run the private agent",
        on_error: "abort",
        retry: null,
        config_override: null,
      },
    ],
  };
}

async function installWorkflowMocks(
  page: Page,
  scenario: WorkflowScenario,
  options: { denyGrants?: boolean } = {},
): Promise<InstalledMocks> {
  const grantRequests: unknown[] = [];
  const saveRequests: unknown[] = [];
  const runRequests: unknown[] = [];
  const workflow = workflowFixture(scenario);

  await installMockedRbacApp(page, {
    isAdmin: false,
    handlers: [
      async ({ route, url, path, method }) => {
        if (path === "/api/dynamic-agents/available" || path === "/api/dynamic-agents") {
          await fulfillJson(route, { data: [agent] });
          return true;
        }

        if (path === "/api/dynamic-agents/teams") {
          await fulfillJson(route, { success: true, data: [team] });
          return true;
        }

        if (path === "/api/workflow-configs/check-agent-access" && method === "POST") {
          await fulfillJson(route, {
            gaps: [
              {
                agentId: agent.id,
                agentName: agent.name,
                teamsWithoutAccess: [scenario.gapTarget],
              },
            ],
          });
          return true;
        }

        if (path === "/api/authz/v1/grants" && method === "POST") {
          grantRequests.push(await postJson(route));
          if (options.denyGrants) {
            await fulfillJson(
              route,
              {
                error: `Non-manager ${MOCK_RBAC_EMAIL} cannot manage ${agent.id}`,
              },
              403,
            );
            return true;
          }

          await fulfillJson(route, { success: true });
          return true;
        }

        if (path === "/api/workflow-configs" && method === "GET") {
          await fulfillJson(route, { data: [workflow] });
          return true;
        }

        if (path === "/api/workflow-configs" && (method === "PUT" || method === "POST")) {
          saveRequests.push(await postJson(route));
          await fulfillJson(route, { data: { id: workflow._id }, success: true });
          return true;
        }

        if (path === "/api/workflow-runs" && method === "GET") {
          await fulfillJson(route, []);
          return true;
        }

        if (path === "/api/workflow-runs" && method === "POST") {
          runRequests.push(await postJson(route));
          await fulfillJson(route, { run_id: "wfrun-playwright-rbac" });
          return true;
        }

        if (path === "/api/workflow-runs" && url.searchParams.get("run_id")) {
          await fulfillJson(route, {
            _id: "wfrun-playwright-rbac",
            workflow_config_id: workflow._id,
            status: "running",
            steps: [],
          });
          return true;
        }

        return false;
      },
    ],
  });

  return { grantRequests, saveRequests, runRequests };
}

async function openWorkflowEditor(page: Page, scenario: WorkflowScenario) {
  await page.goto("/workflows", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(scenario.workflowName)).toBeVisible();
  await page.getByText(scenario.workflowName).click();
  await expect(page.locator('input[placeholder="Workflow name..."]')).toHaveValue(
    scenario.workflowName,
  );
}

async function expectDeniedGrantBlocksSave(
  page: Page,
  scenario: WorkflowScenario,
  mocks: InstalledMocks,
) {
  await page.getByRole("button", { name: /^Save$/ }).click();

  const dialog = page.getByRole("dialog", { name: /agent access required/i });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(agent.name);
  await expect(dialog).toContainText(scenario.gapTarget);

  await page.getByRole("button", { name: /grant access and save/i }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByText(/cannot manage agent-private/i)).toBeVisible();
  await expect.poll(() => mocks.grantRequests.length).toBe(1);
  await expect.poll(() => mocks.saveRequests.length).toBe(0);
  expect(mocks.grantRequests[0]).toMatchObject(scenario.expectedGrant);
}

test.describe("workflow agent access grant modal", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  const deniedGrantScenarios: WorkflowScenario[] = [
    {
      name: "global workflow",
      workflowId: "wf-playwright-global",
      workflowName: "Global workflow needing private agent",
      visibility: "global",
      gapTarget: GLOBAL_ACCESS_LABEL,
      expectedGrant: {
        resource: { type: "agent", id: agent.id },
        grantee: { type: "everyone" },
        capability: "use",
      },
    },
    {
      name: "team workflow",
      workflowId: "wf-playwright-team",
      workflowName: "Team workflow needing private agent",
      visibility: "team",
      sharedWithTeams: [team.slug],
      gapTarget: team.slug,
      expectedGrant: {
        resource: { type: "agent", id: agent.id },
        grantee: { type: "team", id: team.slug },
        capability: "use",
      },
    },
  ];

  for (const scenario of deniedGrantScenarios) {
    test(`keeps the modal open and blocks save when a non-manager cannot grant ${scenario.name} agent access`, async ({
      page,
    }) => {
      const mocks = await installWorkflowMocks(page, scenario, { denyGrants: true });

      await openWorkflowEditor(page, scenario);
      await expectDeniedGrantBlocksSave(page, scenario, mocks);
    });
  }

  test("runs a visible workflow without requiring a direct legacy CAS read grant", async ({
    page,
  }) => {
    const scenario: WorkflowScenario = {
      name: "run access",
      workflowId: "wf-playwright-run",
      workflowName: "Visible workflow can run",
      visibility: "global",
      gapTarget: GLOBAL_ACCESS_LABEL,
      expectedGrant: {
        resource: { type: "agent", id: agent.id },
        grantee: { type: "everyone" },
        capability: "use",
      },
    };
    const mocks = await installWorkflowMocks(page, scenario);

    await openWorkflowEditor(page, scenario);
    await page.getByText("Run", { exact: true }).click();

    await expect.poll(() => mocks.runRequests.length).toBe(1);
    expect(mocks.runRequests[0]).toMatchObject({
      workflow_config_id: scenario.workflowId,
      trigger_info: { triggered_by: "webui" },
    });
    await expect(page).toHaveURL(/\/workflows\/run\/wfrun-playwright-rbac$/);
  });
});
