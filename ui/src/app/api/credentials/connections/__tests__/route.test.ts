/**
 * @jest-environment node
 */

const mockListConnections = jest.fn();
const mockGetProviderConnectionService = jest.fn();
const mockGetAuthFromBearerOrSession = jest.fn();

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
  getProviderConnectionService: mockGetProviderConnectionService,
}));

function request() {
  return { headers: new Headers(), url: "http://localhost/api/credentials/connections" } as never;
}

describe("/api/credentials/connections", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockGetProviderConnectionService.mockResolvedValue({ listConnections: mockListConnections });
    mockListConnections.mockResolvedValue([{ id: "conn-1", provider: "github", status: "connected" }]);
  });

  it("lists provider connections for the authenticated user", async () => {
    const { GET } = await import("../route");
    const response = await GET(request());
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: "conn-1", provider: "github", status: "connected" }],
    });
    expect(mockListConnections).toHaveBeenCalledWith({ type: "user", id: "alice-sub" });
  });
});
