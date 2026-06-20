// assisted-by Codex Codex-sonnet-4-6

import { expect, test, type Route } from "@playwright/test";

import { rbacEnvOrSkip } from "./_env";
import { signIn } from "./_helpers";

type PendingShare = {
  route: Route;
  teamId: string;
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("RBAC e2e — credential team sharing", () => {
  test("keeps out-of-order share responses from dropping earlier team access", async ({ page }) => {
    const env = rbacEnvOrSkip();
    const pendingShares: PendingShare[] = [];

    await page.route("**/api/admin/teams", async (route) => {
      await fulfillJson(route, {
        success: true,
        data: {
          teams: [
            { _id: "team-1", slug: "platform-team", name: "Platform Team" },
            { _id: "team-2", slug: "observability-team", name: "Observability Team" },
            { _id: "team-3", slug: "security-team", name: "Security Team" },
          ],
        },
      });
    });

    await page.route("**/api/credentials/secrets**", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const method = request.method();

      if (requestUrl.pathname === "/api/credentials/secrets" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: [
            {
              id: "secret-race",
              name: "GitHub token",
              type: "bearer_token",
              maskedPreview: "ghp_...abcd",
              sharedWithTeams: ["platform-team"],
            },
          ],
        });
        return;
      }

      if (requestUrl.pathname === "/api/credentials/secrets/secret-race" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { action?: string; teamId?: string };
        if (payload.action === "share" && payload.teamId) {
          pendingShares.push({ route, teamId: payload.teamId });
          return;
        }
      }

      await route.continue();
    });

    await signIn(page, env);
    await page.goto("/credentials?tab=secrets");

    await expect(page.getByRole("heading", { name: "My Secrets" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /share github token/i }).click();

    const dialog = page.getByRole("dialog", { name: /share github token/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Shared with platform-team")).toBeVisible();

    await dialog.getByLabel(/team/i).selectOption("observability-team");
    await dialog.getByRole("button", { name: /^share$/i }).click();
    await expect.poll(() => pendingShares.map((share) => share.teamId)).toContain(
      "observability-team",
    );

    await dialog.getByLabel(/team/i).selectOption("security-team");
    await dialog.getByRole("button", { name: /^share$/i }).click();
    await expect.poll(() => pendingShares.map((share) => share.teamId).sort()).toEqual([
      "observability-team",
      "security-team",
    ]);

    const securityShare = pendingShares.find((share) => share.teamId === "security-team");
    if (!securityShare) {
      throw new Error("security-team share request was not captured");
    }
    await fulfillJson(securityShare.route, { success: true, data: { ok: true } });
    await expect(dialog.getByText("Shared with security-team")).toBeVisible();

    const observabilityShare = pendingShares.find((share) => share.teamId === "observability-team");
    if (!observabilityShare) {
      throw new Error("observability-team share request was not captured");
    }
    await fulfillJson(observabilityShare.route, { success: true, data: { ok: true } });
    await expect(dialog.getByText("Shared with observability-team")).toBeVisible();
    await expect(dialog.getByText("Shared with security-team")).toBeVisible();
  });
});
