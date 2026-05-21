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

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    refreshConnection: mockRefreshConnection,
  })),
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

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        provider_connection_id: "conn-1",
        access_token: "fresh-token",
        expires_in: 3600,
      },
    });
  });
});
