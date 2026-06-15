// assisted-by Codex Codex-sonnet-4-6

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

type ServiceAccountItem = {
  id: string;
  name: string;
  description?: string;
  owning_team_id: string;
  created_by: string;
  created_at: string;
  status: "active" | "revoked";
  scope_counts: { agents: number; tools: number };
};

type ScopeRef = { type: "agent" | "tool"; ref: string };

function counts(scopes: ScopeRef[]) {
  return {
    agents: scopes.filter((scope) => scope.type === "agent").length,
    tools: scopes.filter((scope) => scope.type === "tool").length,
  };
}

test.describe("mocked service accounts browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("creates, reveals once, manages scopes, rotates, and revokes service accounts", async ({
    page,
  }) => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const scopes: ScopeRef[] = [
      { type: "agent", ref: "incident-resolver" },
      { type: "tool", ref: "jira/search" },
    ];
    const createScopes: ScopeRef[] = [{ type: "agent", ref: "incident-resolver" }];
    let items: ServiceAccountItem[] = [];
    let deleted = false;

    const serviceAccountHandler: MockRouteHandler = async ({ route, path, method }) => {
      if (path === "/api/auth/my-roles" && method === "GET") {
        await fulfillJson(route, {
          teams: [{ _id: "team-1", slug: "team-sre", name: "SRE Team" }],
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/grantable" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            agents: [
              { ref: "incident-resolver", name: "Incident Resolver" },
              { ref: "runbook-agent", name: "Runbook Agent" },
            ],
            tools: [
              { ref: "jira/search", name: "jira: search" },
              { ref: "jira/*", name: "jira: all tools" },
            ],
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts" && method === "GET") {
        await fulfillJson(route, { success: true, data: { items } });
        return true;
      }

      if (path === "/api/admin/service-accounts" && method === "POST") {
        const body = await postJson(route);
        requests.push({ method, path, body });
        items = [
          {
            id: "sa-sub-playwright",
            name: "incident-bot",
            description: "PagerDuty integration",
            owning_team_id: "team-sre",
            created_by: "user-admin",
            created_at: "2026-06-15T12:00:00.000Z",
            status: "active",
            scope_counts: counts(scopes),
          },
        ];
        await fulfillJson(
          route,
          {
            success: true,
            data: {
              id: "sa-sub-playwright",
              name: "incident-bot",
              owning_team_id: "team-sre",
              credential: {
                client_id: "caipe-sa-incident-bot-a1b2c3",
                client_secret: "created-secret",
                token_url: "http://localhost:7080/realms/caipe/protocol/openid-connect/token",
              },
              granted_scopes: createScopes,
              rejected_scopes: [],
            },
          },
          201,
        );
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-playwright" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            id: "sa-sub-playwright",
            name: "incident-bot",
            description: "PagerDuty integration",
            owning_team_id: "team-sre",
            created_by: "user-admin",
            created_at: "2026-06-15T12:00:00.000Z",
            status: deleted ? "revoked" : "active",
            scopes,
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-playwright/scopes") {
        const body = (await postJson(route)) as ScopeRef;
        requests.push({ method, path, body });
        if (method === "POST") {
          scopes.push(body);
          items = items.map((item) => ({
            ...item,
            scope_counts: counts(scopes),
          }));
          await fulfillJson(route, { success: true, data: { added: body } });
          return true;
        }
        if (method === "DELETE") {
          const index = scopes.findIndex(
            (scope) => scope.type === body.type && scope.ref === body.ref,
          );
          if (index >= 0) scopes.splice(index, 1);
          items = items.map((item) => ({
            ...item,
            scope_counts: counts(scopes),
          }));
          await fulfillJson(route, { success: true, data: { removed: body } });
          return true;
        }
      }

      if (path === "/api/admin/service-accounts/sa-sub-playwright/rotate" && method === "POST") {
        requests.push({ method, path, body: null });
        await fulfillJson(route, {
          success: true,
          data: {
            credential: {
              client_id: "caipe-sa-incident-bot-a1b2c3",
              client_secret: "rotated-secret",
              token_url: "http://localhost:7080/realms/caipe/protocol/openid-connect/token",
            },
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-playwright" && method === "DELETE") {
        requests.push({ method, path, body: null });
        deleted = true;
        items = [];
        await fulfillJson(route, { success: true, data: { id: "sa-sub-playwright", status: "revoked" } });
        return true;
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [serviceAccountHandler],
    });

    await page.goto("/admin?cat=settings&tab=service-accounts", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Service Accounts", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create Service Account" }).click();

    const createDialog = page.getByRole("dialog", { name: "Create Service Account" });
    await createDialog.getByLabel("Name").fill("incident-bot");
    await createDialog.getByLabel(/Description/).fill("PagerDuty integration");
    await createDialog.getByLabel("Owning team").click();
    await page.getByLabel("Search teams...").fill("sre");
    await page.getByRole("option", { name: /SRE Team/ }).click();
    await createDialog.getByRole("button", { name: "Grant agents you hold..." }).click();
    await page.getByRole("button", { name: "Incident Resolver" }).first().click({ force: true });
    await createDialog.getByRole("button", { name: "Create" }).click({ force: true });

    await expect.poll(() => requests.some((request) => request.method === "POST" && request.path === "/api/admin/service-accounts")).toBe(true);
    expect(
      requests.find((request) => request.method === "POST" && request.path === "/api/admin/service-accounts")?.body,
    ).toMatchObject({
      name: "incident-bot",
      description: "PagerDuty integration",
      owning_team_id: "team-sre",
      scopes: createScopes,
    });

    const revealDialog = page.getByRole("dialog", { name: "Service account created" });
    await expect(revealDialog.getByText("created-secret", { exact: true })).toBeVisible();
    await expect(revealDialog.getByRole("button", { name: "Done" })).toBeDisabled();
    await revealDialog
      .getByLabel("I have copied the client secret and understand it won't be shown again.")
      .check();
    await revealDialog.getByRole("button", { name: "Done" }).click();

    const createdRow = page.getByRole("row", { name: /incident-bot/ });
    await expect(createdRow).toContainText("incident-bot");
    await expect(createdRow).toContainText("team-sre");
    await page.getByRole("button", { name: "Manage" }).click();

    const manageDialog = page.getByRole("dialog", { name: "incident-bot" });
    await expect(manageDialog.getByText("jira/search")).toBeVisible();
    await manageDialog.getByRole("button", { name: "Add agents you hold..." }).click();
    await page.getByRole("button", { name: "Runbook Agent" }).first().click({ force: true });
    await manageDialog.getByRole("button", { name: "Add", exact: true }).click({ force: true });
    await expect.poll(() => requests.some((request) => request.method === "POST" && request.path.endsWith("/scopes"))).toBe(true);
    expect(
      requests.find((request) => request.method === "POST" && request.path.endsWith("/scopes"))?.body,
    ).toEqual({ type: "agent", ref: "runbook-agent" });
    await expect(manageDialog.getByText("runbook-agent")).toBeVisible();

    await manageDialog.getByRole("button", { name: "Remove tool jira/search" }).click();
    await manageDialog.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => requests.some((request) => request.method === "DELETE" && request.path.endsWith("/scopes"))).toBe(true);
    expect(
      requests.find((request) => request.method === "DELETE" && request.path.endsWith("/scopes"))?.body,
    ).toEqual({ type: "tool", ref: "jira/search" });
    await expect(manageDialog.getByText("jira/search")).toHaveCount(0);

    await manageDialog.getByRole("button", { name: "Rotate credential" }).click();
    await manageDialog.getByRole("button", { name: "Confirm rotate" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Service account created" })
        .getByText("rotated-secret", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Service account created" })
      .getByLabel("I have copied the client secret and understand it won't be shown again.")
      .check();
    await page.getByRole("dialog", { name: "Service account created" }).getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByRole("dialog", { name: "incident-bot" }).getByRole("button", { name: "Delete service account" }).click();
    await page.getByRole("button", { name: "Confirm delete" }).click();
    await expect.poll(() => requests.some((request) => request.method === "DELETE" && request.path === "/api/admin/service-accounts/sa-sub-playwright")).toBe(true);
    await expect(page.getByText("No service accounts yet")).toBeVisible();
  });
});
