// assisted-by Codex codex-gpt-5-5

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

test.describe("mocked Slack Run as browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("saves a Slack route that runs as a selected service account", async ({ page }) => {
    const routeWrites: unknown[] = [];
    let routes: unknown[] = [];

    const slackHandler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/admin/platform-config") {
        await fulfillJson(route, { data: { release_notes: { enabled: false } } });
        return true;
      }

      if (path === "/api/admin/slack/channels" && method === "GET") {
        await fulfillJson(route, {
          data: {
            channels: [
              {
                workspace_id: "T123456789",
                channel_id: "C123456789",
                channel_name: "incidents",
                team_slug: "platform-engineering",
                active_grants: 1,
                can_manage: true,
              },
            ],
          },
        });
        return true;
      }

      if (path === "/api/dynamic-agents" && method === "GET") {
        await fulfillJson(route, {
          data: {
            items: [
              { _id: "incident-agent", name: "Incident Agent" },
              { _id: "support-agent", name: "Support Agent" },
            ],
          },
        });
        return true;
      }

      if (path === "/api/admin/teams" && method === "GET") {
        await fulfillJson(route, {
          data: {
            teams: [
              { _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" },
            ],
          },
        });
        return true;
      }

      if (path === "/api/admin/slack/runtime/status" && method === "GET") {
        await fulfillJson(route, {
          data: {
            route_mode: "db_prefer",
            static_config: { channels: 1, routes: 0 },
            route_cache: { ttl_seconds: 60, cache_size: 0 },
          },
        });
        return true;
      }

      if (path === "/api/admin/slack/channels/T123456789/C123456789/routes") {
        if (method === "GET") {
          await fulfillJson(route, { data: { routes } });
          return true;
        }

        if (method === "PUT") {
          const body = (await postJson(route)) as { routes?: unknown[] } | null;
          routeWrites.push(body);
          routes = Array.isArray(body?.routes) ? body.routes : [];
          await fulfillJson(route, { data: { routes } });
          return true;
        }
      }

      if (path === "/api/admin/slack/channels/T123456789/C123456789/diagnostics") {
        await fulfillJson(route, {
          data: {
            openfga: { reachable: true, tuple_count: 1 },
            routes: [],
            warnings: [],
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts" && method === "GET") {
        expect(url.searchParams.get("team")).toBe("platform-engineering");
        await fulfillJson(route, {
          success: true,
          data: {
            items: [
              { id: "sa-sub-slack-runner", name: "slack-runner", status: "active" },
              { id: "sa-sub-breakglass", name: "breakglass-bot", status: "active" },
            ],
          },
        });
        return true;
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { slack: true },
      handlers: [slackHandler],
    });

    await page.goto("/admin?cat=integrations&tab=slack", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("tab", { name: "Configured channels" })).toBeVisible();
    await page.getByRole("button", { name: /#incidents/ }).click();
    await expect(page.getByRole("button", { name: "Team for #incidents" })).toContainText(
      "team:platform-engineering",
    );

    await page.getByRole("button", { name: "Add Agent" }).click();
    const dialog = page.getByRole("dialog", { name: /Add Agent to #incidents/ });
    await expect(dialog.getByText("Run as")).toBeVisible();
    await expect(dialog.getByLabel("Dynamic Agent")).toBeVisible();

    await dialog.getByLabel("Dynamic Agent").click();
    await page.getByRole("option", { name: /Incident Agent/ }).click();

    await dialog.getByLabel("Service Account").check();
    await expect(dialog.getByText(/No active service accounts found/)).not.toBeVisible();
    await dialog.getByRole("button", { name: "Service account" }).click();
    await page.getByLabel("Search service accounts").fill("runner");
    await page.getByRole("option", { name: "slack-runner" }).click();

    await dialog.getByRole("button", { name: "Add Agent" }).click();

    await expect.poll(() => routeWrites.length).toBe(1);
    expect(routeWrites[0]).toMatchObject({
      routes: [
        {
          agent_id: "incident-agent",
          execution_identity: {
            mode: "service_account",
            service_account_sub: "sa-sub-slack-runner",
            service_account_name: "slack-runner",
          },
        },
      ],
    });
    await expect(page.getByText("sa:slack-runner")).toBeVisible();
  });
});
