/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
const mockMergeUserAttributes = jest.fn();
const mockFindRealmUserIdByAttribute = jest.fn();

const nonceRows: Array<Record<string, unknown>> = [];

jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  mergeUserAttributes: (...args: unknown[]) => mockMergeUserAttributes(...args),
  findRealmUserIdByAttribute: (...args: unknown[]) => mockFindRealmUserIdByAttribute(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async () => ({
    findOne: jest.fn(async (filter: Record<string, unknown>) =>
      nonceRows.find((row) => {
        if (filter.nonce !== undefined && row.nonce !== filter.nonce) return false;
        if (filter.webex_user_id !== undefined && row.webex_user_id !== filter.webex_user_id) return false;
        if (filter.hmac_ts !== undefined && row.hmac_ts !== filter.hmac_ts) return false;
        if (filter.consumed?.$ne === true && row.consumed === true) return false;
        return true;
      }) ?? null
    ),
    insertOne: jest.fn(async (doc: Record<string, unknown>) => {
      nonceRows.push({ ...doc });
      return { insertedId: "id" };
    }),
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const row = nonceRows.find((candidate) => {
        if (filter.nonce !== undefined && candidate.nonce !== filter.nonce) return false;
        if (filter.webex_user_id !== undefined && candidate.webex_user_id !== filter.webex_user_id) return false;
        if (filter.consumed?.$ne === true && candidate.consumed === true) return false;
        return true;
      });
      if (row && update.$set) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    }),
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  nonceRows.length = 0;
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.WEBEX_LINK_HMAC_SECRET = "test-secret";
  mockMergeUserAttributes.mockResolvedValue(undefined);
  mockFindRealmUserIdByAttribute.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.WEBEX_LINK_HMAC_SECRET;
});

describe("GET /api/auth/webex-link", () => {
  it("does not consume nonce before OIDC session is established", async () => {
    nonceRows.push({
      nonce: "pending-nonce",
      webex_user_id: "person-1",
      consumed: false,
      expires_at: new Date(Date.now() + 60_000),
    });
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import("../webex-link/route");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/auth/webex-link?webex_user_id=person-1&nonce=pending-nonce"
      )
    );

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(nonceRows[0].consumed).not.toBe(true);
    expect(mockMergeUserAttributes).not.toHaveBeenCalled();
  });

  it("consumes nonce only after successful link", async () => {
    nonceRows.push({
      nonce: "ready-nonce",
      webex_user_id: "person-1",
      consumed: false,
      expires_at: new Date(Date.now() + 60_000),
    });
    mockGetServerSession.mockResolvedValue({ sub: "kc-user-1" });
    const { GET } = await import("../webex-link/route");

    const response = await GET(
      new NextRequest("http://localhost:3000/api/auth/webex-link?webex_user_id=person-1&nonce=ready-nonce")
    );

    expect(response.status).toBe(200);
    expect(mockMergeUserAttributes).toHaveBeenCalledWith("kc-user-1", { webex_user_id: ["person-1"] });
    expect(nonceRows[0].consumed).toBe(true);
  });

  it("rejects Webex ID already linked to another Keycloak user", async () => {
    nonceRows.push({
      nonce: "conflict-nonce",
      webex_user_id: "person-1",
      consumed: false,
      expires_at: new Date(Date.now() + 60_000),
    });
    mockGetServerSession.mockResolvedValue({ sub: "kc-user-1" });
    mockFindRealmUserIdByAttribute.mockResolvedValue("kc-user-2");
    const { GET } = await import("../webex-link/route");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/auth/webex-link?webex_user_id=person-1&nonce=conflict-nonce"
      )
    );

    expect(response.status).toBe(409);
    expect(mockMergeUserAttributes).not.toHaveBeenCalled();
    expect(nonceRows[0].consumed).not.toBe(true);
  });
});
