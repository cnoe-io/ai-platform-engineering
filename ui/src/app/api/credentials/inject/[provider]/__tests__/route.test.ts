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
    successResponse: (data: unknown, status = 200, init?: ResponseInit) => ({
      status,
      headers: new Headers(init?.headers),
      json: async () => ({ success: true, data }),
    }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();
const mockValidateBearerJWT = jest.fn();

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: mockListConnections,
    refreshConnection: mockRefreshConnection,
  })),
}));

jest.mock("@/lib/jwt-validation", () => ({
  validateBearerJWT: (...args: unknown[]) => mockValidateBearerJWT(...args),
}));

function request(headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    url: "http://localhost/api/credentials/inject/atlassian",
  } as never;
}

describe("/api/credentials/inject/[provider]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    mockValidateBearerJWT.mockResolvedValue({ sub: "alice-sub", email: "alice@example.test" });
    mockListConnections.mockResolvedValue([
      {
        id: "conn-atlassian",
        provider: "atlassian",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "atlassian-provider-token", expiresIn: 3600 });
  });

  it("returns provider token headers for AgentGateway using the JWT subject's connection", async () => {
    const { GET } = await import("../route");

    const response = await GET(
      request({
        authorization: "Bearer user-obo-token",
        "x-caipe-credential-caller": "agentgateway",
        "x-caipe-credential-audience": "caipe-credential-service",
      }),
      { params: Promise.resolve({ provider: "atlassian" }) },
    );

    expect(mockValidateBearerJWT).toHaveBeenCalledWith("user-obo-token");
    expect(mockListConnections).toHaveBeenCalledWith({ type: "user", id: "alice-sub" });
    expect(mockRefreshConnection).toHaveBeenCalledWith("conn-atlassian");
    expect(response.headers.get("x-caipe-provider-token")).toBe("atlassian-provider-token");
    expect(response.headers.get("x-caipe-provider-connection-id")).toBe("conn-atlassian");
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        ok: true,
        provider: "atlassian",
        provider_connection_id: "conn-atlassian",
        expires_in: 3600,
      },
    });
  });

  it("denies browser-shaped injector requests before token lookup", async () => {
    const { GET } = await import("../route");

    await expect(
      GET(
        request({
          authorization: "Bearer user-obo-token",
          origin: "http://localhost:3000",
          "x-caipe-credential-caller": "agentgateway",
          "x-caipe-credential-audience": "caipe-credential-service",
        }),
        { params: Promise.resolve({ provider: "atlassian" }) },
      ),
    ).rejects.toMatchObject({ reasonCode: "browser_request_denied" });

    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });

  it("denies non-AgentGateway caller types", async () => {
    const { GET } = await import("../route");

    await expect(
      GET(
        request({
          authorization: "Bearer user-obo-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        }),
        { params: Promise.resolve({ provider: "atlassian" }) },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });
});
