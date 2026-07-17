/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetUserPreference = jest.fn();
const mockUpdateUserPreferences = jest.fn();
const mockEvaluateAgentAccess = jest.fn();
const mockGetAuth = jest.fn();
const mockGetAgentsCollection = jest.fn();
const mockGetResolvedPlatformDefaultAgentId = jest.fn();
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
  updateUserPreferences: (...args: unknown[]) => mockUpdateUserPreferences(...args),
}));

jest.mock("@/lib/rbac/pdp-shared", () => ({
  evaluateAgentAccess: (...args: unknown[]) => mockEvaluateAgentAccess(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetAgentsCollection(...args),
}));

jest.mock("@/lib/integration-config", () => ({
  getIntegrationAvailability: () => ({ slack: true, webex: false }),
}));

jest.mock("@/lib/platform-default-agent", () => ({
  getResolvedPlatformDefaultAgentId: () =>
    mockGetResolvedPlatformDefaultAgentId(),
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
    mockGetResolvedPlatformDefaultAgentId.mockResolvedValue("platform-agent");
  });

  it("returns the user's saved preference", async () => {
    mockGetUserPreference.mockResolvedValue({
      web_default_agent_id: "agent-web",
      slack_default_agent_id: "agent-slack",
      webex_default_agent_id: null,
    });

    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: {
        web_default_agent_id: "agent-web",
        slack_default_agent_id: "agent-slack",
        webex_default_agent_id: null,
        platform_default_agent_id: "platform-agent",
        integrations: { slack: true, webex: false },
      },
    });
    expect(mockGetUserPreference).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
    });
  });

  it("returns null when no preference is saved", async () => {
    mockGetUserPreference.mockResolvedValue({
      web_default_agent_id: null,
      slack_default_agent_id: null,
      webex_default_agent_id: null,
    });

    const response = await GET(makeRequest("GET"));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: {
        web_default_agent_id: null,
        slack_default_agent_id: null,
        webex_default_agent_id: null,
      },
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

  it("saves the Web preference when the user has can_use on the agent", async () => {
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
    expect(mockEvaluateAgentAccess).toHaveBeenCalledWith({
      subject: "alice-sub",
      agentId: "agent-x",
    });
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      preferences: { web_default_agent_id: "agent-x" },
    });
  });

  it.each([
    "slack_default_agent_id",
    "webex_default_agent_id",
  ] as const)("saves %s independently", async (field) => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(makeRequest("PUT", { [field]: "agent-x" }));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { [field]: "agent-x" },
    });
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      preferences: { [field]: "agent-x" },
    });
  });

  it("writes multiple validated surface defaults in one store update", async () => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(
      makeRequest("PUT", {
        web_default_agent_id: "agent-x",
        slack_default_agent_id: null,
        webex_default_agent_id: "agent-x",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUserPreferences).toHaveBeenCalledTimes(1);
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      preferences: {
        web_default_agent_id: "agent-x",
        slack_default_agent_id: null,
        webex_default_agent_id: "agent-x",
      },
    });
  });

  it("does not write any surface when a later field fails validation", async () => {
    mockEvaluateAgentAccess
      .mockResolvedValueOnce({
        allowed: true,
        path: "direct_user_grant",
        reasonCode: "ALLOW_DIRECT",
      })
      .mockResolvedValueOnce({
        allowed: false,
        path: "denied",
        reasonCode: "DENY_NO_CAPABILITY",
      });

    const response = await PUT(
      makeRequest("PUT", {
        web_default_agent_id: "agent-x",
        slack_default_agent_id: "agent-x",
      }),
    );

    expect(response.status).toBe(403);
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
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
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      preferences: { web_default_agent_id: null },
    });
    expect(mockEvaluateAgentAccess).not.toHaveBeenCalled();
  });

  it.each([
    "slack_default_agent_id",
    "webex_default_agent_id",
  ] as const)("clears only %s when it is null", async (field) => {
    const response = await PUT(makeRequest("PUT", { [field]: null }));

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: true,
      data: { [field]: null },
    });
    expect(mockUpdateUserPreferences).toHaveBeenCalledWith({
      tenantId: "default",
      userId: "alice-sub",
      preferences: { [field]: null },
    });
  });

  it("rejects a request that does not include a supported preference field", async () => {
    const response = await PUT(makeRequest("PUT", { unrelated: "agent-x" }));

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 403 when the user does not have can_use on the chosen agent", async () => {
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: false,
      path: "denied",
      reasonCode: "DENY_NO_CAPABILITY",
    });

    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(403);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "FORBIDDEN_AGENT",
    });
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 404 when the chosen agent does not exist", async () => {
    mockAgentsCollection.findOne.mockResolvedValue(null);
    mockEvaluateAgentAccess.mockResolvedValue({
      allowed: true,
      path: "direct_user_grant",
      reasonCode: "ALLOW_DIRECT",
    });

    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(404);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "AGENT_NOT_FOUND",
    });
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 400 on a malformed preference (non-string non-null)", async () => {
    const response = await PUT(makeRequest("PUT", { web_default_agent_id: 42 }));

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 400 on agent id that fails the OpenFGA-safe pattern", async () => {
    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "../bad" }),
    );

    expect(response.status).toBe(400);
    await expect(bodyOf(response)).resolves.toMatchObject({
      success: false,
      code: "INVALID_BODY",
    });
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 401 when no session subject is available", async () => {
    mockGetAuth.mockResolvedValue({
      user: { email: "x", name: "y", role: "user" },
      session: {},
    });

    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(401);
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });

  it("returns 502 if PDP throws unexpectedly", async () => {
    mockEvaluateAgentAccess.mockRejectedValue(new Error("OpenFGA down"));

    const response = await PUT(
      makeRequest("PUT", { web_default_agent_id: "agent-x" }),
    );

    expect(response.status).toBe(502);
    expect(mockUpdateUserPreferences).not.toHaveBeenCalled();
  });
});
