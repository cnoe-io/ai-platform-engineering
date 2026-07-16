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
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Default Agent" })).toHaveCount(0);
    await expect(page.getByText("Platform settings moved")).toBeVisible();
    await expect(page.getByRole("link", { name: /Platform defaults/ })).toHaveAttribute(
      "href",
      "/settings/platform/defaults",
    );
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
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Knowledge Bases" })).toHaveCount(0);
    await expect(page.getByText("RAG Team Access")).toHaveCount(0);
  });

  test("routes Unlinked Access through the canonical platform settings page", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=settings", {
      waitUntil: "domcontentloaded",
    });

    const accessLink = page.getByRole("link", { name: /Access before sign-in/ });
    await expect(accessLink).toHaveAttribute("href", "/settings/platform/access");
    await accessLink.click();

    await expect(page).toHaveURL(/\/settings\/platform\/access$/);
    await expect(page.getByRole("heading", { level: 2, name: "Access before sign-in" })).toBeVisible();
    await expect(page.getByText(/before linking their identity/)).toBeVisible();
    await expect(page.getByText(/available to every unlinked caller and bot/)).toBeVisible();

    await page.getByRole("button", { name: "Review unlinked access" }).click();

    const dialog = page.getByRole("dialog", { name: "Unlinked Access" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Set the starting access for people who message/),
    ).toBeVisible();
    await expect(dialog.getByText(/available to every unlinked caller and bot/)).toBeVisible();
  });
});
