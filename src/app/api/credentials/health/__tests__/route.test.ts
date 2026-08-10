/**
 * @jest-environment node
 */

const mockGetAuthFromBearerOrSession = jest.fn();
const mockRequireBaselineAdminSurfaceRead = jest.fn(async () => undefined);
const mockGetCredentialDependencyHealth = jest.fn();
const mockGetCredentialFeatureConfig = jest.fn();

jest.mock("next/server", () => ({
  NextRequest: Request,
  NextResponse: {
    json: jest.fn((body: unknown, init?: ResponseInit) => ({ body, status: init?.status ?? 200 })),
  },
}));

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: mockGetAuthFromBearerOrSession,
  };
});

jest.mock("@/lib/credentials/health", () => ({
  getCredentialDependencyHealth: mockGetCredentialDependencyHealth,
}));

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: mockGetCredentialFeatureConfig,
}));

jest.mock("@/lib/mongodb", () => ({
  connectToDatabase: jest.fn(),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  isOpenFgaConfigured: jest.fn(() => true),
}));

jest.mock("@/lib/rbac/require-openfga", () => ({
  requireBaselineAdminSurfaceRead: mockRequireBaselineAdminSurfaceRead,
}));

describe("/api/credentials/health", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCredentialFeatureConfig.mockReturnValue({
      enabled: true,
      keyProvider: "dev-local",
      cmkId: "local",
    });
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "admin-sub" } });
    mockGetCredentialDependencyHealth.mockResolvedValue({
      feature_enabled: true,
      credential_store: "healthy",
      key_wrapper: "healthy",
      policy_service: "healthy",
    });
  });

  it("requires credentials admin read access", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request("http://localhost/api/credentials/health") as never);

    expect(mockRequireBaselineAdminSurfaceRead).toHaveBeenCalledWith({ sub: "admin-sub" }, "credentials");
    expect(response.status).toBe(200);
  });
});
