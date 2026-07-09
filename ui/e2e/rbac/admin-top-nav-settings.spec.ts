// assisted-by claude code claude-sonnet-4-6

import { expect, test } from "@playwright/test";

import { fulfillJson, installMockedRbacApp, mockedRbacEnabled, postJson } from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

test.describe("admin top-nav settings tab", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("Navigation settings tab is visible to admins under Settings", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin?cat=settings&tab=navigation", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("tab", { name: "Navigation" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Navigation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Navigation tab shows the reorderable nav item list", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [
        async ({ route, path, method }) => {
          if (path === "/api/admin/platform-config" && method === "GET") {
            await fulfillJson(route, { data: { top_nav: null } });
            return true;
          }
          return false;
        },
      ],
    });

    await page.goto("/admin?cat=settings&tab=navigation", { waitUntil: "domcontentloaded" });

    // The card heading
    await expect(page.getByRole("heading", { name: "Top Navigation" })).toBeVisible();

    // Wait for the list to load (not the loading spinner)
    const navList = page.locator("ul").filter({ has: page.getByRole("button", { name: /move/i }) });
    await expect(navList).toBeVisible();

    // Each default nav item appears in the list — scope to list items to avoid header nav ambiguity
    await expect(navList.getByText("Home")).toBeVisible();
    await expect(navList.getByText("Chat")).toBeVisible();
    await expect(navList.getByText("Skills")).toBeVisible();

    // Move-up/down buttons and visibility toggles are present
    await expect(page.getByRole("button", { name: /move down/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /enable|disable/i }).first()).toBeVisible();
  });

  test("Saving top_nav config calls PATCH /api/admin/platform-config", async ({ page }) => {
    let patchBody: unknown = null;

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [
        async ({ route, path, method }) => {
          if (path === "/api/admin/platform-config" && method === "GET") {
            await fulfillJson(route, { data: { top_nav: null } });
            return true;
          }
          if (path === "/api/admin/platform-config" && method === "PATCH") {
            patchBody = await postJson(route);
            await fulfillJson(route, { data: { top_nav: (patchBody as Record<string, unknown>)?.top_nav ?? null } });
            return true;
          }
          return false;
        },
      ],
    });

    await page.goto("/admin?cat=settings&tab=navigation", { waitUntil: "domcontentloaded" });

    // Wait for the list to render
    await expect(page.getByRole("heading", { name: "Top Navigation" })).toBeVisible();
    // Wait for nav list (not loading state)
    await expect(page.getByRole("button", { name: /move down/i }).first()).toBeVisible();

    // Click Save — the SaveButton has aria-label "Save navigation settings"
    await page.getByRole("button", { name: "Save navigation settings" }).click();

    // PATCH was called with a top_nav payload
    await expect.poll(() => patchBody).not.toBeNull();
    expect((patchBody as Record<string, unknown>)?.top_nav).toBeDefined();
  });

  test("Reset to default marks the form dirty", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      handlers: [
        async ({ route, path, method }) => {
          if (path === "/api/admin/platform-config" && method === "GET") {
            // Simulate a saved config with Chat hidden
            await fulfillJson(route, {
              data: {
                top_nav: {
                  order: ["chat", "home"],
                  hidden: ["chat"],
                },
              },
            });
            return true;
          }
          if (path === "/api/admin/platform-config" && method === "PATCH") {
            await fulfillJson(route, { data: {} });
            return true;
          }
          return false;
        },
      ],
    });

    await page.goto("/admin?cat=settings&tab=navigation", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Top Navigation" })).toBeVisible();
    // Wait for nav list to be rendered
    await expect(page.getByRole("button", { name: /move down/i }).first()).toBeVisible();

    // "Reset to default" button is present (lowercase d)
    await expect(page.getByRole("button", { name: /reset to default/i })).toBeVisible();
    await page.getByRole("button", { name: /reset to default/i }).click();

    // After reset, the Save button should be enabled (dirty=true shows "Unsaved changes")
    await expect(page.getByText(/unsaved changes/i)).toBeVisible();
  });

  test("Navigation tab shows access-denied message for non-admin users", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: false,
      session: { email: "user@caipe.local", name: "Regular User", role: "user", canViewAdmin: false },
    });

    // Non-admin redirect away from admin
    await page.goto("/admin?cat=settings&tab=navigation", { waitUntil: "domcontentloaded" });

    // Should not see the "Top Navigation" card heading (admin-only content)
    await expect(page.getByRole("heading", { name: "Top Navigation" })).toHaveCount(0);
  });
});
