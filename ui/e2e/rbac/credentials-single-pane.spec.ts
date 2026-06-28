// assisted-by claude code claude-sonnet-4-6
import { expect, test } from "@playwright/test";

import {
  DEFAULT_OAUTH_CONNECTOR,
  CREDENTIALS_ADMIN_SESSION,
  gotoPersonalCredentialsSecrets,
  installCredentialsBrowserMocks,
} from "./_credentials-browser-fixtures";
import { dismissReleaseUpgradeDialog, installTestSession } from "./_helpers";
import { mockedRbacEnabled } from "./_mocked-rbac";

function minimalSessionEnv() {
  return {
    baseUrl: process.env.CAIPE_UI_BASE_URL ?? "http://localhost:3000",
    keycloakUrl: process.env.KEYCLOAK_URL ?? "http://localhost:7080",
    keycloakRealm: process.env.KEYCLOAK_REALM ?? "caipe",
    user: { email: CREDENTIALS_ADMIN_SESSION.email, password: "" },
  };
}

async function assertCredentialsPageAvailable(
  page: import("@playwright/test").Page,
): Promise<void> {
  await gotoPersonalCredentialsSecrets(page);
  await dismissReleaseUpgradeDialog(page);
  try {
    await expect(page.getByRole("heading", { name: "Credentials" })).toBeVisible({
      timeout: 10_000,
    });
  } catch {
    test.skip(
      true,
      "Personal /credentials requires SSR session and org FGA (run with full dev stack or RUN_RBAC_E2E).",
    );
  }
}

test.describe("credentials single-pane layout", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked credentials browser regression.",
    );
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!process.env.NEXTAUTH_SECRET, "NEXTAUTH_SECRET required for personal /credentials SSR.");
    await installCredentialsBrowserMocks(page, { providerConnections: [] });
    await installTestSession(page, minimalSessionEnv(), {
      email: CREDENTIALS_ADMIN_SESSION.email,
      subject: process.env.RBAC_USER_SUB?.trim() || "playwright-admin-sub",
      role: "admin",
    });
  });

  test("renders both sections on a single page without tabs", async ({ page }) => {
    await assertCredentialsPageAvailable(page);

    await expect(page.getByRole("heading", { name: "Saved Secrets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connected Apps" })).toBeVisible();
    expect(await page.getByRole("tab").count()).toBe(0);
  });

  test("shows consistent empty states for both sections", async ({ page }) => {
    await assertCredentialsPageAvailable(page);

    // Both empty states must be visible simultaneously — no tab click required
    await expect(page.getByText("No secrets yet.")).toBeVisible();
    await expect(page.getByText("No apps connected yet.")).toBeVisible();
  });

  test("stays on the same page URL after adding a secret", async ({ page }) => {
    await assertCredentialsPageAvailable(page);
    const urlBefore = page.url();

    await page.getByRole("button", { name: /add secret/i }).click();
    const dialog = page.getByRole("dialog", { name: /add secret/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Test token");
    await dialog.locator("#new-secret-value").fill("test-value-123");
    await dialog.getByRole("button", { name: /save secret/i }).click();
    await expect(dialog).toHaveCount(0);

    expect(page.url()).toBe(urlBefore);
    await expect(page.getByRole("heading", { name: "Connected Apps" })).toBeVisible();
  });

  test("returns OAuth relinks to the connected apps section without tab navigation", async ({
    context,
    page,
  }) => {
    await installCredentialsBrowserMocks(page, {
      providerConnections: [
        {
          id: "new-atlassian-connection",
          connectorId: DEFAULT_OAUTH_CONNECTOR.id,
          provider: "atlassian",
          status: "connected",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          updatedAt: "2026-06-21T04:44:00.000Z",
          grantedScopes: ["offline_access", "read:me", "read:jira-work"],
        },
      ],
    });
    await assertCredentialsPageAvailable(page);

    await context.route("**/oauth-callback-relay", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html>
<html><body><script>
  const message = { type: "caipe.oauth.connection", status: "success", provider: "atlassian" };
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("caipe.oauth.connection");
    channel.postMessage(message);
    channel.close();
  }
  window.opener?.postMessage(message, window.location.origin);
</script></body></html>`,
      });
    });

    const relayPagePromise = context.waitForEvent("page");
    await page.evaluate(() => {
      window.open("/oauth-callback-relay", "_blank");
    });
    const relayPage = await relayPagePromise;
    await relayPage.waitForLoadState("domcontentloaded");
    await relayPage.close().catch(() => undefined);

    // URL must not get a ?tab= suffix — single-pane layout uses no tab routing
    await expect(page).toHaveURL(/\/credentials$/);
    // Both sections still visible
    await expect(page.getByRole("heading", { name: "Saved Secrets" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connected Apps" })).toBeVisible();
    await expect(page.getByText("Atlassian Cloud")).toBeVisible();
  });
});
