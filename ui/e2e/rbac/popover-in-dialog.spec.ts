// assisted-by Claude claude-opus-4-8

/**
 * Mocked Playwright regression for custom Popover dropdowns rendered inside a
 * Radix Dialog. Guards the fix in PR #2048 (popover.tsx / dialog.tsx).
 *
 * The custom Popover portals its content and positions it with `position:
 * fixed`. When rendered inside a Radix Dialog two bugs used to appear:
 *   1. Focus/scroll trap — the dialog's FocusScope/DismissableLayer swallowed
 *      scroll and keystrokes because the popover portalled to document.body,
 *      outside the dialog's DOM subtree (could not search or scroll the list).
 *   2. Positioning — the dialog's centering transform became the containing
 *      block for the fixed popover, mispositioning it.
 *
 * The fix makes PopoverContent portal INTO the dialog (via
 * PortalContainerContext) and re-frames its coordinates. These tests assert the
 * user-visible consequences: the dropdown opens within the dialog, can be
 * searched and scrolled, and a row can be selected — using the Slack channel
 * routing modal's Dynamic Agent picker as the vehicle.
 */

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "sraradhy@cisco.com",
  name: "Sri Aradhyula",
  role: "admin" as const,
  canViewAdmin: true,
};

// Enough agents that the listbox (max-height 260px) must scroll — a short list
// would not exercise the scroll path the focus-trap bug used to break.
const manyAgents = Array.from({ length: 24 }, (_, i) => ({
  _id: `agent-${String(i).padStart(2, "0")}`,
  name: `Agent ${String(i).padStart(2, "0")}`,
}));

function slackHandler(routeWrites: unknown[], routesRef: { routes: unknown[] }): MockRouteHandler {
  return async ({ route, path, method }) => {
    if (path === "/api/admin/platform-config") {
      await fulfillJson(route, { data: { release_notes: { enabled: false } } });
      return true;
    }

    if (path === "/api/admin/slack/channels" && method === "GET") {
      await fulfillJson(route, {
        data: {
          channels: [
            {
              workspace_id: "T123456789",
              channel_id: "C123456789",
              channel_name: "incidents",
              team_slug: "platform-engineering",
              active_grants: 1,
              can_manage: true,
            },
          ],
        },
      });
      return true;
    }

    if (path === "/api/dynamic-agents" && method === "GET") {
      await fulfillJson(route, { data: { items: manyAgents } });
      return true;
    }

    if (path === "/api/admin/teams" && method === "GET") {
      await fulfillJson(route, {
        data: {
          teams: [
            { _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" },
          ],
        },
      });
      return true;
    }

    if (path === "/api/admin/slack/runtime/status" && method === "GET") {
      await fulfillJson(route, {
        data: {
          route_mode: "db_prefer",
          static_config: { channels: 1, routes: 0 },
          route_cache: { ttl_seconds: 60, cache_size: 0 },
        },
      });
      return true;
    }

    if (path === "/api/admin/slack/channels/T123456789/C123456789/routes") {
      if (method === "GET") {
        await fulfillJson(route, { data: { routes: routesRef.routes } });
        return true;
      }
      if (method === "PUT") {
        const body = (await postJson(route)) as { routes?: unknown[] } | null;
        routeWrites.push(body);
        routesRef.routes = Array.isArray(body?.routes) ? body.routes : [];
        await fulfillJson(route, { data: { routes: routesRef.routes } });
        return true;
      }
    }

    if (path === "/api/admin/slack/channels/T123456789/C123456789/diagnostics") {
      await fulfillJson(route, {
        data: { openfga: { reachable: true, tuple_count: 1 }, routes: [], warnings: [] },
      });
      return true;
    }

    return false;
  };
}

test.describe("mocked popover-in-dialog regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the popover-in-dialog regression.",
    );
  });

  test("agent dropdown inside the routing dialog can be searched, scrolled, and selected", async ({
    page,
  }) => {
    const routeWrites: unknown[] = [];
    const routesRef = { routes: [] as unknown[] };

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { slack: true },
      handlers: [slackHandler(routeWrites, routesRef)],
    });

    await page.goto("/admin/integrations/slack", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("tab", { name: "Configured channels" })).toBeVisible();
    await page.getByRole("button", { name: /#incidents/ }).click();

    await page.getByRole("button", { name: "Add Agent" }).click();
    const dialog = page.getByRole("dialog", { name: /Add Agent to #incidents/ });
    await expect(dialog).toBeVisible();

    // Open the Dynamic Agent picker.
    await dialog.getByLabel("Dynamic Agent").click();

    // Regression #1: the popover content must render INSIDE the dialog's DOM
    // subtree. Before the fix it portalled to document.body (a sibling of the
    // dialog), where the Radix focus scope swallowed its interactions.
    const popover = dialog.locator("[data-popover-content]");
    await expect(popover).toBeVisible();

    const listbox = popover.getByRole("listbox", { name: "Dynamic Agent" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(manyAgents.length);

    // Regression #2: the search box (inside the portalled popover) must accept
    // keystrokes — the focus trap previously stole focus back to the dialog.
    const search = popover.getByLabel("Search agents...");
    await search.fill("Agent 17");
    await expect(listbox.getByRole("option")).toHaveCount(1);
    await expect(listbox.getByRole("option", { name: /Agent 17.*agent:agent-17/ })).toBeVisible();

    // Clearing the filter restores the full, scrollable list.
    await search.fill("");
    await expect(listbox.getByRole("option")).toHaveCount(manyAgents.length);

    // Regression #3: the listbox must scroll. A trapped popover could not be
    // scrolled, so the last option stayed unreachable. Assert the container is
    // actually overflowing, then scroll the last option into view and click it.
    const overflow = await listbox.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    expect(overflow).toBe(true);

    const lastOption = listbox.getByRole("option", { name: /Agent 23.*agent:agent-23/ });
    await lastOption.scrollIntoViewIfNeeded();
    await lastOption.click();

    // Selecting closes the popover and reflects the choice on the trigger.
    await expect(popover).toBeHidden();
    await expect(dialog.getByLabel("Dynamic Agent")).toContainText("Agent 23");

    // And the selection round-trips through a save, proving the picker is fully
    // interactive inside the dialog.
    await dialog.getByRole("button", { name: "Add Agent" }).click();
    await expect.poll(() => routeWrites.length).toBe(1);
    expect(routeWrites[0]).toMatchObject({
      routes: [{ agent_id: "agent-23" }],
    });
  });
});
