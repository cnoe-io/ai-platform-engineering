import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const session = {
  email: "admin@example.test",
  name: "Example Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

function health(status: "healthy" | "missing") {
  return {
    health: {
      generatedAt: "2026-08-13T18:00:00.000Z",
      refreshIntervalMs: 300_000,
      summary: {
        projects: 1,
        healthy: status === "healthy" ? 1 : 0,
        attention: status === "healthy" ? 0 : 1,
        missing: status === "missing" ? 1 : 0,
      },
      rows: [
        {
          projectId: "project-id",
          projectSlug: "example-project",
          projectTitle: "Example Project",
          dataSteward: "Example Steward Team",
          dataStewardType: "team",
          credentialOwner: {
            email: "owner@example.test",
            name: "Example Owner",
          },
          provider: "github",
          status,
          lastAttemptAt: "2026-08-13T18:00:00.000Z",
          detail:
            status === "healthy"
              ? "Token is available for scheduled ingestion."
              : "No github connection is configured for this credential owner.",
        },
      ],
    },
  };
}

test.describe("Tome combined health", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("shows team stewardship, the token owner, and refreshes a missing connection", async ({ page }) => {
    let refreshed = false;
    const handler: MockRouteHandler = async ({ route, path, method }) => {
      if (path === "/api/tome/admin") {
        await fulfillJson(route, { isTomeAdmin: true });
        return true;
      }
      if (path === "/api/tome/admin/auto-ingest-credentials") {
        if (method === "POST") refreshed = true;
        await fulfillJson(route, health(refreshed ? "healthy" : "missing"));
        return true;
      }
      return false;
    };
    await installMockedRbacApp(page, {
      isAdmin: true,
      session,
      handlers: [handler],
    });

    await page.goto("/projects/admin?tab=authorization", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("tab", { name: "RBAC Health", selected: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Auto-ingest Tokens" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Auto-ingest credentials" })).toBeVisible();
    await expect(page.getByText("Example Steward Team")).toBeVisible();
    await expect(page.getByText("Example Owner")).toBeVisible();
    await expect(page.getByText("owner@example.test")).toBeVisible();
    await expect(page.getByText("Missing", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Refresh now" }).click();

    await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
    expect(refreshed).toBe(true);
  });
});
