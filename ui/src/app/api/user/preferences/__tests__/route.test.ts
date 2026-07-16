/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetUserPreference = jest.fn();
const mockSetUserPreference = jest.fn();
const mockClearUserPreference = jest.fn();
const mockEvaluateAgentAccess = jest.fn();
const mockGetAuth = jest.fn();
const mockGetAgentsCollection = jest.fn();
const mockAgentsCollection = {
  findOne: jest.fn(),
};

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) => mockGetAuth(...args),
  };
});

jest.mock("@/lib/rbac/user-preferences-store", () => ({
  getUserPreference: (...args: unknown[]) => mockGetUserPreference(...args),
  setUserPreference: (...args: unknown[]) => mockSetUserPreference(...args),
  clearUserPreference: (...args: unknown[]) => mockClearUserPreference(...args),
}));

jest.mock("@/lib/rbac/pdp-shared", () => ({
  evaluateAgentAccess: (...args: unknown[]) => mockEvaluateAgentAccess(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetAgentsCollection(...args),
}));

import { GET, PUT } from "../route";

function makeRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/user/preferences", {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const authedSession = {
  user: { email: "alice@example.com", name: "Alice", role: "user" },
  session: { sub: "alice-sub", org: "default" },
};

describe("GET /api/user/preferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockResolvedValue(authedSession);
    mockGetAgentsCollection.mockResolvedValue(mockAgentsCollection);
  });

  it("returns the user's saved preference", async () => {
    mockGetUserPreference.mockResolvedValue({ dm_default_agent_id: "agent-x" });

    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { dm_default_agent_id: "agent-x" },
    });
    expect(mockGetUserPreference).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
    });
  });

  it("returns null when no preference is saved", async () => {
    mockGetUserPreference.mockResolvedValue({ dm_default_agent_id: null });

    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { dm_default_agent_id: null },
    });
  });

  it("rejects requests without a valid session", async () => {
    mockGetAuth.mockResolvedValue({
      user: { email: "x", name: "y", role: "user" },
      session: {},
    });

    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(401);
    expect(mockGetUserPreference).not.toHaveBeenCalled();
  });
});

describe("PUT /api/user/preferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuth.mockResolvedValue(authedSession);
    mockGetAgentsCollection.mockResolvedValue(mockAgentsCollection);
    mockAgentsCollection.findOne.mockResolvedValue({
      _id: "agent-x",
      name: "Agent X",
      enabled: true,
    });
  });

  it("saves a valid preference when the user has can_use on the agent", async () => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { dm_default_agent_id: "agent-x" },
    });
    expect(mockEvaluateAgentAccess).toHaveBeenCalledWith({
      subject: "alice-sub",
      agentId: "agent-x",
    });
    expect(mockSetUserPreference).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      agentId: "agent-x",
      field: "dm_default_agent_id",
    });
    expect(mockClearUserPreference).not.toHaveBeenCalled();
  });

  it("saves the web default independently of the DM default", async () => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { web_default_agent_id: "agent-x" },
    });
    expect(mockSetUserPreference).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      agentId: "agent-x",
      field: "web_default_agent_id",
    });
  });

  it("clears the preference when dm_default_agent_id is null", async () => {
    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: null }),
    );

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { dm_default_agent_id: null },
    });
    expect(mockClearUserPreference).toHaveBeenCalledWith(
      {
        tenantId: "default",
        userId: "alice-sub",
      },
      "dm_default_agent_id",
    );
    expect(mockSetUserPreference).not.toHaveBeenCalled();
    expect(mockEvaluateAgentAccess).not.toHaveBeenCalled();
  });

  it("clears only the web default when web_default_agent_id is null", async () => {
    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: null }),
    );

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { web_default_agent_id: null },
    });
    expect(mockClearUserPreference).toHaveBeenCalledWith(
      {
        tenantId: "default",
        userId: "alice-sub",
      },
      "web_default_agent_id",
    );
    expect(mockSetUserPreference).not.toHaveBeenCalled();
    expect(mockEvaluateAgentAccess).not.toHaveBeenCalled();
  });

  it("rejects a request that does not include a supported preference field", async () => {
    const response = await PUT(makeRequest("PUT", { unrelated: "agent-x" }));

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockSetUserPreference).not.toHaveBeenCalled();
    expect(mockClearUserPreference).not.toHaveBeenCalled();
  });

  it("returns 403 when the user does not have can_use on the chosen agent", async () => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    });

    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(403);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "FORBIDDEN_AGENT",
    });
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });

  it("returns 404 when the chosen agent does not exist", async () => {
    mockAgentsCollection.findOne.mockResolvedValue(null);
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(404);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "AGENT_NOT_FOUND",
    });
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed dm_default_agent_id (non-string non-null)", async () => {
    const response = await PUT(makeRequest("PUT", { dm_default_agent_id: 42 }));

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });

  it("returns 400 on agent id that fails the OpenFGA-safe pattern", async () => {
    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "../bad" }),
    );

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });

  it("returns 401 when no session subject is available", async () => {
    mockGetAuth.mockResolvedValue({
      user: { email: "x", name: "y", role: "user" },
      session: {},
    });

    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(401);
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });

  it("returns 502 if PDP throws unexpectedly", async () => {
    mockEvaluateAgentAccess.mockRejectedValue(new Error("OpenFGA down"));

    const response = await PUT(
      makeRequest("PUT", { dm_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(502);
    expect(mockSetUserPreference).not.toHaveBeenCalled();
  });
});
