/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

import {
  canonicalizeWebexSpaceId,
  isSafeWebexPaginationUrl,
} from "../available-spaces/route";

describe("available-spaces route helpers", () => {
  it("allows only https webexapis.com pagination links", () => {
    expect(isSafeWebexPaginationUrl("https://webexapis.com/v1/rooms?max=100")).toBe(true);
    expect(isSafeWebexPaginationUrl("http://webexapis.com/v1/rooms")).toBe(false);
    expect(isSafeWebexPaginationUrl("https://evil.example/v1/rooms")).toBe(false);
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

  afterEach(() => {
    if (originalIntegrationToken === undefined) {
      delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
    } else {
      process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = originalIntegrationToken;
    }
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
});
