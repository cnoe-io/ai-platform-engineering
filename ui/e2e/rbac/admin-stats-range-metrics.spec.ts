// E2E coverage for the admin Statistics tab date-range bugs fixed alongside
// this spec: (1) overview cards (Total Users/Conversations/Messages/Shared)
// must reflect the currently selected range rather than a stale all-time
// snapshot, (2) they grey out while a new range is loading, and (3) short
// ranges (1h/12h) must bucket into more than one chart data point.

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installMockedRbacApp,
  mockedRbacEnabled,
  type MockRouteHandler,
} from "./_mocked-rbac";

const adminSession = {
  email: "stats-admin@caipe.local",
  name: "Stats Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

function makeOverview(overrides: Partial<Record<string, number>> = {}) {
  return {
    total_users: 10,
    active_users: 4,
    avg_messages_per_conversation: 2.5,
    conversations_today: 1,
    dau: 4,
    mau: 8,
    messages_today: 3,
    shared_conversations: 2,
    total_conversations: 20,
    total_messages: 50,
    total_sessions: 12,
    ...overrides,
  };
}

function makeDailyActivity(count: number, hourly = false) {
  return Array.from({ length: count }, (_, i) => ({
    date: hourly ? `2026-07-10T${String(i).padStart(2, "0")}:00` : `2026-07-${String(i + 1).padStart(2, "0")}`,
    active_users: i + 1,
    conversations: i + 1,
    messages: (i + 1) * 2,
  }));
}

function makeStatsPayload(overview: ReturnType<typeof makeOverview>, dailyActivity: ReturnType<typeof makeDailyActivity>) {
  return {
    success: true,
    data: {
      overview,
      available_channels: [],
      completed_workflows: { avg_messages_per_workflow: 0, completion_rate: 0, interrupted: 0, today: 0, total: 0 },
      daily_activity: dailyActivity,
      daily_usage: [],
      feedback_summary: { negative: 0, positive: 0, total: 0 },
      hourly_heatmap: [],
      platform_summary: { estimated_hours_automated: 0, satisfaction_rate: 0 },
      response_time: { avg_ms: 0, max_ms: 0, min_ms: 0, sample_count: 0 },
      source_breakdown: [],
      top_agents: [],
      top_users: { by_conversations: [], by_messages: [] },
    },
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The UI sends `from`/`to` ISO timestamps (see DateRangeFilter's presetToRange),
 *  not a `range` string — reconstruct the preset from the from/to span so mocks
 *  can key off the same presets the buttons produce. */
function presetFromParams(url: URL): string | null {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (Math.abs(ms - HOUR_MS) < 1000) return "1h";
  if (Math.abs(ms - 12 * HOUR_MS) < 1000) return "12h";
  if (Math.abs(ms - DAY_MS) < 1000) return "24h";
  if (Math.abs(ms - 7 * DAY_MS) < 1000) return "7d";
  if (Math.abs(ms - 30 * DAY_MS) < 1000) return "30d";
  if (Math.abs(ms - 90 * DAY_MS) < 1000) return "90d";
  return null;
}

/** Serves a distinct overview/daily_activity payload per date-range preset so
 *  tests can assert the UI actually re-fetches and re-renders on range change. */
function makeRangeAwareStatsHandler(
  responsesByRange: Record<string, ReturnType<typeof makeStatsPayload>>,
  options: { onRequest?: (range: string | null) => void; holdUntil?: Promise<void> } = {},
): MockRouteHandler {
  return async ({ route, path, method, url }) => {
    if (path !== "/api/admin/stats" || method !== "GET") return false;
    const range = presetFromParams(url);
    options.onRequest?.(range);
    if (options.holdUntil) await options.holdUntil;
    const payload = (range && responsesByRange[range]) || responsesByRange.default;
    await fulfillJson(route, payload);
    return true;
  };
}

async function navigateToStatsTab(page: import("@playwright/test").Page) {
  await page.goto("/admin?cat=insights&tab=stats", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Statistics" })).toHaveAttribute("aria-selected", "true");
}

test.describe("mocked admin stats — date range regression", () => {
  test.beforeEach(() => {
    test.skip(
      !mockedRbacEnabled(),
      "Set RUN_RBAC_REGRESSION=1 to run the mocked RBAC browser regression.",
    );
  });

  test("overview cards reflect the initial range's stats, not a stale all-time snapshot", async ({ page }) => {
    const overview = makeOverview({ total_users: 42, total_conversations: 99, total_messages: 321, shared_conversations: 7 });
    const dailyActivity = makeDailyActivity(30);
    const payload = makeStatsPayload(overview, dailyActivity);

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { stats: true },
      handlers: [makeRangeAwareStatsHandler({ default: payload })],
    });

    await navigateToStatsTab(page);

    await expect(page.getByTestId("overview-total-users")).toHaveText("42");
    await expect(page.getByTestId("overview-total-conversations")).toHaveText("99");
    await expect(page.getByTestId("overview-total-messages")).toHaveText("321");
    await expect(page.getByTestId("overview-shared-conversations")).toHaveText("7");
  });

  test("overview cards update when the date-range preset changes", async ({ page }) => {
    const thirtyDayPayload = makeStatsPayload(
      makeOverview({ total_users: 42, total_conversations: 99, total_messages: 321 }),
      makeDailyActivity(30),
    );
    const sevenDayPayload = makeStatsPayload(
      makeOverview({ total_users: 8, total_conversations: 15, total_messages: 40 }),
      makeDailyActivity(7),
    );

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { stats: true },
      handlers: [
        makeRangeAwareStatsHandler({
          default: thirtyDayPayload,
          "7d": sevenDayPayload,
        }),
      ],
    });

    await navigateToStatsTab(page);

    await expect(page.getByTestId("overview-total-users")).toHaveText("42");
    await expect(page.getByTestId("overview-total-conversations")).toHaveText("99");

    await page.getByTestId("stats-date-range-filter").getByRole("button", { name: "7d", exact: true }).click();

    // The top cards must pick up the new range's totals — this is the bug:
    // they previously stayed frozen at the initial (30d) values.
    await expect(page.getByTestId("overview-total-users")).toHaveText("8");
    await expect(page.getByTestId("overview-total-conversations")).toHaveText("15");
    await expect(page.getByTestId("overview-total-messages")).toHaveText("40");

    // The chart-card "Total" figures must move in lockstep with the cards
    // above them (both read from the same range-scoped stats.overview).
    await expect(page.getByTestId("conversations-total")).toHaveText("15");
    await expect(page.getByTestId("messages-total")).toHaveText("40");
  });

  test("overview cards grey out (refreshing overlay) while a new range is loading", async ({ page }) => {
    const initialPayload = makeStatsPayload(makeOverview(), makeDailyActivity(30));
    const sevenDayPayload = makeStatsPayload(makeOverview({ total_users: 5 }), makeDailyActivity(7));

    let releaseSevenDayResponse = () => {};
    const holdUntil = new Promise<void>((resolve) => {
      releaseSevenDayResponse = resolve;
    });
    let sevenDayRequested = false;

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { stats: true },
      handlers: [
        async ({ route, path, method, url }) => {
          if (path !== "/api/admin/stats" || method !== "GET") return false;
          const range = presetFromParams(url);
          if (range === "7d") {
            sevenDayRequested = true;
            await holdUntil;
            await fulfillJson(route, sevenDayPayload);
          } else {
            await fulfillJson(route, initialPayload);
          }
          return true;
        },
      ],
    });

    await navigateToStatsTab(page);
    await expect(page.getByTestId("overview-stats-cards")).toBeVisible();
    await expect(page.getByTestId("stats-refreshing-overlay")).toHaveCount(0);

    await page.getByTestId("stats-date-range-filter").getByRole("button", { name: "7d", exact: true }).click();
    await expect.poll(() => sevenDayRequested).toBe(true);

    // While the 7d fetch is in flight, the overlay covers the (now stale)
    // cards so the user sees a loading state instead of a frozen number.
    await expect(page.getByTestId("stats-refreshing-overlay")).toBeVisible();

    releaseSevenDayResponse();

    await expect(page.getByTestId("stats-refreshing-overlay")).toHaveCount(0);
    await expect(page.getByTestId("overview-total-users")).toHaveText("5");
  });

  test("1h range renders more than a single chart data point", async ({ page }) => {
    // Mirrors the API's 5-minute bucketing for ranges <= 2h: 12 buckets for 1h.
    const oneHourActivity = makeDailyActivity(12, true);
    const payload = makeStatsPayload(makeOverview(), oneHourActivity);

    await installMockedRbacApp(page, {
      isAdmin: true,
      session: adminSession,
      gates: { stats: true },
      handlers: [makeRangeAwareStatsHandler({ default: payload, "1h": payload })],
    });

    await navigateToStatsTab(page);
    await page.getByTestId("stats-date-range-filter").getByRole("button", { name: "1h", exact: true }).click();

    const dauChart = page.getByTestId("chart-dau");
    await expect(dauChart).toBeVisible();
    await expect(dauChart.locator("circle")).toHaveCount(12);
  });
});
