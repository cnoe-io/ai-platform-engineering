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
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveClass(/bg-primary/);
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Default Agent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage Unlinked Access" })).toBeVisible();
  });

  test("does not expose the removed Knowledge Bases settings tab", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=rag-access", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=settings$/);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveClass(/bg-primary/);
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Knowledge Bases" })).toHaveCount(0);
    await expect(page.getByText("RAG Team Access")).toHaveCount(0);
  });

  test("explains Unlinked Access on the settings card and modal", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText(/Set the starting access for people who message/)).toBeVisible();
    await expect(page.getByText(/before they have signed in to the web UI/)).toBeVisible();
    await expect(
      page.getByText(/available to every unlinked caller and bot/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Manage Unlinked Access" }).click();

    const dialog = page.getByRole("dialog", { name: "Unlinked Access" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Set the starting access for people who message/),
    ).toBeVisible();
    await expect(dialog.getByText(/available to every unlinked caller and bot/)).toBeVisible();
  });
});
