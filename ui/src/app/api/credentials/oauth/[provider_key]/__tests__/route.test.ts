/**
 * @jest-environment node
 */

const mockStartConnection = jest.fn();
const mockCompleteConnection = jest.fn();
const mockGetProviderConnectionService = jest.fn();
const mockGetAuthFromBearerOrSession = jest.fn();
const mockFeatureConfig = jest.fn();

jest.mock("next/server", () => ({
  NextRequest: Request,
  NextResponse: {
    json: jest.fn((body: unknown, init?: ResponseInit) => ({
      body,
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
    })),
  },
}));

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: mockGetAuthFromBearerOrSession,
  };
});

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: mockFeatureConfig,
}));

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: mockGetProviderConnectionService,
}));

describe("/api/credentials/oauth/[provider_key]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatureConfig.mockReturnValue({ enabled: true });
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockGetProviderConnectionService.mockResolvedValue({
      startConnection: mockStartConnection,
      completeConnection: mockCompleteConnection,
    });
  });

  it("redirects to the provider authorization URL and sets the state cookie", async () => {
    mockStartConnection.mockResolvedValue({
      authorizationUrl: "https://github.example.com/oauth?state=state-1",
    });
    const { GET } = await import("../connect/route");
    const response = await GET(new Request("http://localhost/api/credentials/oauth/github/connect") as never, {
      params: Promise.resolve({ provider_key: "github" }),
    });

    expect(mockStartConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: "github",
        owner: { type: "user", id: "alice-sub" },
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.example.com/oauth?state=state-1");
    expect(response.headers.get("set-cookie")).toContain("caipe_oauth_state_github=");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("completes the callback with a closeable browser page", async () => {
    mockCompleteConnection.mockResolvedValue({
      id: "provider-connection-1",
      provider: "github",
      status: "connected",
    });
    const { createOAuthStateCookie, oauthStateCookieName } = await import("@/lib/credentials/oauth-state");
    const cookie = createOAuthStateCookie({
      providerKey: "github",
      ownerId: "alice-sub",
      state: "state-1",
      codeVerifier: "verifier-1",
    });
    const { GET } = await import("../callback/route");
    const response = await GET(
      new Request("http://localhost/api/credentials/oauth/github/callback?code=code-1&state=state-1", {
        headers: { cookie: `${oauthStateCookieName("github")}=${cookie}` },
      }) as never,
      { params: Promise.resolve({ provider_key: "github" }) },
    );

    expect(mockCompleteConnection).toHaveBeenCalledWith({
      providerKey: "github",
      owner: { type: "user", id: "alice-sub" },
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("set-cookie")).toContain("caipe_oauth_state_github=;");
    const text = await response.text();
    expect(text).toContain("Connection complete");
    expect(text).toContain("caipe.oauth.connection");
  });
});
