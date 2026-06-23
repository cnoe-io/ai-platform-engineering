import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";
import { buildMcpWorkflowAgentFixture } from "./_workflow-browser-fixtures";

const adminSession = {
  email: "admin@caipe.local",
  name: "Platform Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

const teamMemberSession = {
  email: "member@caipe.local",
  name: "Team Member",
  role: "user" as const,
  canViewAdmin: true,
};

const workflowAgent = buildMcpWorkflowAgentFixture();

function webexHandler(state: {
  routeWrites: unknown[];
  defaultsRequests: unknown[];
  routes: unknown[];
}): MockRouteHandler {
  return async ({ route, path, method }) => {
    if (path === "/api/admin/webex/spaces" || path === "/api/admin/webex/spaces?health=1") {
      await fulfillJson(route, {
        data: {
          spaces: [
            {
              workspace_id: "WEBEX-WORKSPACE",
              space_id: "space-incidents",
              space_name: "Incident Bridge",
              team_slug: "platform",
              active_grants: 1,
              can_manage: true,
            },
          ],
        },
      });
      return true;
    }

    if (path.startsWith("/api/admin/webex/available-spaces") && method === "GET") {
      await fulfillJson(route, {
        data: {
          spaces: [
            {
              id: "space-incidents",
              name: "Incident Bridge",
              type: "group",
              is_locked: false,
            },
            {
              id: "space-onboard-new",
              name: "Workflow Alerts",
              type: "group",
              is_locked: false,
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      });
      return true;
    }

    if (path === "/api/dynamic-agents?enabled_only=true" || path === "/api/dynamic-agents") {
      await fulfillJson(route, {
        data: {
          items: [
            { _id: workflowAgent.id, name: workflowAgent.name },
            { _id: "support-agent", name: "Support Agent" },
          ],
        },
      });
      return true;
    }

    if (path === "/api/admin/teams" && method === "GET") {
      await fulfillJson(route, {
        data: {
          teams: [{ _id: "team-platform", slug: "platform", name: "Platform Team" }],
        },
      });
      return true;
    }

    if (path === "/api/admin/webex/spaces/defaults" && method === "GET") {
      await fulfillJson(route, {
        data: {
          defaults: {
            team_slug: "platform",
            agent_id: workflowAgent.id,
          },
        },
      });
      return true;
    }

    if (path === "/api/admin/webex/spaces/defaults" && method === "POST") {
      state.defaultsRequests.push(await postJson(route));
      await fulfillJson(route, {
        data: {
          summary: {
            spaces_onboarded: 1,
            spaces_assigned_team: 1,
            space_grants_ensured: 1,
            routes_ensured: 1,
            routes_preserved: 0,
          },
        },
      });
      return true;
    }

    if (path === "/api/admin/webex/runtime/status" && method === "GET") {
      await fulfillJson(route, {
        data: {
          route_mode: "db_prefer",
          static_config: { spaces: 1, routes: 1 },
          route_cache: { ttl_seconds: 60, cache_size: 1 },
          thread_context: { enabled: true, max_messages: 10, max_chars: 4000 },
        },
      });
      return true;
    }

    if (
      path === "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-incidents/routes" &&
      method === "GET"
    ) {
      await fulfillJson(route, { data: { routes: state.routes } });
      return true;
    }

    if (
      path === "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-incidents/routes" &&
      method === "PUT"
    ) {
      const body = await postJson(route);
      state.routeWrites.push(body);
      state.routes = Array.isArray((body as { routes?: unknown[] } | null)?.routes)
        ? ((body as { routes: unknown[] }).routes ?? [])
        : [];
      await fulfillJson(route, { data: { routes: state.routes } });
      return true;
    }

    if (
      path === "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-incidents/diagnostics" &&
      method === "GET"
    ) {
      await fulfillJson(route, {
        data: {
          openfga: { reachable: true, tuple_count: 1 },
          warnings: [],
          routes: [
            {
              agent_id: workflowAgent.id,
              openfga_tuple: true,
              route_metadata: true,
              listen: "mention",
              runtime_matches: { mention: true, message: false },
              warnings: ["Mention-only listen mode blocks plain messages"],
            },
          ],
        },
      });
      return true;
    }

    return false;
  };
}

test.describe("mocked Webex workflow agent routing regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked Webex workflow routing regression.",
    );
  });

  test("onboards a Webex space to the same MCP-backed agent used in workflows", async ({
    page,
  }) => {
    const defaultsRequests: unknown[] = [];
    const routeWrites: unknown[] = [];
    const routes: unknown[] = [];

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { webex: true },
      handlers: [webexHandler({ routeWrites, defaultsRequests, routes })],
    });

    await page.goto("/admin?cat=integrations&tab=webex", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Onboard spaces" }).click();
    await page.getByRole("button", { name: /^Find spaces$/i }).click();

    await expect(page.getByText(/bot-visible spaces discovered/i)).toBeVisible();
    await page.getByRole("checkbox", { name: /Import Incident Bridge/i }).check();
    await expect(page.getByRole("button", { name: /Team for Incident Bridge/i })).toContainText("Platform Team");
    await expect(page.getByRole("button", { name: /Dynamic Agent for Incident Bridge/i })).toContainText(workflowAgent.name);
    await expect(page.getByRole("checkbox", { name: /Import Workflow Alerts/i })).toBeChecked();
    await expect(page.getByRole("button", { name: /Team for Workflow Alerts/i })).toContainText("Platform Team");
    await expect(page.getByRole("button", { name: /Dynamic Agent for Workflow Alerts/i })).toContainText(workflowAgent.name);
    await page.getByRole("button", { name: /^Set up 2 spaces$/ }).click();

    await expect.poll(() => defaultsRequests.length).toBe(1);
    expect(defaultsRequests[0]).toMatchObject({
      team_slug: "platform",
      agent_id: workflowAgent.id,
      create_routes: true,
      manual_spaces: [
        { id: "space-incidents", name: "Incident Bridge" },
        { id: "space-onboard-new", name: "Workflow Alerts" },
      ],
    });
  });

  test("fixes Webex listen mode so the bot can dispatch plain messages to the workflow agent", async ({
    page,
  }) => {
    const routeWrites: unknown[] = [];
    const routes: unknown[] = [
      {
        agent_id: workflowAgent.id,
        enabled: true,
        priority: 100,
        users: { enabled: true, listen: "mention" },
      },
    ];

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { webex: true },
      handlers: [webexHandler({ routeWrites, defaultsRequests: [], routes })],
    });

    await page.goto("/admin?cat=integrations&tab=webex", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Incident Bridge")).toBeVisible();
    await page.getByText("Incident Bridge").click();
    const fixButton = page.getByRole("button", {
      name: new RegExp(`Fix routing for ${workflowAgent.id}`),
    });
    await expect(fixButton).toBeVisible();
    await fixButton.click();

    await expect.poll(() => routeWrites.length).toBe(1);
    expect(JSON.stringify(routeWrites[0])).toContain('"listen":"all"');
  });

  test("lets a non-org-admin team member manage Webex routing for a team-shared space", async ({
    page,
  }) => {
    const routeWrites: unknown[] = [];
    const routes: unknown[] = [
      {
        agent_id: workflowAgent.id,
        enabled: true,
        priority: 100,
        users: { enabled: true, listen: "all" },
      },
    ];

    await installMockedRbacApp(page, {
      isAdmin: false,
      session: teamMemberSession,
      gates: {
        webex: true,
        settings: false,
        teams: false,
        users: false,
        metrics: false,
        health: false,
      },
      handlers: [webexHandler({ routeWrites, defaultsRequests: [], routes })],
    });

    await page.goto("/admin?cat=integrations&tab=webex", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("My Webex Space Settings")).toBeVisible();
    await expect(
      page.getByText(
        "Manage bot routing behavior only for Webex spaces where OpenFGA grants you space admin access.",
      ),
    ).toBeVisible();
    await page.getByText("Incident Bridge").click();
    await expect(page.getByText(workflowAgent.id)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Onboard spaces" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Advanced" })).toHaveCount(0);
  });
});
