/**
 * @jest-environment node
 */
/**
 * Tests for GET/POST/DELETE /api/admin/service-accounts/[id]/credentials
 *
 * Covers:
 * - Happy paths for all three verbs
 * - 401 when unauthenticated
 * - 404 when caller is not a can_manage member (non-member, revoked SA)
 * - POST: provider validation (unknown provider → 400)
 * - DELETE: cross-owner guard (connection belongs to a different SA → 404)
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

const mockCheckOpenFgaTuple = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

const mockGetBySub = jest.fn();
jest.mock("@/lib/service-accounts", () => ({
  getBySub: (...args: unknown[]) => mockGetBySub(...args),
}));

const mockListConnections = jest.fn();
const mockRegisterStaticToken = jest.fn();
const mockGetConnection = jest.fn();
jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: mockListConnections,
    registerStaticToken: mockRegisterStaticToken,
    getConnection: mockGetConnection,
  })),
}));

// Mongo collection mock — supports deleteOne
const mockConnectionsDeleteOne = jest.fn();
const mockPayloadsDeleteOne = jest.fn();
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => {
    if (name === "provider_connections") {
      return { deleteOne: mockConnectionsDeleteOne };
    }
    if (name === "credential_encrypted_payloads") {
      return { deleteOne: mockPayloadsDeleteOne };
    }
    return {};
  }),
}));

import { GET, POST, DELETE } from "../route";

const SESSION = { sub: "mgr-sub", user: { email: "mgr@example.com" } };
const SA_ID = "sa-abc";
const SA_SUB = "sa-abc"; // sa_sub === id in these tests
const DOC = {
  sa_sub: SA_SUB,
  client_id: "caipe-sa-bot",
  client_uuid: "kc-uuid-1",
  name: "bot",
  owning_team_id: "team-eng",
  created_by: "creator-sub",
  status: "active" as const,
};

const CONN = {
  id: "conn-1",
  connectorId: "connector-gitlab",
  provider: "gitlab",
  owner: { type: "service_account", id: SA_SUB },
  status: "connected" as const,
  updatedAt: new Date("2025-01-01"),
  requestedScopes: ["api"],
};

function makeRequest(
  method: string,
  body?: unknown,
  queryConnectionId?: string,
): NextRequest {
  const url = queryConnectionId
    ? `http://localhost/api/admin/service-accounts/${SA_ID}/credentials?connection_id=${queryConnectionId}`
    : `http://localhost/api/admin/service-accounts/${SA_ID}/credentials`;
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  }
  return new NextRequest(url, { method });
}

function ctx() {
  return { params: Promise.resolve({ id: SA_ID }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
  mockGetBySub.mockResolvedValue(DOC);
  mockListConnections.mockResolvedValue([CONN]);
  mockRegisterStaticToken.mockResolvedValue(CONN);
  mockGetConnection.mockResolvedValue(CONN);
  mockConnectionsDeleteOne.mockResolvedValue({ deletedCount: 1 });
  mockPayloadsDeleteOne.mockResolvedValue({ deletedCount: 1 });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe("GET .../[id]/credentials", () => {
  it("returns connection metadata for the SA, no token material", async () => {
    const res = await GET(makeRequest("GET"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    const item = body.data[0];
    expect(item.id).toBe("conn-1");
    expect(item.provider).toBe("gitlab");
    expect(item.status).toBe("connected");
    // Must NOT contain any token field
    expect(item).not.toHaveProperty("accessToken");
    expect(item).not.toHaveProperty("access_token");
    expect(item).not.toHaveProperty("accessTokenRef");
    expect(item).not.toHaveProperty("refreshTokenRef");
    expect(mockListConnections).toHaveBeenCalledWith({
      type: "service_account",
      id: SA_SUB,
    });
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), ctx());
    expect(res.status).toBe(401);
  });

  it("404 when caller is not can_manage member", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const res = await GET(makeRequest("GET"), ctx());
    expect(res.status).toBe(404);
    expect(mockListConnections).not.toHaveBeenCalled();
  });

  it("404 when SA is revoked", async () => {
    mockGetBySub.mockResolvedValue({ ...DOC, status: "revoked" });
    const res = await GET(makeRequest("GET"), ctx());
    expect(res.status).toBe(404);
    expect(mockListConnections).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe("POST .../[id]/credentials", () => {
  it("registers a static token and returns connection metadata (no token)", async () => {
    const res = await POST(
      makeRequest("POST", { provider: "gitlab", token: "glpat-abc123" }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe("gitlab");
    expect(body.data.id).toBe("conn-1");
    // No token material
    expect(body.data).not.toHaveProperty("accessToken");
    expect(body.data).not.toHaveProperty("access_token");
    expect(mockRegisterStaticToken).toHaveBeenCalledWith({
      providerKey: "gitlab",
      owner: { type: "service_account", id: SA_SUB },
      accessToken: "glpat-abc123",
      requestedScopes: undefined,
    });
  });

  it("forwards requestedScopes when provided", async () => {
    await POST(
      makeRequest("POST", { provider: "github", token: "ghp-token", requestedScopes: ["repo"] }),
      ctx(),
    );
    expect(mockRegisterStaticToken).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: ["repo"] }),
    );
  });

  it("400 when provider is unknown", async () => {
    const res = await POST(
      makeRequest("POST", { provider: "unknown-provider", token: "tok" }),
      ctx(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/provider must be one of/);
    expect(mockRegisterStaticToken).not.toHaveBeenCalled();
  });

  it("400 when token is missing", async () => {
    const res = await POST(makeRequest("POST", { provider: "gitlab" }), ctx());
    expect(res.status).toBe(400);
    expect(mockRegisterStaticToken).not.toHaveBeenCalled();
  });

  it("400 when provider is missing", async () => {
    const res = await POST(makeRequest("POST", { token: "tok" }), ctx());
    expect(res.status).toBe(400);
    expect(mockRegisterStaticToken).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(
      makeRequest("POST", { provider: "gitlab", token: "tok" }),
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  it("404 when caller is not can_manage member", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const res = await POST(
      makeRequest("POST", { provider: "gitlab", token: "tok" }),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(mockRegisterStaticToken).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe("DELETE .../[id]/credentials", () => {
  it("deletes the connection when owner matches (body connection_id)", async () => {
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: "conn-1", deleted: true });
    expect(mockConnectionsDeleteOne).toHaveBeenCalledWith({ id: "conn-1" });
  });

  it("deletes the connection when owner matches (query connection_id)", async () => {
    const res = await DELETE(makeRequest("DELETE", undefined, "conn-1"), ctx());
    expect(res.status).toBe(200);
    expect(mockConnectionsDeleteOne).toHaveBeenCalledWith({ id: "conn-1" });
  });

  it("404 via cross-owner guard — connection belongs to a different SA", async () => {
    // Connection is owned by a DIFFERENT service account
    mockGetConnection.mockResolvedValue({
      ...CONN,
      owner: { type: "service_account", id: "OTHER-SA-sub" },
    });
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(mockConnectionsDeleteOne).not.toHaveBeenCalled();
  });

  it("404 via cross-owner guard — connection belongs to a user, not an SA", async () => {
    mockGetConnection.mockResolvedValue({
      ...CONN,
      owner: { type: "user", id: SA_SUB },
    });
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(mockConnectionsDeleteOne).not.toHaveBeenCalled();
  });

  it("404 when connection not found", async () => {
    mockGetConnection.mockRejectedValue(new Error("not found"));
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "nonexistent" }),
      ctx(),
    );
    expect(res.status).toBe(404);
  });

  it("400 when connection_id is missing", async () => {
    const res = await DELETE(makeRequest("DELETE", {}), ctx());
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  it("404 when caller is not can_manage member", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(mockConnectionsDeleteOne).not.toHaveBeenCalled();
  });

  it("best-effort: payload cleanup failure does not fail the request", async () => {
    mockPayloadsDeleteOne.mockRejectedValue(new Error("payload store unavailable"));
    const res = await DELETE(
      makeRequest("DELETE", { connection_id: "conn-1" }),
      ctx(),
    );
    // Still succeeds despite payload cleanup failure
    expect(res.status).toBe(200);
    expect(mockConnectionsDeleteOne).toHaveBeenCalledWith({ id: "conn-1" });
  });
});
