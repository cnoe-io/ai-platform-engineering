import { expect, test } from "@playwright/test";

import { mockedRbacEnabled } from "./_mocked-rbac";
import {
  buildDefaultWorkflowCatalog,
  installWorkflowBrowserMocks,
  WORKFLOW_DELEGATION_SERVICE_BEARER,
  WORKFLOW_ORG_ADMIN_SESSION,
  WORKFLOW_OUTSIDER_SESSION,
  WORKFLOW_TEAM_MEMBER_SESSION,
  workflowDelegationUserBearer,
} from "./_workflow-browser-fixtures";

test.describe("mocked workflow run-as-user delegation", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run workflow user-delegation regression.",
    );
  });

  test("service account bearer can start global workflow but not team workflow", async ({ page }) => {
    const mocks = await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_ORG_ADMIN_SESSION,
      isAdmin: true,
      requireBearerForWorkflowRuns: true,
      enforceWorkflowRunDelegation: true,
      workflows: buildDefaultWorkflowCatalog(),
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const globalStart = await page.evaluate(async (authHeader) => {
      const res = await fetch("/api/workflow-runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          workflow_config_id: "wf-global-mcp",
          trigger_info: { triggered_by: "agent", context: { agent_id: "agent-sre-agent" } },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, WORKFLOW_DELEGATION_SERVICE_BEARER);

    expect(globalStart.status).toBe(201);
    expect(globalStart.body).toMatchObject({ run_id: "wfrun-playwright-rbac", status: "running" });

    const teamStart = await page.evaluate(async (authHeader) => {
      const res = await fetch("/api/workflow-runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          workflow_config_id: "wf-team-platform",
          trigger_info: { triggered_by: "agent", context: { agent_id: "agent-sre-agent" } },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, WORKFLOW_DELEGATION_SERVICE_BEARER);

    expect(teamStart.status).toBe(403);
    expect(teamStart.body).toMatchObject({ code: "task#use", reason: "pdp_denied" });
    expect(mocks.runAuthHeaders).toEqual([WORKFLOW_DELEGATION_SERVICE_BEARER]);
  });

  test("delegated user bearer can start team workflow (Webex OBO path)", async ({ page }) => {
    const memberBearer = workflowDelegationUserBearer(WORKFLOW_TEAM_MEMBER_SESSION.email);

    const mocks = await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: ["platform"],
      requireBearerForWorkflowRuns: true,
      enforceWorkflowRunDelegation: true,
      delegationTeamSlugsByEmail: {
        [WORKFLOW_TEAM_MEMBER_SESSION.email.toLowerCase()]: ["platform"],
      },
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const teamStart = await page.evaluate(
      async ({ authHeader, workflowId }) => {
        const res = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            workflow_config_id: workflowId,
            user_context: "neo-coder run SRI Custom workflow",
            trigger_info: {
              triggered_by: "agent",
              context: { agent_id: "agent-sre-agent", source: "webex" },
            },
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { authHeader: memberBearer, workflowId: "wf-team-platform" },
    );

    expect(teamStart.status).toBe(201);
    expect(teamStart.body).toMatchObject({ run_id: "wfrun-playwright-rbac", status: "running" });
    expect(mocks.runAuthHeaders[0]).toBe(memberBearer);
    expect(mocks.runRequests[0]).toMatchObject({
      workflow_config_id: "wf-team-platform",
      trigger_info: { triggered_by: "agent" },
    });
  });

  test("delegated user bearer cannot start another user's private workflow", async ({ page }) => {
    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_OUTSIDER_SESSION,
      teamSlugs: [],
      requireBearerForWorkflowRuns: true,
      enforceWorkflowRunDelegation: true,
      delegationTeamSlugsByEmail: {
        [WORKFLOW_OUTSIDER_SESSION.email.toLowerCase()]: [],
      },
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const outsiderBearer = workflowDelegationUserBearer(WORKFLOW_OUTSIDER_SESSION.email);
    const privateStart = await page.evaluate(
      async ({ authHeader, workflowId }) => {
        const res = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            workflow_config_id: workflowId,
            trigger_info: { triggered_by: "agent" },
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { authHeader: outsiderBearer, workflowId: "wf-private-member" },
    );

    expect(privateStart.status).toBe(403);
    expect(privateStart.body).toMatchObject({ code: "task#use" });
  });

  test("workflow owner bearer can start private workflow", async ({ page }) => {
    const ownerBearer = workflowDelegationUserBearer(WORKFLOW_TEAM_MEMBER_SESSION.email);

    await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      requireBearerForWorkflowRuns: true,
      enforceWorkflowRunDelegation: true,
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const privateStart = await page.evaluate(
      async ({ authHeader, workflowId }) => {
        const res = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            workflow_config_id: workflowId,
            trigger_info: { triggered_by: "agent" },
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { authHeader: ownerBearer, workflowId: "wf-private-member" },
    );

    expect(privateStart.status).toBe(201);
  });

  test("simulates dynamic-agents choosing user bearer over service credentials", async ({ page }) => {
    const mocks = await installWorkflowBrowserMocks(page, {
      session: WORKFLOW_TEAM_MEMBER_SESSION,
      teamSlugs: ["platform"],
      requireBearerForWorkflowRuns: true,
      enforceWorkflowRunDelegation: true,
      delegationTeamSlugsByEmail: {
        [WORKFLOW_TEAM_MEMBER_SESSION.email.toLowerCase()]: ["platform"],
      },
    });

    await page.goto("/workflows", { waitUntil: "domcontentloaded" });

    const userBearer = workflowDelegationUserBearer(WORKFLOW_TEAM_MEMBER_SESSION.email);

    const result = await page.evaluate(
      async ({ userToken, serviceToken, workflowId }) => {
        const pickAuthHeader = (hasUserBearer: boolean, serviceConfigured: boolean) => {
          if (hasUserBearer) return userToken;
          if (serviceConfigured) return serviceToken;
          return "";
        };

        const authHeader = pickAuthHeader(true, true);
        const res = await fetch("/api/workflow-runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            workflow_config_id: workflowId,
            trigger_info: { triggered_by: "agent", context: { agent_id: "agent-sre-agent" } },
          }),
        });
        return { status: res.status, authHeader };
      },
      {
        userToken: userBearer,
        serviceToken: WORKFLOW_DELEGATION_SERVICE_BEARER,
        workflowId: "wf-team-platform",
      },
    );

    expect(result.status).toBe(201);
    expect(result.authHeader).toBe(userBearer);
    expect(mocks.runAuthHeaders[0]).toBe(userBearer);
    expect(mocks.runAuthHeaders[0]).not.toBe(WORKFLOW_DELEGATION_SERVICE_BEARER);
  });
});
