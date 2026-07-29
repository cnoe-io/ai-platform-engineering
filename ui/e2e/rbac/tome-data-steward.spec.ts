import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const SLUG = "example-project";

function tomeHandler(
  canEdit: boolean,
  {
    type = "project",
    canManageSteward = false,
  }: {
    type?: "project" | "area" | "bhag";
    canManageSteward?: boolean;
  } = {},
): MockRouteHandler {
  return async ({ route, path, method, url }) => {
    if (path === "/api/users/me" && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          id: canEdit ? "example-steward-subject" : "example-viewer-subject",
          email: canEdit ? "steward@example.test" : "viewer@example.test",
          name: canEdit ? "Example Steward" : "Example Viewer",
          role: "user",
        },
      });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/pages` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          slug: SLUG,
          tree: [
            {
              path: "charter.md",
              title: "Charter",
              kind: "stable",
              children: [],
            },
          ],
          pages: {
            "charter.md": [
              "---",
              "title: Charter",
              "kind: stable",
              "---",
              "",
              "# Example charter",
            ].join("\n"),
          },
          canEdit,
          canManageSteward,
        },
      });
      return true;
    }
    if (path === `/api/projects/${SLUG}` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: {
          project: {
            _id: "example-project-id",
            type,
            slug: SLUG,
            name: "Example Project",
            title: "Example Project",
            description: "Neutral Tome authorization fixture.",
            status: "active",
            team_id: "example-team-id",
            team_slug: "example-team",
            team_name: "Example Team",
            owner_id: "owner@example.test",
            member_ids: [],
            data_steward: {
              type: "user",
              id: "example-steward-subject",
              name: "Example Steward",
              email: "steward@example.test",
            },
            tags: [],
            sources: { repos: [], confluence_url: "", webex_rooms: [] },
          },
          permissions: {
            can_read: true,
            can_edit: canEdit,
            can_manage_steward: canManageSteward,
          },
          rbac: {
            object: `document:tome/project/${SLUG}`,
            directTeam: {
              slug: "example-team",
              name: "Example Team",
              subject: "team:example-team#member",
              relation: "reader",
            },
            parents: [],
            inheritance:
              "BHAG and Area read access flows downward to linked descendants",
            dataSteward: {
              type: "user",
              name: "Example Steward",
              subject: "user:example-steward-subject",
              relation: "writer",
            },
            tomeAdminOverride: "admin_surface:tome#can_manage",
          },
        },
      });
      return true;
    }
    if (path === "/api/projects" && method === "GET" && url.searchParams.has("type")) {
      await fulfillJson(route, { success: true, data: { projects: [] } });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/edges` && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: { outgoing: [], incoming: [], titles: {} },
      });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/ingests` && method === "GET") {
      await fulfillJson(route, { success: true, data: { runs: [] } });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/preflight` && method === "POST") {
      await fulfillJson(route, { success: true, data: { sources: [] } });
      return true;
    }
    if (path === `/api/tome/projects/${SLUG}/reingest` && method === "POST") {
      await fulfillJson(route, { success: true, data: { runId: "example-run" } }, 202);
      return true;
    }
    return false;
  };
}

test.describe("Tome data-steward controls (mocked)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
    await page.addInitScript(() => {
      window.localStorage.setItem("tome.onboarding.seen", "1");
    });
  });

  test("viewer cannot start ingestion", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [tomeHandler(false)],
    });

    await page.goto(`/projects/${SLUG}/tome/ingest`, { waitUntil: "domcontentloaded" });

    const runButton = page.getByRole("main").getByRole("button", {
      name: "Run ingest",
      exact: true,
    });
    await expect(runButton).toBeDisabled();
    await runButton.locator("..").hover();
    await expect(page.getByText("Project view only access", { exact: true })).toBeVisible();
  });

  test("viewer edit tooltip stays inside the viewport while resizing", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [tomeHandler(false)],
    });
    await page.setViewportSize({ width: 900, height: 720 });
    await page.goto(`/projects/${SLUG}/tome/wiki/charter.md`, {
      waitUntil: "domcontentloaded",
    });

    const editButton = page.getByRole("button", { name: "Edit", exact: true });
    await expect(editButton).toBeDisabled();
    await editButton.locator("..").hover();

    const tooltip = page.getByRole("tooltip").filter({
      hasText: "Project view only access",
    });
    await expect(tooltip).toBeVisible();

    for (const width of [900, 720]) {
      await page.setViewportSize({ width, height: 720 });
      await expect
        .poll(async () => {
          const box = await tooltip.boundingBox();
          return box ? Math.ceil(box.x + box.width) : Number.POSITIVE_INFINITY;
        })
        .toBeLessThanOrEqual(width - 8);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBe(0);
    }
  });

  test("non-admin hub hides BHAG and Area creation controls", async ({ page }) => {
    const hubHandler: MockRouteHandler = async ({ route, path, method, url }) => {
      if (path === "/api/tome/admin" && method === "GET") {
        await fulfillJson(route, { isTomeAdmin: false });
        return true;
      }
      if (path === "/api/tome/preferences/bhag-order" && method === "GET") {
        await fulfillJson(route, { success: true, data: { bhag_order: [] } });
        return true;
      }
      if (path === "/api/projects/onboarding-config" && method === "GET") {
        await fulfillJson(route, { success: true, data: { config: {} } });
        return true;
      }
      if (path === "/api/projects" && method === "GET") {
        if (url.searchParams.has("type")) {
          await fulfillJson(route, { success: true, data: { projects: [] } });
          return true;
        }
        await fulfillJson(route, {
          success: true,
          data: {
            projects: [
              {
                _id: "example-project-id",
                type: "project",
                slug: SLUG,
                name: "Example Project",
                title: "Example Project",
                description: "Neutral Tome authorization fixture.",
                status: "active",
                team_id: "example-team-id",
                team_slug: "example-team",
                team_name: "Example Team",
                owner_id: "owner@example.test",
                member_ids: [],
                labels: {
                  domain: "example",
                  initiatives: ["Example Goal"],
                  areas: ["Example Area"],
                },
                tags: [],
                sources: { repos: [], confluence_url: "", webex_rooms: [] },
                page_count: 0,
                active_ingests: [],
              },
            ],
            active_ingest_count: 0,
          },
        });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [hubHandler],
    });
    await page.goto("/projects", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Example Project", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create BHAG wiki" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create area wiki" })).toHaveCount(0);
  });

  test("data steward can start ingestion", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [tomeHandler(true)],
    });

    await page.goto(`/projects/${SLUG}/tome/ingest`, { waitUntil: "domcontentloaded" });

    const startButton = page.getByRole("button", { name: "Run ingest", exact: true });
    await expect(startButton).toBeEnabled();
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === `/api/tome/projects/${SLUG}/reingest`,
    );
    await startButton.click();
    await request;
  });

  test("non-admin data steward cannot delete a BHAG", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [tomeHandler(true, { type: "bhag" })],
    });

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "BHAG settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Danger zone" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete BHAG" })).toHaveCount(0);
  });

  test("Tome admin can delete a BHAG", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "admin@example.test", name: "Example Admin" },
      handlers: [
        tomeHandler(true, {
          type: "bhag",
          canManageSteward: true,
        }),
      ],
    });

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });

    const dangerZone = page.getByRole("button", { name: "Danger zone" });
    await expect(dangerZone).toBeVisible();
    await dangerZone.click();
    await expect(page.getByRole("button", { name: "Delete BHAG" })).toBeDisabled();
  });

  test("settings labels the direct viewing team accurately", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "steward@example.test", name: "Example Steward" },
      handlers: [tomeHandler(true)],
    });

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });

    const sharedWithBadge = page.getByText("Shared with: Example Team", { exact: true });
    await expect(sharedWithBadge).toBeVisible();
    await sharedWithBadge.hover();
    await expect(
      page.getByRole("tooltip").filter({
        hasText: "Members of this team have direct view access.",
      }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Organization" }).click();
    const organizationPanel = page.getByRole("tabpanel", { name: "Organization" });
    await expect(
      organizationPanel.getByText("Shared directly with", { exact: true }),
    ).toBeVisible();
    await expect(
      organizationPanel.getByText(
        "Members of this team have direct view access. Access can also be inherited through the BHAG and Area hierarchy.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Shared directly with team")).toBeVisible();
    await expect(page.getByText("Owning team", { exact: true })).toHaveCount(0);
  });

  test("settings explains the effective OpenFGA grants", async ({ page }) => {
    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [tomeHandler(false)],
    });

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Read only.", { exact: false })).toBeVisible();
    const saveButton = page.getByRole("button", { name: "Save changes" });
    await expect(saveButton).toBeDisabled();
    await saveButton.locator("..").hover();
    await expect(page.getByText("Project view only access", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access & RBAC" })).not.toBeVisible();
    const accessPolicyButton = page.getByRole("button", {
      name: "View access policy",
    });
    await accessPolicyButton.hover();
    const viewerTooltip = page.getByRole("tooltip").filter({
      hasText: "View access policy",
    });
    await expect(viewerTooltip).toBeVisible();
    await expect(viewerTooltip).not.toContainText("Admin note");
    await accessPolicyButton.click();
    await expect(page.getByRole("heading", { name: "Access & RBAC" })).toBeVisible();
    await expect(page.getByText("Direct read", { exact: true })).toBeVisible();
    await expect(page.getByText("Example Team members", { exact: true })).toBeVisible();
    await expect(page.getByText("Write", { exact: true })).toBeVisible();
    await expect(page.getByText("Example Steward (user)", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`document:tome/project/${SLUG}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("team:example-team#member reader", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("All Tome administrators")).toBeVisible();
  });

  test("settings access tooltip gives Tome admins model recovery guidance", async ({
    page,
  }) => {
    let repairRequests = 0;
    const modelRepairHandler: MockRouteHandler = async ({ route, path, method }) => {
      if (path !== "/api/tome/admin/openfga-model") return false;
      if (method === "GET") {
        await fulfillJson(route, {
          healthy: false,
          activeModelId: "model-stale",
        });
        return true;
      }
      if (method === "POST") {
        repairRequests += 1;
        await fulfillJson(route, {
          healthy: true,
          activeModelId: "model-repaired",
          changed: true,
        });
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "admin@example.test", name: "Example Admin" },
      handlers: [
        modelRepairHandler,
        tomeHandler(true, {
          canManageSteward: true,
        }),
      ],
    });

    await page.goto(`/projects/${SLUG}/tome/settings`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: "View access policy" }).hover();
    const tooltip = page.getByRole("tooltip").filter({
      hasText: "If inherited BHAG or Area access is missing",
    });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(
      "Open this panel to check and repair it.",
    );

    await page.getByRole("button", { name: "View access policy" }).click();
    await expect(
      page.getByText("The model is missing document parent inheritance.", {
        exact: false,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Repair model" }).click();
    await expect(
      page.getByText(
        "Model repaired. Save this project again to restore any parent link that previously failed.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(repairRequests).toBe(1);
  });

  test("unshared entities are hidden from the hub and denied by direct URL/API", async ({
    page,
  }) => {
    const hiddenSlug = "hidden-project";
    const visibilityHandler: MockRouteHandler = async ({
      route,
      path,
      method,
      url,
    }) => {
      if (path === "/api/projects" && method === "GET" && !url.searchParams.has("type")) {
        await fulfillJson(route, {
          success: true,
          data: {
            projects: [
              {
                _id: "visible-id",
                type: "project",
                slug: "visible-project",
                name: "Visible Project",
                title: "Visible Project",
                description: "",
                status: "active",
                team_name: "Visible Team",
                tags: [],
                labels: {},
                page_count: 0,
                active_ingests: [],
              },
            ],
            active_ingest_count: 0,
          },
        });
        return true;
      }
      if (path === "/api/projects/facets" && method === "GET") {
        await fulfillJson(route, {
          success: true,
          data: {
            facets: { domains: [], initiatives: [], areas: [], tags: [] },
          },
        });
        return true;
      }
      if (
        (path === `/api/projects/${hiddenSlug}` ||
          path.startsWith(`/api/tome/projects/${hiddenSlug}/`)) &&
        method === "GET"
      ) {
        await fulfillJson(
          route,
          {
            success: false,
            error: "This Tome entity is not shared with one of your teams",
            code: "TOME_READ_REQUIRED",
          },
          403,
        );
        return true;
      }
      return false;
    };

    await installMockedRbacApp(page, {
      session: { email: "viewer@example.test", name: "Example Viewer" },
      handlers: [visibilityHandler],
    });

    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Visible Project", { exact: true })).toBeVisible();
    await expect(page.getByText("Hidden Project", { exact: true })).toHaveCount(0);

    const apiStatus = await page.evaluate(async (slug) => {
      const response = await fetch(`/api/projects/${slug}`);
      return response.status;
    }, hiddenSlug);
    expect(apiStatus).toBe(403);

    await page.goto(`/projects/${hiddenSlug}/tome`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("load failed (403)", { exact: true })).toBeVisible();
  });
});
