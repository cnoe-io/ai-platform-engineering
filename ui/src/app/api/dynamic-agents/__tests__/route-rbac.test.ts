/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireRbacPermission = jest.fn();
const mockGetCollection = jest.fn();
const mockGetUserTeamIds = jest.fn();
const mockFilterResourcesByPermission = jest.fn();
const mockRequireResourcePermission = jest.fn();
const mockReconcileAgentRelationships = jest.fn();
const mockDeleteAllAgentToolTuples = jest.fn();
const mockAuthenticateRequest = jest.fn();
const mockGetDynamicAgentsConfig = jest.fn();
const mockProxyRequest = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public statusCode = 500,
      public code?: string,
    ) {
      super(message);
    }
  }

  return {
    ApiError,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuthFromBearerOrSession(...args),
    getPaginationParams: () => ({ page: 1, pageSize: 20, skip: 0 }),
    getUserTeamIds: (...args: unknown[]) => mockGetUserTeamIds(...args),
    paginatedResponse: (items: unknown[], total: number, page: number, pageSize: number) =>
      Response.json({ success: true, data: items, pagination: { total, page, pageSize } }),
    requireRbacPermission: (...args: unknown[]) => mockRequireRbacPermission(...args),
    successResponse: (data: unknown, status = 200) => Response.json({ success: true, data }, { status }),
    withErrorHandler:
      <T,>(handler: (request: NextRequest) => Promise<T>) =>
      async (request: NextRequest) => {
        try {
          return await handler(request);
        } catch (error) {
          return Response.json(
            {
              success: false,
              error: error instanceof Error ? error.message : "error",
              code: (error as { code?: string }).code,
            },
            { status: (error as { statusCode?: number }).statusCode ?? 500 },
          );
        }
      },
  };
});

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  filterResourcesByPermission: (...args: unknown[]) => mockFilterResourcesByPermission(...args),
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

jest.mock("@/lib/rbac/openfga-agent-tools", () => ({
  allowedToolsFromAgent: (agent: { allowed_tools?: Record<string, string[]> }) => agent.allowed_tools ?? {},
  deleteAllAgentToolTuples: (...args: unknown[]) => mockDeleteAllAgentToolTuples(...args),
  reconcileAgentRelationships: (...args: unknown[]) => mockReconcileAgentRelationships(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/da-proxy", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
  getDynamicAgentsConfig: (...args: unknown[]) => mockGetDynamicAgentsConfig(...args),
  proxyRequest: (...args: unknown[]) => mockProxyRequest(...args),
}));

function request(path: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), init);
}

const session = { sub: "alice-sub", role: "admin" };
const user = { email: "alice@example.com" };

describe("dynamic agents RBAC routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user, session });
    mockRequireRbacPermission.mockResolvedValue(undefined);
    mockGetUserTeamIds.mockResolvedValue(["team-a"]);
    mockFilterResourcesByPermission.mockImplementation(async (_session, items) => items);
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockReconcileAgentRelationships.mockResolvedValue(undefined);
    mockDeleteAllAgentToolTuples.mockResolvedValue(undefined);
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    mockAuthenticateRequest.mockResolvedValue({
      subject: "alice-sub",
      email: "alice@example.com",
      role: "admin",
      bearerToken: "token",
    });
    mockGetDynamicAgentsConfig.mockReturnValue({ dynamicAgentsUrl: "http://dynamic-agents:8000" });
    mockProxyRequest.mockResolvedValue(Response.json({ tools: [] }));
  });

  it("filters agent listings through can_discover by default", async () => {
    const agents = [
      { _id: "agent-visible", name: "Visible", model: { id: "m", provider: "p" } },
      { _id: "agent-hidden", name: "Hidden", model: { id: "m", provider: "p" } },
    ];
    mockFilterResourcesByPermission.mockResolvedValue([agents[0]]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(agents),
      }),
      countDocuments: jest.fn().mockResolvedValue(2),
    });
    const { GET } = await import("../route");

    const response = await GET(request("/api/dynamic-agents"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      agents,
      { type: "agent", action: "discover", id: expect.any(Function) },
    );
    expect(body).toMatchObject({
      success: true,
      data: [{ _id: "agent-visible" }],
      pagination: { total: 1, page: 1, pageSize: 20 },
    });
  });

  it("filters enabled-only agent listings through can_use", async () => {
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([{ _id: "agent-runtime", enabled: true }]),
      }),
      countDocuments: jest.fn().mockResolvedValue(1),
    });
    const { GET } = await import("../route");

    await GET(request("/api/dynamic-agents?enabled_only=true"));

    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      [{ _id: "agent-runtime", enabled: true }],
      { type: "agent", action: "use", id: expect.any(Function) },
    );
  });

  it("filters chat-available agents through OpenFGA can_use instead of legacy visibility", async () => {
    const agents = [
      {
        _id: "foo-bar",
        name: "Foo Bar",
        enabled: true,
        visibility: "team",
        shared_with_teams: ["team-a"],
      },
      {
        _id: "incident-agent",
        name: "Incident Agent",
        enabled: true,
        visibility: "global",
      },
    ];
    mockFilterResourcesByPermission.mockResolvedValue([agents[1]]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(agents),
      }),
    });
    const { GET } = await import("../available/route");

    const response = await GET(request("/api/dynamic-agents/available"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetUserTeamIds).not.toHaveBeenCalled();
    expect(mockGetCollection).toHaveBeenCalledWith("dynamic_agents");
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      agents,
      { type: "agent", action: "use", id: expect.any(Function) },
    );
    expect(body.data).toEqual([expect.objectContaining({ _id: "incident-agent" })]);
  });

  it("repairs the all-users default-agent OpenFGA grant before filtering chat-available agents", async () => {
    const agents = [{ _id: "agent-default", name: "Default Agent", enabled: true }];
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "platform_config") {
        return { findOne: jest.fn().mockResolvedValue({ default_agent_id: "agent-default" }) };
      }
      if (name === "dynamic_agents") {
        return {
          find: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue(agents),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    const { GET } = await import("../available/route");

    const response = await GET(request("/api/dynamic-agents/available"));

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:*", relation: "user", object: "agent:agent-default" }],
      deletes: [],
    });
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      agents,
      { type: "agent", action: "use", id: expect.any(Function) },
    );
  });

  it("repairs baseline member OpenFGA tuples before requiring chat-available agent view access", async () => {
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "platform_config") {
        return { findOne: jest.fn().mockResolvedValue({ default_agent_id: null }) };
      }
      if (name === "dynamic_agents") {
        return {
          find: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue([]),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    const { GET } = await import("../available/route");

    const response = await GET(request("/api/dynamic-agents/available"));

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:alice-sub", relation: "member", object: "organization:caipe" },
        { user: "user:alice-sub", relation: "reader", object: "admin_surface:users" },
      ]),
      deletes: [],
    });
    expect(mockRequireRbacPermission).not.toHaveBeenCalledWith(session, "dynamic_agent", "view");
  });

  it("repairs all-users grants for enabled global agents before chat availability filtering", async () => {
    const agents = [
      { _id: "global-agent", name: "Global Agent", enabled: true, visibility: "global" },
      { _id: "team-agent", name: "Team Agent", enabled: true, visibility: "team" },
    ];
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "platform_config") {
        return { findOne: jest.fn().mockResolvedValue({ default_agent_id: null }) };
      }
      if (name === "dynamic_agents") {
        return {
          find: jest.fn().mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            toArray: jest.fn().mockResolvedValue(agents),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    const { GET } = await import("../available/route");

    const response = await GET(request("/api/dynamic-agents/available"));

    expect(response.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:*", relation: "user", object: "agent:global-agent" }],
      deletes: [],
    });
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      agents,
      { type: "agent", action: "use", id: expect.any(Function) },
    );
  });

  it("filters agent editor LLM models through OpenFGA llm_model read checks", async () => {
    const models = [
      { _id: "openai/gpt-4o", model_id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" },
      { _id: "hidden/model", model_id: "hidden/model", name: "Hidden", provider: "test" },
    ];
    mockFilterResourcesByPermission.mockResolvedValue([models[0]]);
    mockGetCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(models),
      }),
    });
    const { GET } = await import("../models/route");

    const response = await GET(request("/api/dynamic-agents/models"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireRbacPermission).not.toHaveBeenCalledWith(session, "dynamic_agent", "view");
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      models,
      { type: "llm_model", action: "read", id: expect.any(Function) },
    );
    expect(body.data).toEqual([
      expect.objectContaining({ model_id: "openai/gpt-4o", name: "GPT-4o" }),
    ]);
  });

  it("filters configurable subagents through OpenFGA can_use after cycle checks", async () => {
    const agents = [
      { _id: "parent", name: "Parent", enabled: true },
      { _id: "allowed-child", name: "Allowed Child", enabled: true },
      { _id: "denied-child", name: "Denied Child", enabled: true },
      {
        _id: "ancestor",
        name: "Ancestor",
        enabled: true,
        subagents: [{ agent_id: "parent", name: "parent", description: "parent" }],
      },
    ];
    mockFilterResourcesByPermission.mockResolvedValue([agents[1]]);
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(agents[0]),
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(agents),
      }),
    });
    const { GET } = await import("../available-subagents/route");

    const response = await GET(request("/api/dynamic-agents/available-subagents?id=parent"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      session,
      { type: "agent", id: "parent", action: "write" },
    );
    expect(mockFilterResourcesByPermission).toHaveBeenCalledWith(
      session,
      [agents[1], agents[2]],
      { type: "agent", action: "use", id: expect.any(Function) },
    );
    expect(body.data.agents).toEqual([
      expect.objectContaining({ id: "allowed-child", name: "Allowed Child" }),
    ]);
  });

  it("requires owner team and writes agent relationship tuples before creating an agent", async () => {
    const insertOne = jest.fn();
    const dynamicAgents = {
      findOne: jest.fn().mockResolvedValue(null),
      insertOne,
    };
    const teams = {
      findOne: jest.fn().mockResolvedValue({
        _id: "team-id",
        slug: "platform",
        members: [{ user_id: "alice@example.com", role: "admin" }],
      }),
    };
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "dynamic_agents") return dynamicAgents;
      if (name === "teams") return teams;
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          allowed_tools: { rag: ["query"] },
          owner_team_slug: "platform",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockReconcileAgentRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-operations-helper",
        ownerSubject: "alice-sub",
        ownerTeamSlug: "platform",
        organizationId: "caipe",
      }),
    );
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_team_slug: "platform",
        owner_team_id: "team-id",
        owner_subject: "alice-sub",
      }),
    );
  });

  it("allows users to create private agents without an owner team", async () => {
    const insertOne = jest.fn();
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "dynamic_agents") {
        return {
          findOne: jest.fn().mockResolvedValue(null),
          insertOne,
        };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          visibility: "private",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockReconcileAgentRelationships).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-operations-helper",
        ownerSubject: "alice-sub",
        ownerTeamSlug: null,
      }),
    );
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "private",
        owner_subject: "alice-sub",
        owner_team_slug: undefined,
      }),
    );
  });

  it("returns 404 when the requested owner team does not exist", async () => {
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "teams") return { findOne: jest.fn().mockResolvedValue(null) };
      if (name === "dynamic_agents") return { findOne: jest.fn().mockResolvedValue(null), insertOne: jest.fn() };
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          owner_team_slug: "missing",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "OWNER_TEAM_NOT_FOUND" });
    expect(mockReconcileAgentRelationships).not.toHaveBeenCalled();
  });

  it("allows a scoped owner-team member to create an agent for that team", async () => {
    const insertOne = jest.fn();
    mockRequireResourcePermission.mockImplementation(async (_session, resource: { type?: string }) => {
      if (resource.type === "organization") throw new Error("not platform admin");
    });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "teams") {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: "team-id",
            slug: "platform",
            members: [{ user_id: "alice@example.com", role: "member" }],
          }),
        };
      }
      if (name === "dynamic_agents") return { findOne: jest.fn().mockResolvedValue(null), insertOne };
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          owner_team_slug: "platform",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      session,
      { type: "team", id: "platform", action: "use" },
    );
    expect(insertOne).toHaveBeenCalled();
  });

  it("requires a stable subject before writing dynamic agent owner tuples", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      user,
      session: { ...session, sub: "" },
    });
    const insertOne = jest.fn();
    mockRequireResourcePermission.mockImplementation(async (_session, resource: { type?: string }) => {
      if (resource.type === "organization") throw new Error("not platform admin");
    });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "dynamic_agents") return { findOne: jest.fn().mockResolvedValue(null), insertOne };
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(mockReconcileAgentRelationships).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-admin selects an owner team they do not belong to", async () => {
    const insertOne = jest.fn();
    mockRequireResourcePermission.mockImplementation(async (_session, resource: { type?: string }) => {
      if (resource.type === "organization") throw new Error("not platform admin");
      if (resource.type === "team") throw Object.assign(new Error("not team member"), { statusCode: 403 });
    });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "teams") {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: "team-id",
            slug: "platform",
            members: [{ user_id: "bob@example.com", role: "member" }],
          }),
        };
      }
      if (name === "dynamic_agents") return { findOne: jest.fn().mockResolvedValue(null), insertOne };
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          owner_team_slug: "platform",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "OWNER_TEAM_FORBIDDEN" });
    expect(insertOne).not.toHaveBeenCalled();
    expect(mockReconcileAgentRelationships).not.toHaveBeenCalled();
  });

  it("does not fall back to Mongo membership when OpenFGA denies owner-team use", async () => {
    const insertOne = jest.fn();
    mockRequireResourcePermission.mockImplementation(async (_session, resource: { type?: string }) => {
      if (resource.type === "organization") throw new Error("not platform admin");
      if (resource.type === "team") throw Object.assign(new Error("not team member"), { statusCode: 403 });
    });
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "teams") {
        return {
          findOne: jest.fn().mockResolvedValue({
            _id: "team-id",
            slug: "platform",
            members: [{ user_id: "alice@example.com", role: "member" }],
          }),
        };
      }
      if (name === "dynamic_agents") return { findOne: jest.fn().mockResolvedValue(null), insertOne };
      throw new Error(`unexpected collection ${name}`);
    });
    const { POST } = await import("../route");

    const response = await POST(
      request("/api/dynamic-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Operations Helper",
          system_prompt: "Help ops",
          model: { id: "gpt-4.1", provider: "openai" },
          owner_team_slug: "platform",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "OWNER_TEAM_FORBIDDEN" });
    expect(insertOne).not.toHaveBeenCalled();
    expect(mockReconcileAgentRelationships).not.toHaveBeenCalled();
  });

  it("requires agent write access before updating an agent document", async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue({ _id: "agent-1", name: "Renamed" });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ _id: "agent-1", name: "Original", allowed_tools: {} }),
      findOneAndUpdate,
    });
    const { PUT } = await import("../route");

    const response = await PUT(
      request("/api/dynamic-agents?id=agent-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      session,
      { type: "agent", id: "agent-1", action: "write" },
    );
    expect(findOneAndUpdate).toHaveBeenCalled();
  });

  it("requires agent delete access before deleting an agent document", async () => {
    const deleteOne = jest.fn();
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ _id: "agent-1", is_system: false, config_driven: false }),
      deleteOne,
    });
    const { DELETE } = await import("../route");

    const response = await DELETE(request("/api/dynamic-agents?id=agent-1", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      session,
      { type: "agent", id: "agent-1", action: "delete" },
    );
    expect(mockDeleteAllAgentToolTuples).toHaveBeenCalledWith("agent-1");
    expect(deleteOne).toHaveBeenCalledWith({ _id: "agent-1" });
  });

  // Built-in tool metadata is the same kind of static, system-wide
  // catalog as the AI Assist task list: every signed-in user who can
  // open the Create Agent wizard needs to render the picker, regardless
  // of organization role or per-tool grants. Gating it on a
  // `tool:dynamic-agents-builtin#can_discover` tuple that nothing ever
  // seeds is what produced "Failed to load tools: Failed to fetch: 403"
  // for admins on the agent builder screen. Pin the new contract here:
  // authenticate the caller, do NOT call OpenFGA, and proxy through.
  it("proxies built-in tool metadata for any authenticated caller without an OpenFGA gate", async () => {
    const { GET } = await import("../builtin-tools/route");

    const response = await GET(request("/api/dynamic-agents/builtin-tools"));

    expect(response.status).toBe(200);
    // Authentication still required — the route must not silently allow
    // anonymous traffic to enumerate the supported built-in tools list.
    expect(mockAuthenticateRequest).toHaveBeenCalledTimes(1);
    // No per-tool OpenFGA check for the built-in catalog. The route only
    // hands off to DA with the caller's bearer token.
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockProxyRequest).toHaveBeenCalledWith(
      "http://dynamic-agents:8000/api/v1/builtin-tools",
      "GET",
      expect.objectContaining({ subject: "alice-sub" }),
      "[builtin-tools]",
    );
  });

  it("rejects unauthenticated callers on built-in tool metadata", async () => {
    // Real-world denial path from `authenticateRequest`: returns a
    // NextResponse (not a plain Response). The route uses `instanceof`
    // to short-circuit, so the mock must match the real type.
    const { NextResponse } = await import("next/server");
    mockAuthenticateRequest.mockResolvedValueOnce(
      NextResponse.json(
        { success: false, error: "not signed in", code: "NOT_SIGNED_IN" },
        { status: 401 },
      ),
    );
    const { GET } = await import("../builtin-tools/route");

    const response = await GET(request("/api/dynamic-agents/builtin-tools"));

    expect(response.status).toBe(401);
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockProxyRequest).not.toHaveBeenCalled();
  });
});
