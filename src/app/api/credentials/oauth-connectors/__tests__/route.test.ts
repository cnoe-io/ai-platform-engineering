/**
 * @jest-environment node
 */

const mockListConnectors = jest.fn();
const mockGetOAuthConnectorService = jest.fn();
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
  getOAuthConnectorService: mockGetOAuthConnectorService,
}));

function request() {
  return { headers: new Headers(), url: "http://localhost/api/credentials/oauth-connectors" } as never;
}

describe("/api/credentials/oauth-connectors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockGetOAuthConnectorService.mockResolvedValue({ listConnectors: mockListConnectors });
    mockListConnectors.mockResolvedValue([
      {
        id: "connector-1",
        name: "GitHub",
        provider: "github",
        clientId: "client-id",
        clientSecretConfigured: true,
        enabled: true,
        scopes: ["repo", "offline_access"],
      },
      {
        id: "connector-2",
        name: "Disabled",
        provider: "disabled",
        clientId: "disabled-client",
        clientSecretConfigured: true,
        enabled: false,
      },
    ]);
  });

  it("lists enabled OAuth connector metadata for authenticated users", async () => {
    const { GET } = await import("../route");
    const response = await GET(request());
    const json = await response.json();

    expect(json.data).toEqual([
      {
        id: "connector-1",
        name: "GitHub",
        provider: "github",
        enabled: true,
        scopes: ["repo", "offline_access"],
      },
    ]);
    expect(JSON.stringify(json)).not.toContain("client-id");
    expect(JSON.stringify(json)).not.toContain("clientSecret");
  });
});
