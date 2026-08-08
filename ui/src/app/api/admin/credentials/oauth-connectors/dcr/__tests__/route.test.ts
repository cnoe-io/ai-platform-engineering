const mockRegisterMcpDcrConnector = jest.fn();
const mockConnectorService = {
  createConnector: jest.fn(),
  listConnectors: jest.fn(),
};

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
    getAuthFromBearerOrSession: jest.fn(async () => ({ session: { sub: "admin-sub" } })),
    successResponse: (data: unknown, status = 200) => ({
      status,
      json: async () => ({ success: true, data }),
    }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireAdminSurfaceManage: jest.fn(async () => undefined),
}));

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getOAuthConnectorService: jest.fn(async () => mockConnectorService),
}));

jest.mock("@/lib/credentials/mcp-dcr", () => ({
  registerMcpDcrConnector: mockRegisterMcpDcrConnector,
}));

function request(body: unknown) {
  return {
    json: async () => body,
    url: "https://caipe.example.test/api/admin/credentials/oauth-connectors/dcr",
  } as never;
}

describe("POST /api/admin/credentials/oauth-connectors/dcr", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    process.env.NEXTAUTH_URL = "https://caipe.example.test";
  });

  it("uses the canonical GRID callback when the admin omits redirectUri", async () => {
    const connector = {
      id: "connector-1",
      provider: "example-mcp",
      source: "mcp_dcr",
      pkce: true,
    };
    mockRegisterMcpDcrConnector.mockResolvedValue(connector);
    const { POST } = await import("../route");

    const response = await POST(
      request({
        name: "Example MCP",
        provider: "example-mcp",
        mcpUrl: "https://mcp.example.test/api/mcp",
      }),
    );

    expect(response.status).toBe(201);
    expect(mockRegisterMcpDcrConnector).toHaveBeenCalledWith({
      input: {
        name: "Example MCP",
        provider: "example-mcp",
        mcpUrl: "https://mcp.example.test/api/mcp",
        redirectUri:
          "https://caipe.example.test/api/credentials/oauth/example-mcp/callback",
      },
      connectorService: mockConnectorService,
    });
    await expect(response.json()).resolves.toEqual({ success: true, data: connector });
  });
});
