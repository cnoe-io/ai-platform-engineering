// assisted-by Codex Codex-sonnet-4-6

import { expect, test } from "@playwright/test";

import { installMockedRbacApp, mockedRbacEnabled } from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

test.describe("mocked admin settings browser regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("defaults bare admin route to Settings General", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=settings$/);
    await expect(page.getByRole("button", { name: "Settings" })).toHaveClass(/bg-primary/);
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Default Agent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage Unlinked Access" })).toBeVisible();
  });

  test("explains Unlinked Access on the settings card and modal", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Grant agents and tools to unlinked users")).toBeVisible();
    await expect(page.getByText(/messaged via Slack or Webex but never signed in/)).toBeVisible();
    await expect(
      page.getByText(/base access every unlinked Slack\/Webex caller and bot/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Manage Unlinked Access" }).click();

    const dialog = page.getByRole("dialog", { name: "Unlinked Access" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Grant agents and tools to unlinked users")).toBeVisible();
    await expect(
      dialog.getByText(/Any platform admin can add agents or tools they own/),
    ).toBeVisible();
  });
});
