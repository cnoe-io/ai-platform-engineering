import { expect,test } from "@playwright/test";

import {
  DEFAULT_ADMIN_GATES,
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "admin@example.com",
  name: "Example Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

test.describe("mocked Admin workspace browser regression",() => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("opens bare Admin at the canonical Users destination",async ({ page }) => {
    await installMockedRbacApp(page,{
      isAdmin: true,
      session: adminSession,
    });

    await page.goto("/admin",{ waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/admin\/people\/users$/);
    await expect(page.getByRole("heading",{ level: 1,name: "Users" })).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link",{ name: "Admin",exact: true }),
    ).toHaveAttribute(
      "aria-current",
      "page",
    );
    const breadcrumb = page.getByRole("navigation",{ name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link",{ name: "Home" })).toHaveAttribute("href","/");
    await expect(breadcrumb.getByRole("link",{ name: "Admin" })).toHaveAttribute(
      "href",
      "/admin/people/users",
    );
    await expect(
      breadcrumb.getByRole("link",{ name: "Teams & Users",exact: true }),
    ).toHaveAttribute(
      "href",
      "/admin/people/users",
    );
    await expect(breadcrumb.getByRole("link",{ name: "Users",exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByText("Review people, roles, memberships, and resource access."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation",{ name: "Admin sections" })
        .getByRole("link",{ name: "Users",exact: true }),
    ).toHaveAttribute("aria-current","page");
  });

  test("discloses any category without navigating to an unwanted destination",async ({ page }) => {
    await installMockedRbacApp(page,{
      gates: {
        ...DEFAULT_ADMIN_GATES,
        feedback: true,
        slack: true,
        stats: true,
        webex: true,
      },
      isAdmin: true,
      session: adminSession,
    });
    await page.goto("/admin/people/users",{ waitUntil: "domcontentloaded" });

    const navigation = page.getByRole("navigation",{ name: "Admin sections" });
    for (const category of [
      "Teams & Users",
      "Resources",
      "Integrations",
      "Insights",
      "Metrics & Health",
      "Security & Policy",
    ]) {
      await expect(navigation.getByRole("button",{ name: category,exact: true })).toBeVisible();
    }

    const resources = navigation.getByRole("button",{ name: "Resources",exact: true });
    await resources.click();

    await expect(resources).toHaveAttribute("aria-expanded","true");
    await expect(
      navigation.getByRole("button",{ name: "Teams & Users",exact: true }),
    ).toHaveAttribute("aria-expanded","true");
    await expect(navigation.getByRole("link",{ name: "Agent configuration" })).toBeVisible();
    await expect(navigation.getByRole("link",{ name: "Skill Hubs" })).toBeVisible();
    await expect(navigation.getByRole("link",{ name: "Users",exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/people\/users$/);
    await expect(page.getByRole("heading",{ level: 1,name: "Users" })).toBeVisible();

    await page.getByRole("button",{ name: "Collapse sidebar",exact: true }).click();
    await expect(page.getByRole("button",{ name: "Expand sidebar",exact: true })).toBeVisible();
    await resources.hover();
    await expect(resources).toHaveAttribute("aria-expanded","true");
    await expect(page.getByRole("link",{ name: "Agent configuration" })).toBeVisible();
    await expect(page.getByRole("button",{ name: "Expand sidebar",exact: true })).toBeVisible();
  });

  test("preserves destination context through disclosure navigation, back, and reload",async ({ page }) => {
    await installMockedRbacApp(page,{
      isAdmin: true,
      session: adminSession,
    });
    await page.goto("/admin/people/users",{ waitUntil: "domcontentloaded" });

    const navigation = page.getByRole("navigation",{ name: "Admin sections" });
    await navigation.getByRole("button",{ name: "Resources",exact: true }).click();
    await navigation.getByRole("link",{ name: "Agent configuration" }).click();

    await expect(page).toHaveURL(/\/admin\/platform\/agents$/);
    await expect(page.getByRole("heading",{ level: 1,name: "Agent configuration" })).toBeVisible();

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/people\/users$/);
    await expect(
      page
        .getByRole("navigation",{ name: "Admin sections" })
        .getByRole("link",{ name: "Users",exact: true }),
    ).toHaveAttribute("aria-current","page");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading",{ level: 1,name: "Users" })).toBeVisible();
  });

  test("uses a navigation drawer when the Admin rail would crowd content",async ({ page }) => {
    await page.setViewportSize({ height: 768,width: 1024 });
    await installMockedRbacApp(page,{
      isAdmin: true,
      session: adminSession,
    });
    await page.goto("/admin/people/users",{ waitUntil: "domcontentloaded" });

    const drawerTrigger = page.getByRole("button",{ name: "Admin sections",exact: true });
    await expect(drawerTrigger).toBeVisible();
    await drawerTrigger.click();

    const drawer = page.getByRole("dialog",{ name: "Admin sections" });
    await expect(drawer).toBeVisible();
    const navigation = drawer.getByRole("navigation",{ name: "Admin sections" });
    await navigation.getByRole("button",{ name: "Metrics & Health",exact: true }).click();
    await navigation.getByRole("link",{ name: "Health",exact: true }).click();

    await expect(page).toHaveURL(/\/admin\/operations\/health$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading",{ level: 1,name: "Health" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("preserves View as context and keeps resource controls read-only",async ({ page }) => {
    const simulationHandler: MockRouteHandler = async ({ method,path,route }) => {
      if (path === "/api/rbac/admin-tab-gates" && method === "GET") {
        await fulfillJson(route,{
          gates: {
            ...DEFAULT_ADMIN_GATES,
            credentials: true,
            feedback: true,
            stats: true,
          },
          integration_panel_modes: { slack: "full",webex: "full" },
          simulation: {
            active: true,
            readonly: true,
            subject: {
              display_name: "Target Admin",
              id: "target-admin",
              openfga_user: "user:target-admin",
              organization_admin: true,
              type: "user",
            },
          },
        });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page,{
      handlers: [simulationHandler],
      isAdmin: true,
      session: adminSession,
    });
    await page.goto(
      "/admin/platform/agents?simulate_type=user&simulate_id=target-admin",
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByRole("button",{ name: /viewing as target admin/i })).toBeVisible();
    await expect(page.getByTestId("import-agents-from-config-button")).toBeDisabled();

    const navigation = page.getByRole("navigation",{ name: "Admin sections" });
    await navigation.getByRole("button",{ name: "Teams & Users" }).click();
    await expect(navigation.getByRole("link",{ name: "Users",exact: true })).toHaveAttribute(
      "href",
      /simulate_type=user&simulate_id=target-admin/,
    );
  });
});
