const mockCreateConnector = jest.fn();
const mockListConnectors = jest.fn();
const mockSetConnectorEnabled = jest.fn();
const mockTestConnector = jest.fn();

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
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "admin@example.test", name: "Admin", role: "admin" },
      session: { sub: "admin-sub" },
    })),
    successResponse: (data: unknown, status = 200) => ({
      status,
      json: async () => ({ success: true, data }),
    }),
    withErrorHandler: (handler: unknown) => handler,
  };
});

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireAdminSurfaceManage: jest.fn(async () => undefined),
  requireBaselineAdminSurfaceRead: jest.fn(async () => undefined),
}));

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getOAuthConnectorService: () => ({
    createConnector: mockCreateConnector,
    listConnectors: mockListConnectors,
    setConnectorEnabled: mockSetConnectorEnabled,
    testConnector: mockTestConnector,
  }),
}));

function request(method: string, body?: unknown) {
  return {
    method,
    headers: new Headers(body ? { "content-type": "application/json" } : undefined),
    json: async () => body,
    url: "http://localhost/api/admin/credentials/oauth-connectors",
  } as never;
}

describe("/api/admin/credentials/oauth-connectors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
  });

  it("lists configured OAuth connectors without client secrets", async () => {
    const { GET } = await import("../route");
    mockListConnectors.mockResolvedValue([
      {
        id: "connector-1",
        provider: "github",
        clientId: "client-id",
        clientSecretConfigured: true,
      },
    ]);

    const response = await GET(request("GET"));
    const json = await response.json();

    expect(json.data[0].clientSecret).toBeUndefined();
    expect(json.data[0].clientSecretRef).toBeUndefined();
    expect(json.data[0].clientSecretConfigured).toBe(true);
  });

  it("creates a dynamic connector through the admin-only API", async () => {
    const { POST } = await import("../route");
    mockCreateConnector.mockResolvedValue({
      id: "connector-1",
      provider: "github",
      clientSecretConfigured: true,
    });

    const response = await POST(
      request("POST", {
        name: "GitHub",
        provider: "github",
        clientId: "client-id",
        clientSecret: "client-secret",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo", "offline_access"],
        redirectUri: "https://caipe.example.com/api/credentials/oauth/callback",
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreateConnector).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "client-secret" }),
    );
    const json = await response.json();
    expect(JSON.stringify(json)).not.toContain("client-secret");
  });

  it("supports connector enable and test actions", async () => {
    const { PATCH } = await import("../[connector_id]/route");
    mockTestConnector.mockResolvedValue({ ok: true, connectorId: "connector-1" });

    await PATCH(request("PATCH", { action: "enable" }), {
      params: Promise.resolve({ connector_id: "connector-1" }),
    });
    expect(mockSetConnectorEnabled).toHaveBeenCalledWith("connector-1", true);

    const response = await PATCH(request("PATCH", { action: "test" }), {
      params: Promise.resolve({ connector_id: "connector-1" }),
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { ok: true, connectorId: "connector-1" },
    });
  });
});
