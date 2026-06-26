// assisted-by claude code claude-sonnet-4-6
/**
 * Regression: non-admin users must see conversations shared with their team.
 *
 * Before the fix, getUserTeamIds() queried the retired teams.members[] array
 * (emptied by the canonical-team-membership refactor). Non-admins always got
 * teamIds=[] → team-shared conversations were invisible regardless of
 * team membership. The fix makes getUserTeamIds() read from
 * team_membership_sources (canonical).
 *
 * These are mocked browser tests — they verify the UI renders correctly
 * when the BFF returns the right data. Set RUN_RBAC_REGRESSION=1 to run.
 */

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const NON_ADMIN_SESSION = {
  email: "member@caipe.local",
  name: "Team Member",
  role: "user" as const,
  canViewAdmin: false,
};

const ADMIN_SESSION = {
  email: "admin@caipe.local",
  name: "Platform Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

const now = new Date().toISOString();

const TEAM_SHARED_CONVERSATION = {
  _id: "conv-team-1",
  title: "Architecture Review",
  owner_id: "other@caipe.local",
  owner_subject: "other-subject",
  participants: [],
  sharing: {
    is_public: false,
    shared_with: [],
    shared_with_teams: ["team-platform"],
    team_permissions: { "team-platform": "comment" },
    share_link_enabled: false,
  },
  tags: [],
  is_archived: false,
  is_pinned: false,
  deleted_at: null,
  created_at: now,
  updated_at: now,
  metadata: { total_messages: 3 },
};

function makePaginated(items: unknown[]) {
  return { success: true, data: { items, total: items.length, page: 1, page_size: 20, has_more: false } };
}

function makeConversationsHandler(owned: unknown[], shared: unknown[]): MockRouteHandler {
  return async ({ route, path, method }) => {
    if (path === "/api/chat/conversations" && method === "GET") {
      await fulfillJson(route, makePaginated(owned));
      return true;
    }
    if (path === "/api/chat/shared" && method === "GET") {
      await fulfillJson(route, makePaginated(shared));
      return true;
    }
    if (path === "/api/users/me/stats" && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: { total_conversations: 0, total_messages: 0, favorite_agents: [] },
      });
      return true;
    }
    return false;
  };
}

test.describe("team membership regression — shared conversations (mocked)", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("non-admin with team membership sees team-shared conversations", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: false,
      session: NON_ADMIN_SESSION,
      handlers: [makeConversationsHandler([], [TEAM_SHARED_CONVERSATION])],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Shared Conversations")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("shared-tab-team").click();
    await expect(page.getByText("Architecture Review")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("No team-shared conversations yet.")).not.toBeVisible();
  });

  test("non-admin with no team membership sees empty team tab", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: false,
      session: NON_ADMIN_SESSION,
      handlers: [makeConversationsHandler([], [])],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Shared Conversations")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("shared-tab-team").click();
    await expect(page.getByText("No team-shared conversations yet.")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Architecture Review")).not.toBeVisible();
  });

  test("admin user sees team-shared conversations", async ({ page }) => {
    await installMockedRbacApp(page, {
      isAdmin: true,
      session: ADMIN_SESSION,
      handlers: [makeConversationsHandler([], [TEAM_SHARED_CONVERSATION])],
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Shared Conversations")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("shared-tab-team").click();
    await expect(page.getByText("Architecture Review")).toBeVisible({ timeout: 5_000 });
  });
});
