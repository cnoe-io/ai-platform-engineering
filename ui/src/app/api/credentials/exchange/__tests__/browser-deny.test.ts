jest.mock("@/lib/api-middleware", () => {
  class ApiError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode = 500, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return {
    ApiError,
    successResponse: (data: unknown, status = 200) => ({
      status,
      json: async () => ({ success: true, data }),
    }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

const mockRefreshConnection = jest.fn();
const mockGetConnection = jest.fn();
const mockListConnections = jest.fn();
const mockValidateBearerJWT = jest.fn();
const mockRequireResourcePermission = jest.fn();

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    getConnection: mockGetConnection,
    listConnections: mockListConnections,
    refreshConnection: mockRefreshConnection,
  })),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateBearerJWT: (...args: unknown[]) => mockValidateBearerJWT(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: (...args: unknown[]) => mockRequireResourcePermission(...args),
}));

function request(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
    url: "http://localhost/api/credentials/exchange",
  } as never;
}

describe("/api/credentials/exchange browser guardrails", () => {
  beforeEach(() => {
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    mockValidateBearerJWT.mockResolvedValue({ sub: "alice-sub", email: "alice@example.test" });
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "github",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    mockListConnections.mockResolvedValue([
      {
        id: "atlassian-conn-1",
        connectorId: "connector-2",
        provider: "atlassian",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
      },
    ]);
    mockRequireResourcePermission.mockResolvedValue(undefined);
  });

  it("denies browser-origin exchange requests before provider token lookup", async () => {
    const { POST } = await import("../route");
    await expect(
      POST(
        request(
          { provider_connection_id: "conn-1", intended_use: "mcp_server" },
          {
            authorization: "Bearer browser-token",
            origin: "http://localhost:3000",
            "x-caipe-credential-caller": "dynamic_agent",
            "x-caipe-credential-audience": "caipe-credential-service",
          },
        ),
      ),
    ).rejects.toMatchObject({ reasonCode: "browser_request_denied" });
  });

  it("denies session-only and wrong-audience exchange requests", async () => {
    const { POST } = await import("../route");
    await expect(
      POST(
        request(
          { provider_connection_id: "conn-1", intended_use: "mcp_server" },
          {
            cookie: "next-auth.session-token=abc",
          },
        ),
      ),
    ).rejects.toMatchObject({ reasonCode: "browser_request_denied" });

    await expect(
      POST(
        request(
          { provider_connection_id: "conn-1", intended_use: "mcp_server" },
          {
            authorization: "Bearer service-token",
            "x-caipe-credential-caller": "dynamic_agent",
            "x-caipe-credential-audience": "wrong-audience",
          },
        ),
      ),
    ).rejects.toMatchObject({ reasonCode: "wrong_audience" });
  });

  it("exchanges a provider connection for a fresh access token for service callers", async () => {
    mockRefreshConnection.mockResolvedValue({ accessToken: "fresh-token", expiresIn: 3600 });
    const { POST } = await import("../route");
    const response = await POST(
      request(
        { provider_connection_id: "conn-1", intended_use: "mcp_server" },
        {
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        },
      ),
    );

    expect(mockValidateBearerJWT).toHaveBeenCalledWith("service-token");
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        provider: "github",
        provider_connection_id: "conn-1",
        access_token: "fresh-token",
        expires_in: 3600,
      },
    });
  });

  it("exchanges the JWT subject's provider connection by provider key", async () => {
    mockRefreshConnection.mockResolvedValue({ accessToken: "atlassian-user-token", expiresIn: 3600 });
    mockGetConnection.mockClear();
    const { POST } = await import("../route");

    const response = await POST(
      request(
        { provider: "atlassian", intended_use: "mcp_server" },
        {
          authorization: "Bearer user-obo-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        },
      ),
    );

    expect(mockValidateBearerJWT).toHaveBeenCalledWith("user-obo-token");
    expect(mockListConnections).toHaveBeenCalledWith({ type: "user", id: "alice-sub" });
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    expect(mockRefreshConnection).toHaveBeenCalledWith("atlassian-conn-1");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        provider: "atlassian",
        provider_connection_id: "atlassian-conn-1",
        access_token: "atlassian-user-token",
        expires_in: 3600,
      },
    });
  });

  it("requires OpenFGA use permission when the service caller is not the connection owner", async () => {
    mockValidateBearerJWT.mockResolvedValue({ sub: "agent-runtime-sub", email: "agent@example.test" });
    mockRefreshConnection.mockResolvedValue({ accessToken: "fresh-token", expiresIn: 3600 });
    const { POST } = await import("../route");

    await POST(
      request(
        { provider_connection_id: "conn-1", intended_use: "mcp_server" },
        {
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "mcp_runtime",
          "x-caipe-credential-audience": "caipe-credential-service",
        },
      ),
    );

    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: "agent-runtime-sub", user: { email: "agent@example.test" } },
      { type: "secret_ref", id: "provider_connection:conn-1", action: "use" },
    );
  });
});
