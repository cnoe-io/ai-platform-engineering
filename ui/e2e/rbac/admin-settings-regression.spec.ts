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

  test("defaults bare admin route to Settings Agents without proxy tabs", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=agents$/);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "Agents" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Default Agent" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "General" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "AI Review" })).toHaveCount(0);
    await expect(page.getByText("Platform settings moved")).toHaveCount(0);
  });

  test("does not expose the removed Knowledge Bases settings tab", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=rag-access", {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL(/\/admin\?cat=settings&tab=agents$/);
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("tab", { name: "Agents" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Knowledge Bases" })).toHaveCount(0);
    await expect(page.getByText("RAG Team Access")).toHaveCount(0);
  });

});
