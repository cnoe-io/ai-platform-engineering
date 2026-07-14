/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

import {
  __resetWebexSpaceDiscoveryCacheForTests,
  canonicalizeWebexSpaceId,
  isSafeWebexPaginationUrl,
  nextWebexPaginationUrl,
} from "../available-spaces/route";

describe("available-spaces route helpers", () => {
  it("allows only https webexapis.com pagination links", () => {
    expect(isSafeWebexPaginationUrl("https://webexapis.com/v1/rooms?max=100")).toBe(true);
    expect(isSafeWebexPaginationUrl("http://webexapis.com/v1/rooms")).toBe(false);
    expect(isSafeWebexPaginationUrl("https://evil.example/v1/rooms")).toBe(false);
  });

  it("reads the next Webex page from the HTTP Link header", () => {
    expect(
      nextWebexPaginationUrl(
        '<https://webexapis.com/v1/rooms?cursor=next-page>; rel="next", <https://webexapis.com/v1/rooms?cursor=last-page>; rel="last"',
      ),
    ).toBe("https://webexapis.com/v1/rooms?cursor=next-page");
    expect(
      nextWebexPaginationUrl('<https://example.invalid/rooms?cursor=next-page>; rel="next"'),
    ).toBeUndefined();
  });

  it("canonicalizes Webex public room IDs to raw UUIDs", () => {
    expect(
      canonicalizeWebexSpaceId(
        "Y2lzY29zcGFyazovL3VzL1JPT00vNmY5MWIwNzAtNTMxYS0xMWYxLTkyNmQtNmZkM2MyMGRmZGM0"
      )
    ).toBe("6f91b070-531a-11f1-926d-6fd3c20dfdc4");
    expect(canonicalizeWebexSpaceId("6f91b070-531a-11f1-926d-6fd3c20dfdc4")).toBe(
      "6f91b070-531a-11f1-926d-6fd3c20dfdc4"
    );
  });
});

jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: jest.fn(async () => ({ allowed: true })),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "alice-sub",
    email: "alice@example.com",
    name: "Alice",
  })),
}));

jest.mock("@/lib/config", () => ({ getConfig: () => true }));
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

describe("GET /api/admin/webex/available-spaces", () => {
  const originalIntegrationToken = process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
  const originalBotsConfig = process.env.WEBEX_INTEGRATION_BOTS_JSON;
  const originalSecondaryToken = process.env.WEBEX_SECONDARY_BOT_TOKEN;

  afterEach(() => {
    __resetWebexSpaceDiscoveryCacheForTests();
    if (originalIntegrationToken === undefined) {
      delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    } else {
      process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = originalIntegrationToken;
    }
    if (originalBotsConfig === undefined) delete process.env.WEBEX_INTEGRATION_BOTS_JSON;
    else process.env.WEBEX_INTEGRATION_BOTS_JSON = originalBotsConfig;
    if (originalSecondaryToken === undefined) delete process.env.WEBEX_SECONDARY_BOT_TOKEN;
    else process.env.WEBEX_SECONDARY_BOT_TOKEN = originalSecondaryToken;
    jest.restoreAllMocks();
  });

  it("uses WEBEX_INTEGRATION_BOT_ACCESS_TOKEN for Webex API calls", async () => {
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "integration-token";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "Y2lzY29zcGFyazovL3VzL1JPT00vNmY5MWIwNzAtNTMxYS0xMWYxLTkyNmQtNmZkM2MyMGRmZGM0",
            title: "Ops",
          },
        ],
      }),
      headers: { get: () => null },
    } as unknown as Response);

    const { GET } = await import("../available-spaces/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/webex/available-spaces", {
        headers: { Authorization: "Bearer test-token" },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.spaces[0]).toEqual(
      expect.objectContaining({
        id: "6f91b070-531a-11f1-926d-6fd3c20dfdc4",
        webex_room_id:
          "Y2lzY29zcGFyazovL3VzL1JPT00vNmY5MWIwNzAtNTMxYS0xMWYxLTkyNmQtNmZkM2MyMGRmZGM0",
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://webexapis.com/v1/rooms?max=100&sortBy=lastactivity",
      expect.objectContaining({
        headers: { Authorization: "Bearer integration-token" },
      })
    );
  });

  it("returns 503 when WEBEX_INTEGRATION_BOT_ACCESS_TOKEN is unset", async () => {
    delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    const { GET } = await import("../available-spaces/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/webex/available-spaces", {
        headers: { Authorization: "Bearer test-token" },
      })
    );

    expect(response.status).toBe(503);
  });

  it("uses the bot selected by bot_id", async () => {
    process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
      { id: "primary", name: "Primary", tokenEnv: "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN" },
      { id: "secondary", name: "Secondary", tokenEnv: "WEBEX_SECONDARY_BOT_TOKEN" },
    ]);
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "primary-token";
    process.env.WEBEX_SECONDARY_BOT_TOKEN = "secondary-token";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      headers: { get: () => null },
    } as unknown as Response);

    const { GET } = await import("../available-spaces/route");
    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/admin/webex/available-spaces?bot_id=secondary",
        { headers: { Authorization: "Bearer test-token" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://webexapis.com/v1/rooms?max=100&sortBy=lastactivity",
      expect.objectContaining({ headers: { Authorization: "Bearer secondary-token" } }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ bot: { id: "secondary", name: "Secondary" } }),
      }),
    );
  });

  it("merges spaces across bots and records which bots can see each space", async () => {
    process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
      { id: "primary", name: "Primary", tokenEnv: "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN" },
      { id: "secondary", name: "Secondary", tokenEnv: "WEBEX_SECONDARY_BOT_TOKEN" },
    ]);
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "primary-token";
    process.env.WEBEX_SECONDARY_BOT_TOKEN = "secondary-token";
    jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization;
      const items = authorization === "Bearer primary-token"
        ? [
            { id: "shared-room-id", title: "Shared", type: "group" },
            { id: "primary-room-id", title: "Primary only", type: "group" },
          ]
        : [{ id: "shared-room-id", title: "Shared", type: "group" }];
      return {
        ok: true,
        status: 200,
        json: async () => ({ items }),
        headers: { get: () => null },
      } as unknown as Response;
    });

    const { GET } = await import("../available-spaces/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/webex/available-spaces", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.spaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "shared-room-id",
        available_bot_ids: ["primary", "secondary"],
      }),
      expect.objectContaining({
        id: "primary-room-id",
        available_bot_ids: ["primary"],
      }),
    ]));
  });

  it("keeps separate cache snapshots for bot tokens with the same suffix", async () => {
    process.env.WEBEX_INTEGRATION_BOTS_JSON = JSON.stringify([
      { id: "primary", name: "Primary", tokenEnv: "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN" },
      { id: "secondary", name: "Secondary", tokenEnv: "WEBEX_SECONDARY_BOT_TOKEN" },
    ]);
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "first-token-common-suffix";
    process.env.WEBEX_SECONDARY_BOT_TOKEN = "second-token-common-suffix";
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization;
      const primary = authorization === "Bearer first-token-common-suffix";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: primary ? "primary-room" : "secondary-room", title: primary ? "Primary" : "Secondary" }],
        }),
        headers: { get: () => null },
      } as unknown as Response;
    });

    const { GET } = await import("../available-spaces/route");
    const request = () => GET(new NextRequest(
      "http://localhost:3000/api/admin/webex/available-spaces",
      { headers: { Authorization: "Bearer test-token" } },
    ));
    expect((await (await request()).json()).data.spaces).toHaveLength(2);
    expect((await (await request()).json()).data.spaces).toHaveLength(2);
    const botFetches = fetchMock.mock.calls.filter(([, init]) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization;
      return authorization === "Bearer first-token-common-suffix" ||
        authorization === "Bearer second-token-common-suffix";
    });
    expect(botFetches).toHaveLength(2);
  });

  it("follows HTTP Link header pagination", async () => {
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "pagination-token";
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: "first-room", title: "First" }] }),
        headers: { get: (name: string) => name.toLowerCase() === "link"
          ? '<https://webexapis.com/v1/rooms?cursor=next-page>; rel="next"'
          : null },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: "second-room", title: "Second" }] }),
        headers: { get: () => null },
      } as unknown as Response);

    const { GET } = await import("../available-spaces/route");
    const response = await GET(new NextRequest(
      "http://localhost:3000/api/admin/webex/available-spaces",
      { headers: { Authorization: "Bearer test-token" } },
    ));

    expect((await response.json()).data.spaces).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://webexapis.com/v1/rooms?cursor=next-page",
      expect.any(Object),
    );
  });

  it("does not return direct rooms in space discovery", async () => {
    process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "direct-filter-token";
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: "direct-room-id", title: "Example User", type: "direct" },
          { id: "group-room-id", title: "Example Group", type: "group" },
        ],
      }),
      headers: { get: () => null },
    } as unknown as Response);

    const { GET } = await import("../available-spaces/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/admin/webex/available-spaces", {
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.spaces).toEqual([
      expect.objectContaining({ id: "group-room-id", name: "Example Group" }),
    ]);
  });
});
