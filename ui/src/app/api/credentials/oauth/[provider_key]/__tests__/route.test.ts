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

  it("passes the user's chosen scopes to startConnection and stashes them in the state cookie", async () => {
    mockStartConnection.mockResolvedValue({
      authorizationUrl: "https://auth.atlassian.com/authorize?state=state-1",
      connectorId: "connector-1",
      requestedScopes: ["read:jira-work", "offline_access"],
    });
    const { GET } = await import("../connect/route");
    const response = await GET(
      new Request(
        "http://localhost/api/credentials/oauth/atlassian/connect?scopes=read:jira-work,offline_access",
      ) as never,
      { params: Promise.resolve({ provider_key: "atlassian" }) },
    );

    expect(mockStartConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: "atlassian",
        requestedScopes: ["read:jira-work", "offline_access"],
      }),
    );
    expect(response.status).toBe(302);

    const { parseOAuthStateCookie } = await import("@/lib/credentials/oauth-state");
    const cookieHeader = response.headers.get("set-cookie") ?? "";
    const cookieValue = cookieHeader.split("=")[1]?.split(";")[0] ?? "";
    expect(parseOAuthStateCookie(cookieValue).requestedScopes).toEqual([
      "read:jira-work",
      "offline_access",
    ]);
  });

  it("omits requestedScopes from the cookie when no advanced selection was made", async () => {
    mockStartConnection.mockResolvedValue({
      authorizationUrl: "https://github.example.com/oauth?state=state-1",
      connectorId: "connector-1",
      requestedScopes: ["repo"],
    });
    const { GET } = await import("../connect/route");
    const response = await GET(
      new Request("http://localhost/api/credentials/oauth/github/connect") as never,
      { params: Promise.resolve({ provider_key: "github" }) },
    );

    expect(mockStartConnection).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: undefined }),
    );
    const { parseOAuthStateCookie } = await import("@/lib/credentials/oauth-state");
    const cookieValue = (response.headers.get("set-cookie") ?? "").split("=")[1]?.split(";")[0] ?? "";
    expect(parseOAuthStateCookie(cookieValue).requestedScopes).toBeUndefined();
  });

  it("threads the stashed requestedScopes into completeConnection on callback", async () => {
    mockCompleteConnection.mockResolvedValue({ id: "c1", provider: "atlassian", status: "connected" });
    const { createOAuthStateCookie, oauthStateCookieName } = await import("@/lib/credentials/oauth-state");
    const cookie = createOAuthStateCookie({
      providerKey: "atlassian",
      ownerId: "alice-sub",
      state: "state-1",
      codeVerifier: "verifier-1",
      requestedScopes: ["read:jira-work", "offline_access"],
    });
    const { GET } = await import("../callback/route");
    await GET(
      new Request("http://localhost/api/credentials/oauth/atlassian/callback?code=code-1&state=state-1", {
        headers: { cookie: `${oauthStateCookieName("atlassian")}=${cookie}` },
      }) as never,
      { params: Promise.resolve({ provider_key: "atlassian" }) },
    );

    expect(mockCompleteConnection).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: ["read:jira-work", "offline_access"] }),
    );
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
    expect(text).toContain("GitHub connected");
    expect(text).toContain("/grid-neon-logo.svg");
    expect(text).not.toContain("Connecting GitHub to CAIPE");
    expect(text).not.toContain(">CAIPE / Grid<");
    expect(text).not.toContain("Saved");
    expect(text).not.toContain("Return to Credentials");
    expect(text).toContain("caipe.oauth.connection");
  });

  it("allows Webex (Pam) to complete on the shared Webex callback URL", async () => {
    mockCompleteConnection.mockResolvedValue({
      id: "provider-connection-1",
      provider: "webex_pam",
      status: "connected",
    });
    const { createOAuthStateCookie, oauthStateCookieName } = await import("@/lib/credentials/oauth-state");
    const cookie = createOAuthStateCookie({
      providerKey: "webex_pam",
      ownerId: "alice-sub",
      state: "state-1",
      codeVerifier: "verifier-1",
    });
    const { GET } = await import("../callback/route");
    const response = await GET(
      new Request("http://localhost/api/credentials/oauth/webex/callback?code=code-1&state=state-1", {
        headers: { cookie: `${oauthStateCookieName("webex_pam")}=${cookie}` },
      }) as never,
      { params: Promise.resolve({ provider_key: "webex" }) },
    );

    expect(mockCompleteConnection).toHaveBeenCalledWith({
      providerKey: "webex_pam",
      owner: { type: "user", id: "alice-sub" },
      code: "code-1",
      codeVerifier: "verifier-1",
    });
    expect(response.headers.get("set-cookie")).toContain("caipe_oauth_state_webex_pam=;");
    const text = await response.text();
    expect(text).toContain("Webex (Pam) connected");
  });

  it("renders a branded Webex failure page for provider OAuth errors", async () => {
    const { GET } = await import("../callback/route");
    const response = await GET(
      new Request("http://localhost/api/credentials/oauth/webex/callback?error=invalid_scope") as never,
      { params: Promise.resolve({ provider_key: "webex" }) },
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Webex connection failed");
    expect(text).toContain("/grid-neon-logo.svg");
    expect(text).not.toContain("/provider-logos/webex.svg");
    expect(text).not.toContain("Connecting Webex to CAIPE");
    expect(text).not.toContain(">CAIPE / Grid<");
    expect(text).not.toContain("Action needed");
    expect(text).not.toContain("Return to Credentials");
    expect(text).toContain("Webex returned invalid_scope. You can close this window.");
    expect(text).not.toContain("try again");
  });
});
