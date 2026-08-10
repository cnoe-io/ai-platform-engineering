/**
 * @jest-environment node
 */
/**
 * Tests for the SA-caller path of POST /api/credentials/exchange.
 *
 * Verifies that a Keycloak service-account token (identity.isServiceAccount=true)
 * resolves connections keyed by owner.type="service_account" and passes the
 * cross-owner guard without requiring an explicit `use` permission when the
 * connection belongs to the calling subject.
 */

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

const SA_SUB = "sa-bot-sub-123";

const SA_CONN = {
  id: "sa-conn-1",
  connectorId: "connector-gitlab",
  provider: "gitlab",
  owner: { type: "service_account", id: SA_SUB },
  status: "connected",
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    json: async () => body,
    url: "http://localhost/api/credentials/exchange",
  } as never;
}

const SERVICE_HEADERS = {
  authorization: "Bearer sa-token",
  "x-caipe-credential-caller": "dynamic_agent",
  "x-caipe-credential-audience": "caipe-credential-service",
};

describe("/api/credentials/exchange — service account caller", () => {
  beforeEach(() => {
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    jest.clearAllMocks();
    // Identity is an SA (isServiceAccount: true)
    mockValidateBearerJWT.mockResolvedValue({
      sub: SA_SUB,
      email: `service-account-bot@keycloak.local`,
      isServiceAccount: true,
    });
    mockRefreshConnection.mockResolvedValue({ accessToken: "sa-fresh-token", expiresIn: 3600 });
    mockRequireResourcePermission.mockResolvedValue(undefined);
  });

  it("resolves connection by provider using service_account owner type", async () => {
    mockListConnections.mockResolvedValue([SA_CONN]);

    const { POST } = await import("../route");
    const response = await POST(
      request(
        { provider: "gitlab", intended_use: "mcp_server" },
        SERVICE_HEADERS,
      ),
    );

    // Must list by service_account owner, not user
    expect(mockListConnections).toHaveBeenCalledWith({
      type: "service_account",
      id: SA_SUB,
    });
    expect(mockRefreshConnection).toHaveBeenCalledWith("sa-conn-1");
    // Must NOT require extra permission (SA owns its own connection)
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        provider: "gitlab",
        provider_connection_id: "sa-conn-1",
        access_token: "sa-fresh-token",
        expires_in: 3600,
      },
    });
  });

  it("resolves connection by provider_connection_id for an SA caller", async () => {
    mockGetConnection.mockResolvedValue(SA_CONN);

    const { POST } = await import("../route");
    const response = await POST(
      request(
        { provider_connection_id: "sa-conn-1", intended_use: "mcp_server" },
        SERVICE_HEADERS,
      ),
    );

    expect(mockGetConnection).toHaveBeenCalledWith("sa-conn-1");
    expect(mockListConnections).not.toHaveBeenCalled();
    // SA is the owner → no requireResourcePermission
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { provider_connection_id: "sa-conn-1", access_token: "sa-fresh-token" },
    });
  });

  it("calls requireResourcePermission with isServiceAccount:true when SA fetches another principal's connection by id", async () => {
    // Connection belongs to a different service account
    mockGetConnection.mockResolvedValue({
      ...SA_CONN,
      owner: { type: "service_account", id: "other-sa-sub" },
    });

    const { POST } = await import("../route");
    await POST(
      request(
        { provider_connection_id: "sa-conn-1", intended_use: "mcp_server" },
        SERVICE_HEADERS,
      ),
    );

    // Must forward isServiceAccount:true so subjectFromSession graphs the caller
    // as `service_account:<sub>` — matching the OpenFGA tuple — not `user:<sub>`.
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      { sub: SA_SUB, user: { email: expect.any(String) }, isServiceAccount: true },
      { type: "secret_ref", id: "provider_connection:sa-conn-1", action: "use" },
    );
  });

  it("SA WITH a service_account secret_ref#use grant is allowed to fetch another principal's connection", async () => {
    // Connection belongs to a user, not the SA
    mockGetConnection.mockResolvedValue({
      ...SA_CONN,
      id: "user-conn-99",
      owner: { type: "user", id: "human-user-sub" },
    });
    // OpenFGA has granted service_account:<SA_SUB> can_use secret_ref:provider_connection:user-conn-99
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockRefreshConnection.mockResolvedValue({ accessToken: "delegated-token", expiresIn: 3600 });

    const { POST } = await import("../route");
    const response = await POST(
      request(
        { provider_connection_id: "user-conn-99", intended_use: "mcp_server" },
        SERVICE_HEADERS,
      ),
    );

    // requireResourcePermission must be called with isServiceAccount:true so the
    // correct service_account:<sub> subject is used in the OpenFGA check.
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.objectContaining({ sub: SA_SUB, isServiceAccount: true }),
      { type: "secret_ref", id: "provider_connection:user-conn-99", action: "use" },
    );
    // With the grant resolving, the request must succeed and return the token.
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        provider_connection_id: "user-conn-99",
        access_token: "delegated-token",
      },
    });
  });

  it("404 when no connected SA-owned connection exists for the provider", async () => {
    mockListConnections.mockResolvedValue([]); // No connection found

    const { POST } = await import("../route");
    await expect(
      POST(
        request({ provider: "gitlab", intended_use: "mcp_server" }, SERVICE_HEADERS),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: "CREDENTIAL_NOT_FOUND" });
  });

  it("user caller still uses user owner type (regression guard)", async () => {
    // A regular user identity (not an SA)
    mockValidateBearerJWT.mockResolvedValue({
      sub: "user-sub-42",
      email: "alice@example.test",
      isServiceAccount: false,
    });
    mockListConnections.mockResolvedValue([
      {
        id: "user-conn-1",
        connectorId: "connector-github",
        provider: "github",
        owner: { type: "user", id: "user-sub-42" },
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "user-token", expiresIn: 3600 });

    const { POST } = await import("../route");
    await POST(
      request({ provider: "github", intended_use: "mcp_server" }, SERVICE_HEADERS),
    );

    expect(mockListConnections).toHaveBeenCalledWith({
      type: "user",
      id: "user-sub-42",
    });
    expect(mockRequireResourcePermission).not.toHaveBeenCalled();
  });

  it("user caller fetching a cross-principal connection passes isServiceAccount:false (not true)", async () => {
    // User identity
    mockValidateBearerJWT.mockResolvedValue({
      sub: "user-sub-42",
      email: "alice@example.test",
      isServiceAccount: false,
    });
    // Connection belongs to a different user
    mockGetConnection.mockResolvedValue({
      id: "other-user-conn-5",
      connectorId: "connector-github",
      provider: "github",
      owner: { type: "user", id: "other-user-sub" },
      status: "connected",
    });
    mockRequireResourcePermission.mockResolvedValue(undefined);
    mockRefreshConnection.mockResolvedValue({ accessToken: "cross-token", expiresIn: 3600 });

    const { POST } = await import("../route");
    await POST(
      request(
        { provider_connection_id: "other-user-conn-5", intended_use: "mcp_server" },
        SERVICE_HEADERS,
      ),
    );

    // isServiceAccount must NOT be true — caller is a user, not a service account.
    expect(mockRequireResourcePermission).toHaveBeenCalledWith(
      expect.not.objectContaining({ isServiceAccount: true }),
      { type: "secret_ref", id: "provider_connection:other-user-conn-5", action: "use" },
    );
  });
});
