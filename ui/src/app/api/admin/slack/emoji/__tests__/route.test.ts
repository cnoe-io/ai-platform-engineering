/**
 * @jest-environment node
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

const slackCalls: string[] = [];

function mockSlackFetch(body: unknown) {
  (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
    slackCalls.push(typeof input === "string" ? input : input.toString());
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
      `http://localhost:3000/api/admin/slack/emoji?${query}`,
      { headers: { Authorization: "Bearer test-token" } },
    ),
  );
  return response.json();
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  const route = await import("../route");
  route.__resetSlackEmojiCacheForTests();
});

describe("GET /api/admin/slack/emoji", () => {
  it("filters custom emoji and normalizes aliases", async () => {
    mockSlackFetch({
      ok: true,
      emoji: {
        party_parrot: "https://emoji/parrot.gif",
        parrot_alias: "alias:party_parrot",
      },
    });

    const warming = await makeRequest("q=parrot&limit=10") as { data: { emoji: Array<Record<string, string>>; warming: boolean } };
    expect(warming.data.warming).toBe(true);
    await flushPromises();

    const body = await makeRequest("q=parrot&limit=10") as { data: { emoji: Array<Record<string, string>>; cached: boolean } };
    const second = await makeRequest("q=eyes&limit=10") as { data: { emoji: Array<Record<string, string>>; cached: boolean } };

    expect(slackCalls).toHaveLength(1);
    expect(body.data.cached).toBe(true);
    expect(body.data.emoji).toEqual([
      { name: "parrot_alias", alias_for: "party_parrot" },
      { name: "party_parrot", url: "https://emoji/parrot.gif" },
    ]);
    expect(second.data.cached).toBe(true);
    expect(second.data.emoji).toEqual(expect.arrayContaining([{ name: "eyes" }]));
  });

  it("requires admin UI view permission", async () => {
    mockSlackFetch({ ok: true, emoji: {} });

    await makeRequest("q=eyes");

    expect(mockRequireRbacPermission).toHaveBeenCalledWith({ sub: "admin-sub" }, "admin_ui", "view");
  });
});
