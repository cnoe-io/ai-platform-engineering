// assisted-by claude code claude-sonnet-4-6
/**
 * Regression: non-admin users must see their team's projects via GET /api/projects.
 *
 * Before the fix, getUserTeamIds() queried the retired teams.members[] array
 * (emptied by the 2026-05-26 canonical-team-membership refactor). Non-admins
 * always got teamIds=[] → empty project list regardless of team membership.
 * The fix makes getUserTeamIds() read from team_membership_sources (canonical).
 */

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const NON_ADMIN_SESSION = {
  email: "julvalen@cisco.com",
  name: "Julia Valenti",
  role: "user" as const,
  canViewAdmin: false,
};

const ADMIN_SESSION = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

const FIXTURE_PROJECTS = [
  {
    _id: "proj-1",
    slug: "mycelium",
    name: "Mycelium",
    title: "Mycelium",
    description: "Coordination layer for multi-agent systems.",
    status: "draft",
    team_id: "team-backstage-access",
    team_slug: "backstage-access",
    team_name: "backstage-access",
    owner_id: "julvalen@cisco.com",
    member_ids: [],
    domain: "default",
    labels: { initiatives: [], swimlanes: [], domain: "default" },
    tags: ["caipe"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    _id: "proj-2",
    slug: "caipe",
    name: "CAIPE",
    title: "CAIPE",
    description: "Community AI Platform Engineering.",
    status: "draft",
    team_id: "team-backstage-access",
    team_slug: "backstage-access",
    team_name: "backstage-access",
    owner_id: "julvalen@cisco.com",
    member_ids: [],
    domain: "default",
    labels: { initiatives: [], swimlanes: [], domain: "default" },
    tags: ["caipe"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

function makeProjectsHandler(projects: typeof FIXTURE_PROJECTS): MockRouteHandler {
  return async ({ route, path, method }) => {
    if (path === "/api/projects" && method === "GET") {
      await fulfillJson(route, { success: true, data: { projects } });
      return true;
    }
    return false;
  };
}

test.describe("projects membership regression (mocked)", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("non-admin user with team membership sees their projects", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: false,
      session: NON_ADMIN_SESSION,
      handlers: [makeProjectsHandler(FIXTURE_PROJECTS)],
    });

    await page.goto("/projects", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Your projects")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Mycelium")).toBeVisible();
    await expect(page.getByText("CAIPE")).toBeVisible();
    await expect(page.getByText("No projects yet")).not.toBeVisible();
  });

  test("non-admin user with no team membership sees empty state", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: false,
      session: NON_ADMIN_SESSION,
      handlers: [makeProjectsHandler([])],
    });

    await page.goto("/projects", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Your projects")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  test("admin user sees all projects", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: ADMIN_SESSION,
      handlers: [makeProjectsHandler(FIXTURE_PROJECTS)],
    });

    await page.goto("/projects", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Your projects")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Mycelium")).toBeVisible();
    await expect(page.getByText("CAIPE")).toBeVisible();
  });
});
