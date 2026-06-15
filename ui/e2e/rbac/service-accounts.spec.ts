// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Page } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "rbac-admin@example.com",
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

type ServiceAccountCredential = {
  id: string;
  provider: string;
  status: "connected" | "revoked";
  connectedAt?: string;
  requestedScopes?: string[];
};

function counts(scopes: ScopeRef[]) {
  return {
    agents: scopes.filter((scope) => scope.type === "agent").length,
    tools: scopes.filter((scope) => scope.type === "tool").length,
  };
}

async function forceCredentialClientConfig(page: Page) {
  await page.addInitScript(() => {
    let appConfig: Record<string, unknown> | undefined;
    Object.defineProperty(window, "__APP_CONFIG__", {
      configurable: true,
      get() {
        return appConfig;
      },
      set(next) {
        appConfig = {
          ...(typeof next === "object" && next !== null ? next : {}),
          credentialsEnabled: true,
          userConnectionsEnabled: true,
        };
      },
    });
  });
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

      if (path === "/api/admin/service-accounts/sa-sub-playwright/credentials" && method === "GET") {
        await fulfillJson(route, { success: true, data: [] });
        return true;
      }

      if (path === "/api/admin/service-accounts/token-providers" && method === "GET") {
        await fulfillJson(route, { success: false, code: "CREDENTIALS_DISABLED" }, 404);
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
    await expect(manageDialog.getByRole("button", { name: "Remove tool jira/search" })).toBeVisible();
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
    await expect(manageDialog.getByRole("button", { name: "Remove tool jira/search" })).toHaveCount(0);

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

  test("adds, validates, lists, de-duplicates, and removes service account provider tokens", async ({
    page,
  }) => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const items: ServiceAccountItem[] = [
      {
        id: "sa-sub-token-bot",
        name: "token-bot",
        description: "Uses provider tokens",
        owning_team_id: "team-sre",
        created_by: "user-admin",
        created_at: "2026-06-15T12:00:00.000Z",
        status: "active",
        scope_counts: { agents: 1, tools: 1 },
      },
    ];
    const credentials: ServiceAccountCredential[] = [];
    let failNextAdd = true;

    const tokenHandler: MockRouteHandler = async ({ route, path, method }) => {
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
            agents: [{ ref: "incident-resolver", name: "Incident Resolver" }],
            tools: [{ ref: "gitlab/projects", name: "gitlab: projects" }],
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts" && method === "GET") {
        await fulfillJson(route, { success: true, data: { items } });
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-token-bot" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            id: "sa-sub-token-bot",
            name: "token-bot",
            description: "Uses provider tokens",
            owning_team_id: "team-sre",
            created_by: "user-admin",
            created_at: "2026-06-15T12:00:00.000Z",
            status: "active",
            scopes: [
              { type: "agent", ref: "incident-resolver" },
              { type: "tool", ref: "gitlab/projects" },
            ],
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/token-providers" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: [
            { provider: "github", name: "GitHub" },
            { provider: "gitlab", name: "GitLab" },
          ],
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-token-bot/credentials") {
        if (method === "GET") {
          await fulfillJson(route, { success: true, data: credentials });
          return true;
        }

        if (method === "POST") {
          const body = await postJson(route);
          requests.push({ method, path, body });
          if (failNextAdd) {
            failNextAdd = false;
            await fulfillJson(route, { success: false, error: "Token already exists" }, 409);
            return true;
          }
          credentials.push({
            id: "conn-gitlab",
            provider: "gitlab",
            status: "connected",
            connectedAt: "2026-06-15T12:34:00.000Z",
            requestedScopes: ["api"],
          });
          await fulfillJson(
            route,
            {
              success: true,
              data: {
                id: "conn-gitlab",
                provider: "gitlab",
                status: "connected",
                connectedAt: "2026-06-15T12:34:00.000Z",
                requestedScopes: ["api"],
              },
            },
            201,
          );
          return true;
        }

        if (method === "DELETE") {
          const body = (await postJson(route)) as { connection_id?: string } | null;
          requests.push({ method, path, body });
          const index = credentials.findIndex((credential) => credential.id === body?.connection_id);
          if (index >= 0) credentials.splice(index, 1);
          await fulfillJson(route, { success: true, data: { deleted: body?.connection_id } });
          return true;
        }
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { credentials: true },
      handlers: [tokenHandler],
    });
    await forceCredentialClientConfig(page);

    await page.goto("/admin?cat=settings&tab=service-accounts", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Service Accounts", exact: true })).toBeVisible();
    await page.getByRole("row", { name: /token-bot/ }).getByRole("button", { name: "Manage" }).click();

    const manageDialog = page.getByRole("dialog", { name: "token-bot" });
    await expect(manageDialog.getByText("Tokens", { exact: true })).toBeVisible();
    await expect(manageDialog.getByText(/No tokens added/)).toBeVisible();
    await expect(manageDialog.getByText("Add a token")).toBeVisible();

    await manageDialog.getByRole("button", { name: "Token provider" }).click();
    await page.getByRole("option", { name: "GitLab" }).click();
    const tokenInput = manageDialog.getByLabel("Access token");
    await expect(tokenInput).toHaveAttribute("autocomplete", "off");
    await expect(tokenInput).toHaveAttribute("data-1p-ignore", "true");
    await expect(tokenInput).toHaveAttribute("data-lpignore", "true");
    await tokenInput.fill("glpat-playwright-secret");

    await manageDialog.getByRole("button", { name: "Add", exact: true }).last().click();
    await expect(manageDialog.getByText("Token already exists")).toBeVisible();
    await expect(tokenInput).toHaveValue("glpat-playwright-secret");

    await tokenInput.press("Enter");
    await expect.poll(() => credentials.length).toBe(1);
    const addRequests = requests.filter(
      (request) => request.method === "POST" && request.path.endsWith("/credentials"),
    );
    expect(addRequests).toHaveLength(2);
    expect(addRequests[0].body).toEqual({
      provider: "gitlab",
      token: "glpat-playwright-secret",
    });
    expect(addRequests[1].body).toEqual({
      provider: "gitlab",
      token: "glpat-playwright-secret",
    });

    await expect(manageDialog.getByText("Token already exists")).toHaveCount(0);
    await expect(tokenInput).toHaveValue("");
    await expect(manageDialog.getByText("GitLab", { exact: true })).toBeVisible();
    await expect(manageDialog.getByText("connected")).toBeVisible();
    await expect(manageDialog.getByText("glpat-playwright-secret")).toHaveCount(0);

    await manageDialog.getByRole("button", { name: "Token provider" }).click();
    await expect(page.getByRole("option", { name: "GitLab" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "GitHub" })).toBeVisible();
    await page.getByRole("option", { name: "GitHub" }).click();

    await manageDialog.getByRole("button", { name: "Remove GitLab credential" }).click();
    await expect(manageDialog.getByText("Remove?")).toBeVisible();
    await manageDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(manageDialog.getByText("GitLab", { exact: true })).toBeVisible();
    await expect.poll(() => credentials.length).toBe(1);

    await manageDialog.getByRole("button", { name: "Remove GitLab credential" }).click();
    await manageDialog.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => credentials.length).toBe(0);
    expect(
      requests.find((request) => request.method === "DELETE" && request.path.endsWith("/credentials"))?.body,
    ).toEqual({ connection_id: "conn-gitlab" });
    await expect(manageDialog.getByText(/No tokens added/)).toBeVisible();

    await manageDialog.getByRole("button", { name: "Token provider" }).click();
    await expect(page.getByRole("option", { name: "GitLab" })).toBeVisible();
    await page.getByRole("option", { name: "GitLab" }).click();
  });

  test("hides the Tokens section when service account token passthrough is disabled", async ({
    page,
  }) => {
    const items: ServiceAccountItem[] = [
      {
        id: "sa-sub-no-tokens",
        name: "no-tokens-bot",
        owning_team_id: "team-sre",
        created_by: "user-admin",
        created_at: "2026-06-15T12:00:00.000Z",
        status: "active",
        scope_counts: { agents: 0, tools: 0 },
      },
    ];

    const disabledTokensHandler: MockRouteHandler = async ({ route, path, method }) => {
      if (path === "/api/auth/my-roles" && method === "GET") {
        await fulfillJson(route, {
          teams: [{ _id: "team-1", slug: "team-sre", name: "SRE Team" }],
        });
        return true;
      }

      if (path === "/api/admin/service-accounts" && method === "GET") {
        await fulfillJson(route, { success: true, data: { items } });
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-no-tokens" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            id: "sa-sub-no-tokens",
            name: "no-tokens-bot",
            owning_team_id: "team-sre",
            created_by: "user-admin",
            created_at: "2026-06-15T12:00:00.000Z",
            status: "active",
            scopes: [],
          },
        });
        return true;
      }

      if (path === "/api/admin/service-accounts/grantable" && method === "GET") {
        await fulfillJson(route, { success: true, data: { agents: [], tools: [] } });
        return true;
      }

      if (path === "/api/admin/service-accounts/token-providers" && method === "GET") {
        await fulfillJson(route, { success: false, code: "CREDENTIALS_DISABLED" }, 404);
        return true;
      }

      if (path === "/api/admin/service-accounts/sa-sub-no-tokens/credentials" && method === "GET") {
        await fulfillJson(route, { success: true, data: [] });
        return true;
      }

      return false;
    };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [disabledTokensHandler],
    });

    await page.goto("/admin?cat=settings&tab=service-accounts", {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("row", { name: /no-tokens-bot/ }).getByRole("button", { name: "Manage" }).click();
    const manageDialog = page.getByRole("dialog", { name: "no-tokens-bot" });
    await expect(manageDialog.getByText("Current scopes")).toBeVisible();
    await expect(manageDialog.getByText("Tokens", { exact: true })).toHaveCount(0);
    await expect(manageDialog.getByText("Add a token", { exact: true })).toHaveCount(0);
    await expect(manageDialog.getByLabel("Access token")).toHaveCount(0);
  });
});
