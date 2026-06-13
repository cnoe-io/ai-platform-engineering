/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/users/resolve — the first-party user-directory
 * lookup the Slack bot calls (spec
 * 2026-06-09-slack-bot-remove-direct-keycloak-admin).
 *
 * Covers:
 *  - the bot service account (graphed `service_account:<sub>`) is authorized
 *    via `reader admin_surface:user_directory`;
 *  - an org admin passes via the can_manage bypass;
 *  - a caller with no grant is denied 403;
 *  - the three locators (attribute+value, email, id) each resolve correctly;
 *  - the attribute-name whitelist (400 on a disallowed name);
 *  - "no match" → `data: null` with HTTP 200 (NOT 404);
 *  - exactly-one-locator enforcement.
 */

import { NextRequest } from "next/server";

const mockCheckOpenFgaTuple = jest.fn();
const mockFindRealmUserIdByAttribute = jest.fn();
const mockFindUserIdByEmail = jest.fn();
const mockGetRealmUserByIdOrNull = jest.fn();

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(async () => null),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateLocalSkillsJWT: jest.fn(async () => null),
  validateBearerJWT: jest.fn(async () => ({
    sub: "slack-bot-sub",
    email: "service-account-slack-bot@local",
    name: "Slack Bot Service Account",
    isServiceAccount: true,
  })),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  findRealmUserIdByAttribute: (...args: unknown[]) =>
    mockFindRealmUserIdByAttribute(...args),
  findUserIdByEmail: (...args: unknown[]) => mockFindUserIdByEmail(...args),
  getRealmUserByIdOrNull: (...args: unknown[]) =>
    mockGetRealmUserByIdOrNull(...args),
}));

function request(query: string): NextRequest {
  return new NextRequest(
    new URL(`/api/admin/users/resolve${query}`, "http://localhost:3000"),
    {
      method: "GET",
      headers: {
        Authorization: "Bearer test-token",
        "X-Client-Source": "slack-bot",
      },
    }
  );
}

// Grant `reader admin_surface:user_directory` to the bot SA.
function grantDirectoryReader() {
  mockCheckOpenFgaTuple.mockImplementation(
    async (tuple: { user: string; relation: string; object: string }) => ({
      allowed:
        tuple.user === "service_account:slack-bot-sub" &&
        tuple.relation === "can_read" &&
        tuple.object === "admin_surface:user_directory",
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: deny everything; individual tests grant what they need.
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
  mockFindRealmUserIdByAttribute.mockResolvedValue(null);
  mockFindUserIdByEmail.mockResolvedValue(null);
  mockGetRealmUserByIdOrNull.mockResolvedValue(null);
});

describe("GET /api/admin/users/resolve", () => {
  it("resolves by attribute for the bot SA with reader admin_surface:user_directory", async () => {
    grantDirectoryReader();
    mockFindRealmUserIdByAttribute.mockResolvedValue("kc-uuid-1");
    mockGetRealmUserByIdOrNull.mockResolvedValue({
      id: "kc-uuid-1",
      enabled: true,
      attributes: { slack_user_id: ["U123"] },
    });

    const { GET } = await import("../route");
    const response = await GET(
      request("?attribute=slack_user_id&value=U123")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { sub: "kc-uuid-1", enabled: true, attributes: { slack_user_id: ["U123"] } },
    });
    expect(mockFindRealmUserIdByAttribute).toHaveBeenCalledWith("slack_user_id", "U123");
    expect(mockGetRealmUserByIdOrNull).toHaveBeenCalledWith("kc-uuid-1");
  });

  it("resolves by email", async () => {
    grantDirectoryReader();
    mockFindUserIdByEmail.mockResolvedValue("kc-uuid-2");
    mockGetRealmUserByIdOrNull.mockResolvedValue({
      id: "kc-uuid-2",
      enabled: true,
      attributes: {},
    });

    const { GET } = await import("../route");
    const response = await GET(request("?email=alice@corp.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.sub).toBe("kc-uuid-2");
    expect(mockFindUserIdByEmail).toHaveBeenCalledWith("alice@corp.com");
  });

  it("resolves by id", async () => {
    grantDirectoryReader();
    mockGetRealmUserByIdOrNull.mockResolvedValue({
      id: "kc-uuid-3",
      enabled: false,
      attributes: { caipe_default_team_id: ["platform"] },
    });

    const { GET } = await import("../route");
    const response = await GET(request("?id=kc-uuid-3"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      sub: "kc-uuid-3",
      enabled: false,
      attributes: { caipe_default_team_id: ["platform"] },
    });
    expect(mockGetRealmUserByIdOrNull).toHaveBeenCalledWith("kc-uuid-3");
  });

  it("returns data:null with 200 when no user matches (not 404)", async () => {
    grantDirectoryReader();
    mockFindRealmUserIdByAttribute.mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(
      request("?attribute=slack_user_id&value=UNKNOWN")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: null });
    expect(mockGetRealmUserByIdOrNull).not.toHaveBeenCalled();
  });

  it("allows an org admin via the can_manage bypass", async () => {
    mockCheckOpenFgaTuple.mockImplementation(
      async (tuple: { relation: string; object: string }) => ({
        allowed:
          tuple.relation === "can_manage" && tuple.object === "organization:caipe",
      })
    );
    mockGetRealmUserByIdOrNull.mockResolvedValue({ id: "kc-uuid-4", enabled: true });

    const { GET } = await import("../route");
    const response = await GET(request("?id=kc-uuid-4"));

    expect(response.status).toBe(200);
  });

  it("denies a caller without the directory-read grant", async () => {
    const { GET } = await import("../route");
    const response = await GET(request("?id=kc-uuid-5"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("admin_surface#read");
    expect(mockGetRealmUserByIdOrNull).not.toHaveBeenCalled();
  });

  describe("query validation (after auth)", () => {
    beforeEach(() => {
      grantDirectoryReader();
    });

    it("rejects a non-whitelisted attribute name", async () => {
      const { GET } = await import("../route");
      const response = await GET(request("?attribute=email&value=alice@corp.com"));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe("ATTRIBUTE_NOT_ALLOWED");
      expect(mockFindRealmUserIdByAttribute).not.toHaveBeenCalled();
    });

    it("rejects attribute without value", async () => {
      const { GET } = await import("../route");
      const response = await GET(request("?attribute=slack_user_id"));
      expect(response.status).toBe(400);
      expect(mockFindRealmUserIdByAttribute).not.toHaveBeenCalled();
    });

    it("rejects no locator", async () => {
      const { GET } = await import("../route");
      const response = await GET(request(""));
      expect(response.status).toBe(400);
    });

    it("rejects more than one locator", async () => {
      const { GET } = await import("../route");
      const response = await GET(request("?email=a@b.com&id=kc-uuid"));
      expect(response.status).toBe(400);
    });
  });
});
