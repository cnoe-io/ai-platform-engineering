/**
 * @jest-environment node
 */
/**
 * BFF tests for custom MCP tool enforcement (spec 2026-06-03, US6):
 *   - POST /v1/mcp/invoke is gated on `mcp_tool#can_call` for CUSTOM tools;
 *     built-in tool names are not gated. Org admins bypass.
 *   - DELETE /v1/mcp/custom-tools/<id> removes ALL mcp_tool:<id> grants so no
 *     orphan tuples remain (FR-028).
 */

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));

import { NextRequest } from "next/server";

const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockDeleteAllMcpToolRelationshipTuples = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(message: string, public statusCode = 500, public code?: string) {
      super(message);
    }
  }
  return {
    ApiError,
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    handleApiError: (error: unknown) =>
      Response.json(
        {
          error: error instanceof Error ? error.message : "error",
          code: (error as { code?: string }).code,
        },
        { status: (error as { statusCode?: number }).statusCode ?? 500 },
      ),
  };
});

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  organizationObjectId: () => "organization:caipe",
}));

jest.mock("@/lib/rbac/openfga-owned-resources", () => ({
  reconcileKnowledgeBaseRelationships: jest.fn(),
  reconcileDataSourceRelationships: jest.fn(),
  reconcileMcpToolRelationships: jest.fn(),
  deleteAllMcpToolRelationshipTuples: (...args: unknown[]) =>
    mockDeleteAllMcpToolRelationshipTuples(...args),
}));

jest.mock("next-auth", () => ({
  getServerSession: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RAG_ADMIN_BYPASS_DISABLED;
  mockRequireRbacPermission.mockResolvedValue(undefined);
  mockRequireResourcePermission.mockResolvedValue(undefined);
  // Default: not org admin, and can_call denied unless a test allows it.
  mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
  mockDeleteAllMcpToolRelationshipTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 3 });
});

function ragRequest(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

async function asUser(sub = "alice-sub") {
  const nextAuth = await import("next-auth");
  jest.mocked(nextAuth.getServerSession).mockResolvedValue({
    sub,
    role: "user",
    org: "team-alpha",
    accessToken: "browser-token",
    user: { email: `${sub}@example.com` },
  } as never);
}

/** Mock the custom-tools list fetch (used to resolve which tool_names are custom). */
function mockCustomToolsList(toolIds: string[]) {
  global.fetch = jest.fn((url: string | URL) => {
    const u = String(url);
    if (u.includes("/v1/mcp/custom-tools")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => toolIds.map((id) => ({ tool_id: id })),
      } as Response);
    }
    // The downstream invoke forward.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tool_name: "x", success: true, result: {} }),
    } as Response);
  }) as jest.Mock;
}

describe("POST /v1/mcp/invoke — can_call gate", () => {
  const INVOKE = { params: Promise.resolve({ path: ["v1", "mcp", "invoke"] }) };

  it("denies a non-member invoking a custom tool with 403", async () => {
    await asUser("mallory-sub");
    mockCustomToolsList(["infra-search"]);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const { POST } = await import("@/app/api/rag/[...path]/route");
    const res = await POST(
      ragRequest("/api/rag/v1/mcp/invoke", {
        method: "POST",
        body: JSON.stringify({ tool_name: "infra-search", arguments: {} }),
        headers: { "content-type": "application/json" },
      }),
      INVOKE,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("mcp_tool#call");
  });

  it("allows a member invoking a custom tool they can_call", async () => {
    await asUser("alice-sub");
    mockCustomToolsList(["infra-search"]);
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) =>
      tuple.relation === "can_call" && tuple.object === "mcp_tool:infra-search"
        ? { allowed: true }
        : { allowed: false },
    );

    const { POST } = await import("@/app/api/rag/[...path]/route");
    const res = await POST(
      ragRequest("/api/rag/v1/mcp/invoke", {
        method: "POST",
        body: JSON.stringify({ tool_name: "infra-search", arguments: {} }),
        headers: { "content-type": "application/json" },
      }),
      INVOKE,
    );
    expect(res.status).toBe(200);
  });

  it("does NOT gate a built-in tool name (no mcp_tool object)", async () => {
    await asUser("alice-sub");
    mockCustomToolsList(["infra-search"]); // 'search' is NOT in the custom list
    // can_call would deny, but the built-in must not be gated → invocation proceeds.
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const { POST } = await import("@/app/api/rag/[...path]/route");
    const res = await POST(
      ragRequest("/api/rag/v1/mcp/invoke", {
        method: "POST",
        body: JSON.stringify({ tool_name: "search", arguments: {} }),
        headers: { "content-type": "application/json" },
      }),
      INVOKE,
    );
    expect(res.status).toBe(200);
  });

  it("allows org admins to bypass the can_call gate", async () => {
    await asUser("admin-sub");
    mockCustomToolsList(["infra-search"]);
    // Org-admin check (can_manage on organization) returns true; can_call denied.
    mockCheckOpenFgaTuple.mockImplementation(async (tuple: { relation: string; object: string }) =>
      tuple.relation === "can_manage" && tuple.object === "organization:caipe"
        ? { allowed: true }
        : { allowed: false },
    );

    const { POST } = await import("@/app/api/rag/[...path]/route");
    const res = await POST(
      ragRequest("/api/rag/v1/mcp/invoke", {
        method: "POST",
        body: JSON.stringify({ tool_name: "infra-search", arguments: {} }),
        headers: { "content-type": "application/json" },
      }),
      INVOKE,
    );
    expect(res.status).toBe(200);
  });

  it("fails CLOSED (503, no forward) when the custom-tools listing errors", async () => {
    await asUser("alice-sub");
    // The custom-tools listing fails — we cannot tell if `tool_name` is a
    // custom tool, so the gate must DENY rather than forward (deny-by-default),
    // so a transient error can't be used to bypass `can_call`.
    const forward = jest.fn();
    global.fetch = jest.fn((url: string | URL) => {
      const u = String(url);
      if (u.includes("/v1/mcp/custom-tools")) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response);
      }
      forward();
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    }) as jest.Mock;
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const { POST } = await import("@/app/api/rag/[...path]/route");
    const res = await POST(
      ragRequest("/api/rag/v1/mcp/invoke", {
        method: "POST",
        body: JSON.stringify({ tool_name: "infra-search", arguments: {} }),
        headers: { "content-type": "application/json" },
      }),
      INVOKE,
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("mcp_tool#call_unavailable");
    // Critically: the invocation was never forwarded to the RAG server.
    expect(forward).not.toHaveBeenCalled();
  });
});

describe("DELETE /v1/mcp/custom-tools/<id> — orphan tuple cleanup", () => {
  it("removes all mcp_tool:<id> grants after a successful upstream delete", async () => {
    await asUser("alice-sub");
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 204, json: async () => ({}) } as Response),
    ) as jest.Mock;

    const { DELETE } = await import("@/app/api/rag/[...path]/route");
    const res = await DELETE(
      ragRequest("/api/rag/v1/mcp/custom-tools/infra-search", { method: "DELETE" }),
      { params: Promise.resolve({ path: ["v1", "mcp", "custom-tools", "infra-search"] }) },
    );
    expect(res.status).toBe(204);
    expect(mockDeleteAllMcpToolRelationshipTuples).toHaveBeenCalledWith("infra-search");
  });
});
