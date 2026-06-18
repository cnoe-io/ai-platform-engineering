/**
 * @jest-environment node
 *
 * Save-side endpoint normalisation regression.
 *
 * Background: every MCP server routed through AgentGateway must be
 * stored with a target-qualified endpoint
 * (`http://agentgateway:4000/mcp/<server_id>`). A bare
 * `http://agentgateway:4000/mcp` falls through to AgentGateway's `/mcp`
 * route, which is not registered, and returns 404 on every probe and
 * tool call. The class of bug surfaced in production as
 *   "Failed to connect to MCP server: HTTP 404 Not Found from
 *    http://agentgateway:4000/mcp"
 * on the Confluence card.
 *
 * The fix is server-side normalisation on save (POST + PUT) so this
 * class of misconfiguration can never persist again, plus a Python-side
 * read-time normaliser in dynamic-agents (defence in depth for legacy
 * rows). This suite pins the save-side half.
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockReconcileMcpServerRelationships = jest.fn();
const mockDeleteAllMcpServerRelationshipTuples = jest.fn();

const mockInsertOne = jest.fn();
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
    successResponse: (data: unknown, status = 200) =>
      Response.json({ success: true, data }, { status }),
    paginatedResponse: (items: unknown, total: number) =>
      Response.json({ success: true, data: { items, total } }),
    getPaginationParams: () => ({ page: 1, pageSize: 50, skip: 0 }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (err) {
          const e = err as { status?: number; message: string };
          return Response.json(
            { success: false, error: e.message },
            { status: e.status ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) =>
    mockRequireResourcePermission(...args),
  filterResourcesByPermission: (...args: unknown[]) =>
    mockFilterResourcesByPermission(...args),
}));

jest.mock("@/lib/rbac/openfga-owned-resources-reconcile", () => ({
  reconcileMcpServerRelationships: (...args: unknown[]) =>
    mockReconcileMcpServerRelationships(...args),
  deleteAllMcpServerRelationshipTuples: (...args: unknown[]) =>
    mockDeleteAllMcpServerRelationshipTuples(...args),
}));

function request(path: string, init: RequestInit & { body: string }): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

const session = { sub: "alice-sub", role: "admin" };
const user = { email: "alice@example.com", sub: "alice-sub" };

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  // Force a stable AgentGateway base for these tests. The normaliser
  // reads this via agentGatewayMcpEndpointUrl(), which is also exercised
  // by other test suites — set it here so test order doesn't matter.
  process.env.AGENT_GATEWAY_URL = "http://agentgateway:4000";

  mockGetAuthFromBearerOrSession.mockResolvedValue({ session, user });
  mockRequireResourcePermission.mockResolvedValue(undefined);
  mockReconcileMcpServerRelationships.mockResolvedValue(undefined);
  mockDeleteAllMcpServerRelationshipTuples.mockResolvedValue(undefined);

  mockGetCollection.mockResolvedValue({
    insertOne: mockInsertOne,
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
  });
});

describe("POST /api/mcp-servers — endpoint normalisation", () => {
  it("rewrites a bare AgentGateway endpoint to /mcp/<server_id> on create", async () => {
    mockFindOne.mockResolvedValue(null);
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({
          id: "confluence",
          name: "Confluence",
          transport: "http",
          // The exact bad input we see in production:
          endpoint: "http://agentgateway:4000/mcp",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    const persisted = mockInsertOne.mock.calls[0][0];
    // Normaliser must repair to the target-qualified URL.
    expect(persisted.endpoint).toBe(
      "http://agentgateway:4000/mcp/mcp-confluence",
    );
    expect(persisted._id).toBe("mcp-confluence");
  });

  it("leaves a direct upstream endpoint (non-gateway) untouched on create", async () => {
    mockFindOne.mockResolvedValue(null);
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({
          id: "custom-thing",
          name: "Custom Thing",
          transport: "http",
          endpoint: "https://mcp.example.com/mcp",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const persisted = mockInsertOne.mock.calls[0][0];
    expect(persisted.endpoint).toBe("https://mcp.example.com/mcp");
  });

  it("promotes a custom HTTP server to an AgentGateway-managed route on create", async () => {
    mockFindOne.mockResolvedValue(null);
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({
          id: "custom-thing",
          name: "Custom Thing",
          transport: "http",
          endpoint: "https://mcp.example.com/mcp",
          route_through_agentgateway: true,
          credential_sources: [
            {
              kind: "secret_ref",
              target: "header",
              name: "X-API-TOKEN",
              secret_ref: "secret-ref-id",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const persisted = mockInsertOne.mock.calls[0][0];
    expect(persisted).toEqual(
      expect.objectContaining({
        _id: "mcp-custom-thing",
        endpoint: "http://agentgateway:4000/mcp/mcp-custom-thing",
        source: "agentgateway",
        agentgateway_discovered: true,
        agentgateway_endpoint: "http://agentgateway:4000/mcp/mcp-custom-thing",
        agentgateway_target_endpoint: "https://mcp.example.com/mcp",
        config_driven: false,
        credential_sources: [
          {
            kind: "secret_ref",
            target: "header",
            name: "X-API-TOKEN",
            secret_ref: "secret-ref-id",
          },
        ],
      }),
    );
  });

  it("keeps a correctly-qualified gateway endpoint untouched on create", async () => {
    mockFindOne.mockResolvedValue(null);
    mockInsertOne.mockResolvedValue({ acknowledged: true });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify({
          id: "jira",
          name: "Jira",
          transport: "http",
          endpoint: "http://agentgateway:4000/mcp/mcp-jira",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const persisted = mockInsertOne.mock.calls[0][0];
    expect(persisted.endpoint).toBe("http://agentgateway:4000/mcp/mcp-jira");
  });
});

describe("PUT /api/mcp-servers?id=<id> — endpoint normalisation", () => {
  it("repairs a stale bare gateway endpoint when an admin re-saves the row", async () => {
    // Existing legacy row in Mongo with the broken bare endpoint.
    const existing = {
      _id: "mcp-confluence",
      name: "Confluence",
      transport: "http",
      endpoint: "http://agentgateway:4000/mcp",
      config_driven: false,
    };
    mockFindOne.mockResolvedValue(existing);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...existing,
      ...(update as { $set: Record<string, unknown> }).$set,
    }));
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-confluence", {
        method: "PUT",
        body: JSON.stringify({
          // Admin re-submits the same value (or any string).
          endpoint: "http://agentgateway:4000/mcp",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: { endpoint: string };
    };
    expect(updatePayload.$set.endpoint).toBe(
      "http://agentgateway:4000/mcp/mcp-confluence",
    );
  });

  it("does not touch the endpoint when the admin updates other fields", async () => {
    const existing = {
      _id: "mcp-jira",
      name: "Jira",
      transport: "http",
      endpoint: "http://agentgateway:4000/mcp/mcp-jira",
      config_driven: false,
    };
    mockFindOne.mockResolvedValue(existing);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...existing,
      ...(update as { $set: Record<string, unknown> }).$set,
    }));
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-jira", {
        method: "PUT",
        body: JSON.stringify({ name: "Jira (renamed)" }),
      }),
    );

    expect(response.status).toBe(200);
    const updatePayload = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    // No endpoint normalisation when the field wasn't sent.
    expect(updatePayload.$set).not.toHaveProperty("endpoint");
    expect(updatePayload.$set.name).toBe("Jira (renamed)");
  });

  it("repairs a wrong-id suffix (e.g. after a server rename)", async () => {
    const existing = {
      _id: "mcp-confluence",
      name: "Confluence",
      transport: "http",
      endpoint: "http://agentgateway:4000/mcp/atlassian-confluence",
      config_driven: false,
    };
    mockFindOne.mockResolvedValue(existing);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...existing,
      ...(update as { $set: Record<string, unknown> }).$set,
    }));
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-confluence", {
        method: "PUT",
        body: JSON.stringify({
          endpoint: "http://agentgateway:4000/mcp/atlassian-confluence",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const updatePayload = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: { endpoint: string };
    };
    expect(updatePayload.$set.endpoint).toBe(
      "http://agentgateway:4000/mcp/mcp-confluence",
    );
  });

  it("promotes a manual server to an AgentGateway-managed route on update", async () => {
    const existing = {
      _id: "mcp-custom-thing",
      name: "Custom Thing",
      transport: "http",
      endpoint: "https://mcp.example.com/mcp",
      config_driven: false,
    };
    mockFindOne.mockResolvedValue(existing);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...existing,
      ...(update as { $set: Record<string, unknown> }).$set,
    }));
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-custom-thing", {
        method: "PUT",
        body: JSON.stringify({
          endpoint: "https://mcp.example.com/mcp",
          route_through_agentgateway: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const updatePayload = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        endpoint: "http://agentgateway:4000/mcp/mcp-custom-thing",
        source: "agentgateway",
        agentgateway_discovered: true,
        agentgateway_endpoint: "http://agentgateway:4000/mcp/mcp-custom-thing",
        agentgateway_target_endpoint: "https://mcp.example.com/mcp",
        config_driven: false,
      }),
    );
  });

  it("detaches a user-owned AgentGateway route without making the row config-driven", async () => {
    const existing = {
      _id: "mcp-custom-thing",
      name: "Custom Thing",
      transport: "http",
      endpoint: "http://agentgateway:4000/mcp/mcp-custom-thing",
      source: "agentgateway",
      agentgateway_discovered: true,
      agentgateway_target_endpoint: "https://mcp.example.com/mcp",
      config_driven: false,
    };
    mockFindOne.mockResolvedValue(existing);
    mockFindOneAndUpdate.mockImplementation(async (_filter, update) => ({
      ...existing,
      ...(update as { $set: Record<string, unknown> }).$set,
    }));
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/mcp-servers?id=mcp-custom-thing", {
        method: "PUT",
        body: JSON.stringify({
          endpoint: "https://mcp.example.com/mcp",
          route_through_agentgateway: false,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const updatePayload = mockFindOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
      $unset: Record<string, "">;
    };
    expect(updatePayload.$set).toEqual(
      expect.objectContaining({
        endpoint: "https://mcp.example.com/mcp",
        source: "manual",
        agentgateway_discovered: false,
        config_driven: false,
      }),
    );
    expect(updatePayload.$unset).toEqual({
      agentgateway_endpoint: "",
      agentgateway_target_endpoint: "",
    });
  });
});
