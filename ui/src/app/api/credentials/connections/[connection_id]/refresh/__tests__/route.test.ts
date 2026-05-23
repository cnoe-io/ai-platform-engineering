/**
 * @jest-environment node
 */

const mockGetAuthFromBearerOrSession = jest.fn();
const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: mockGetAuthFromBearerOrSession,
  };
});

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: jest.fn(() => ({ enabled: true })),
}));

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: mockListConnections,
    refreshConnection: mockRefreshConnection,
  })),
}));

function request() {
  return { headers: new Headers(), url: "http://localhost/api/credentials/connections/conn-1/refresh" } as never;
}

describe("/api/credentials/connections/[connection_id]/refresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockListConnections.mockResolvedValue([
      {
        id: "conn-1",
        connectorId: "connector-1",
        provider: "atlassian",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "fresh-token", expiresIn: 3600 });
  });

  it("refreshes an owned connection without returning token material", async () => {
    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(mockRefreshConnection).toHaveBeenCalledWith("conn-1");
    expect(json.data).toEqual({
      id: "conn-1",
      provider: "atlassian",
      ok: true,
      expires_in: 3600,
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("does not refresh another user's connection", async () => {
    mockListConnections.mockResolvedValue([]);
    const { POST } = await import("../route");

    await expect(
      POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) }),
    ).resolves.toMatchObject({ status: 404 });
    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });
});
