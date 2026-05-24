/**
 * @jest-environment node
 *
 * Regression coverage for GitHub issue #1506: Slack Integration channel
 * discovery returning irrelevant results + no caching.
 *
 * Verifies that the `available-channels` route:
 *   - Uses `users.conversations` (Tier 3) when member_only=1 (default), so
 *     workspaces with thousands of channels don't trip Slack's Tier-2 rate
 *     limit on `conversations.list`.
 *   - Falls back to `conversations.list` when member_only=0.
 *   - Caches results per (scope, token) and serves repeat requests from cache
 *     without calling Slack again.
 *   - Splits the cache key per scope so the two endpoints don't poison each
 *     other's snapshot.
 *   - Honors `refresh=1` to force a re-fetch.
 *   - Defaults `is_member=true` for rows from `users.conversations` (which
 *     omits the field per Slack's docs).
 *
 * assisted-by Claude Claude-opus-4-7
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
    requireRbacPermission: (...args: unknown[]) =>
      mockRequireRbacPermission(...args),
  };
});

interface SlackFetchCall {
  endpoint: string;
  cursor: string | null;
  url: string;
}

const slackCalls: SlackFetchCall[] = [];

function mockSlackFetch(handler: (call: SlackFetchCall) => unknown) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
    const url = typeof input === "string" ? input : input.toString();
    const parsed = new URL(url);
    const endpointName = parsed.pathname.split("/").pop() ?? "";
    const cursor = parsed.searchParams.get("cursor");
    const call: SlackFetchCall = { endpoint: endpointName, cursor, url };
    slackCalls.push(call);
    const body = handler(call);
    return {
      ok: true,
      status: 200,
      headers: new Map<string, string>(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

async function makeRequest(query: string): Promise<unknown> {
  const { GET } = await import("../route");
  const response = await GET(
    new NextRequest(
      `http://localhost:3000/api/admin/slack/available-channels?${query}`,
      { headers: { Authorization: "Bearer test-token" } }
    )
  );
  return await response.json();
}

beforeEach(async () => {
  jest.clearAllMocks();
  slackCalls.length = 0;
  mockGetAuthFromBearerOrSession.mockResolvedValue({
    user: { email: "admin@example.com" },
    session: { sub: "admin-sub" },
  });
  mockRequireRbacPermission.mockResolvedValue(undefined);
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token-abcdefghijkl";

  // Reset the route's in-process cache so each test starts clean.
  const route = await import("../route");
  route.__resetAvailableChannelsCacheForTests();
  // Also reset the discovery-cache TTL memo so a previous test's env
  // toggling can't bleed into the next test.
  const cfg = await import("@/lib/rbac/discovery-cache-config");
  cfg.__resetDiscoveryCacheConfigForTests();
  delete process.env.DISCOVERY_CACHE_TTL_MINUTES;
});

describe("GET /api/admin/slack/available-channels", () => {
  describe("issue #1506 — endpoint selection", () => {
    it("uses users.conversations when member_only=1 (default)", async () => {
      mockSlackFetch(() => ({
        ok: true,
        channels: [
          { id: "C100", name: "incidents", is_private: false, num_members: 5 },
          { id: "C101", name: "alerts", is_private: true, num_members: 2 },
        ],
        response_metadata: { next_cursor: "" },
      }));

      const body = await makeRequest("member_only=1");

      expect(slackCalls).toHaveLength(1);
      expect(slackCalls[0].endpoint).toBe("users.conversations");
      // Both channels should come back with is_member=true even though
      // users.conversations omits the field.
      expect(body).toMatchObject({
        success: true,
        data: {
          scope: "member_only",
          endpoint: "users.conversations",
          channels: [
            expect.objectContaining({ id: "C101", name: "alerts", is_member: true }),
            expect.objectContaining({ id: "C100", name: "incidents", is_member: true }),
          ],
        },
      });
    });

    it("uses users.conversations by default (no member_only param)", async () => {
      mockSlackFetch(() => ({ ok: true, channels: [] }));
      await makeRequest("");
      expect(slackCalls[0].endpoint).toBe("users.conversations");
    });

    it("falls back to conversations.list when member_only=0", async () => {
      mockSlackFetch(() => ({
        ok: true,
        channels: [
          { id: "C200", name: "general", is_private: false, is_member: true, num_members: 100 },
          { id: "C201", name: "random", is_private: false, is_member: false, num_members: 200 },
        ],
      }));

      const body = await makeRequest("member_only=0");

      expect(slackCalls).toHaveLength(1);
      expect(slackCalls[0].endpoint).toBe("conversations.list");
      expect(body).toMatchObject({
        success: true,
        data: { scope: "all", endpoint: "conversations.list" },
      });
    });
  });

  describe("issue #1506 — caching", () => {
    it("serves repeat requests from cache without hitting Slack again", async () => {
      mockSlackFetch(() => ({
        ok: true,
        channels: [
          { id: "C100", name: "incidents", num_members: 5 },
        ],
      }));

      const first = (await makeRequest("member_only=1")) as { data: { cached: boolean } };
      const second = (await makeRequest("member_only=1")) as { data: { cached: boolean } };

      expect(slackCalls).toHaveLength(1); // second call hit the cache
      expect(first.data.cached).toBe(false);
      expect(second.data.cached).toBe(true);
    });

    it("forces a re-fetch when refresh=1 is set", async () => {
      mockSlackFetch(() => ({ ok: true, channels: [{ id: "C100", name: "incidents" }] }));

      await makeRequest("member_only=1");
      await makeRequest("member_only=1&refresh=1");

      expect(slackCalls).toHaveLength(2);
      expect(slackCalls.every((c) => c.endpoint === "users.conversations")).toBe(true);
    });

    it("skips the cache entirely when the admin TTL is 0 minutes", async () => {
      // Admin set the discovery cache TTL to 0 (= caching disabled) via
      // Admin → Platform Settings. Every request should re-fetch from
      // Slack — this is the debug knob for the `#test-0525` scenario
      // where the bot was just added to a new channel.
      process.env.DISCOVERY_CACHE_TTL_MINUTES = "0";
      const cfg = await import("@/lib/rbac/discovery-cache-config");
      cfg.__resetDiscoveryCacheConfigForTests();

      mockSlackFetch(() => ({ ok: true, channels: [{ id: "C100", name: "incidents" }] }));

      await makeRequest("member_only=1");
      await makeRequest("member_only=1");
      await makeRequest("member_only=1");

      expect(slackCalls).toHaveLength(3);
    });

    it("splits the cache by scope so member_only and full-list don't poison each other", async () => {
      mockSlackFetch((call) => {
        if (call.endpoint === "users.conversations") {
          return { ok: true, channels: [{ id: "C100", name: "members-only-channel" }] };
        }
        return {
          ok: true,
          channels: [
            { id: "C100", name: "members-only-channel", is_member: true },
            { id: "C999", name: "non-member-channel", is_member: false },
          ],
        };
      });

      const memberOnly = (await makeRequest("member_only=1")) as {
        data: { channels: Array<{ id: string }> };
      };
      const all = (await makeRequest("member_only=0")) as {
        data: { channels: Array<{ id: string }>; total_visible: number };
      };

      // Two distinct Slack calls (one per endpoint), each cached separately.
      expect(slackCalls).toHaveLength(2);
      expect(slackCalls.map((c) => c.endpoint).sort()).toEqual([
        "conversations.list",
        "users.conversations",
      ]);
      expect(memberOnly.data.channels.map((c) => c.id)).toEqual(["C100"]);
      expect(all.data.channels.map((c) => c.id)).toEqual(["C100", "C999"]);

      // And a second member_only request should still come from cache, not
      // contaminated by the all-list fetch.
      const repeat = (await makeRequest("member_only=1")) as {
        data: { cached: boolean; channels: Array<{ id: string }> };
      };
      expect(slackCalls).toHaveLength(2);
      expect(repeat.data.cached).toBe(true);
      expect(repeat.data.channels.map((c) => c.id)).toEqual(["C100"]);
    });
  });

  describe("pagination + filtering", () => {
    it("walks Slack cursors and returns all pages", async () => {
      mockSlackFetch((call) => {
        if (!call.cursor) {
          return {
            ok: true,
            channels: [{ id: "C001", name: "a-channel" }],
            response_metadata: { next_cursor: "page2" },
          };
        }
        return {
          ok: true,
          channels: [{ id: "C002", name: "b-channel" }],
          response_metadata: { next_cursor: "" },
        };
      });

      const body = (await makeRequest("member_only=1")) as {
        data: { channels: Array<{ id: string }>; total_visible: number };
      };

      expect(slackCalls).toHaveLength(2);
      expect(body.data.total_visible).toBe(2);
      expect(body.data.channels.map((c) => c.id)).toEqual(["C001", "C002"]);
    });

    it("filters by q (case-insensitive substring) over the cached snapshot", async () => {
      mockSlackFetch(() => ({
        ok: true,
        channels: [
          { id: "C001", name: "incidents-prod" },
          { id: "C002", name: "incidents-dev" },
          { id: "C003", name: "random" },
        ],
      }));

      const body = (await makeRequest("member_only=1&q=INCIDENTS")) as {
        data: { channels: Array<{ id: string }>; total_matches: number };
      };

      expect(body.data.total_matches).toBe(2);
      expect(body.data.channels.map((c) => c.id).sort()).toEqual(["C001", "C002"]);
    });
  });

  describe("failure modes", () => {
    it("returns 503 when SLACK_BOT_TOKEN is unset", async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const { GET } = await import("../route");
      const response = await GET(
        new NextRequest(
          "http://localhost:3000/api/admin/slack/available-channels?member_only=1",
          { headers: { Authorization: "Bearer test-token" } }
        )
      );
      expect(response.status).toBe(503);
    });

    // Regression: previously a network failure surfaced as the opaque
    // "fetch failed" string from Node's undici, which left admins with no
    // way to tell whether Slack was down, DNS was broken, or egress was
    // blocked. The route now unwraps `error.cause` so the underlying
    // reason makes it back to the UI and the server logs.
    it("returns 502 with the underlying cause when fetch() rejects (DNS/TLS/connect)", async () => {
      const causeError = Object.assign(new Error("getaddrinfo ENOTFOUND slack.com"), {
        name: "Error",
      });
      const fetchError = new TypeError("fetch failed");
      (fetchError as { cause?: unknown }).cause = causeError;
      (global.fetch as jest.Mock).mockRejectedValue(fetchError);

      const { GET } = await import("../route");
      const response = await GET(
        new NextRequest(
          "http://localhost:3000/api/admin/slack/available-channels?member_only=1",
          { headers: { Authorization: "Bearer test-token" } }
        )
      );
      expect(response.status).toBe(502);
      const body = (await response.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain("Slack discovery network failure");
      expect(body.error).toContain("users.conversations");
      expect(body.error).toContain("ENOTFOUND slack.com");
      // Must NOT contain the bearer token in the user-facing message.
      expect(body.error).not.toContain("Bearer");
      expect(body.error).not.toContain(process.env.SLACK_BOT_TOKEN ?? "xoxb-test");
    });

    it("returns 502 when Slack returns a non-JSON body (e.g. HTML during incident)", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Map<string, string>(),
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
        text: async () => "<html>Service Unavailable</html>",
      });

      const { GET } = await import("../route");
      const response = await GET(
        new NextRequest(
          "http://localhost:3000/api/admin/slack/available-channels?member_only=1",
          { headers: { Authorization: "Bearer test-token" } }
        )
      );
      expect(response.status).toBe(502);
      const body = (await response.json()) as { success: boolean; error: string };
      expect(body.error).toContain("non-JSON response");
      expect(body.error).toContain("users.conversations");
    });
  });
});
