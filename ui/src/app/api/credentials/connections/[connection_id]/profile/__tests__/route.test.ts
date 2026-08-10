/**
 * @jest-environment node
 */

const mockGetAuthFromBearerOrSession = jest.fn();
const mockGetConnection = jest.fn();
const mockRefreshConnection = jest.fn();
const mockUpdateConnectionProfileSummary = jest.fn();

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
    getConnection: mockGetConnection,
    refreshConnection: mockRefreshConnection,
    updateConnectionProfileSummary: mockUpdateConnectionProfileSummary,
  })),
}));

function request() {
  return { headers: new Headers(), url: "http://localhost/api/credentials/connections/conn-1/profile" } as never;
}

describe("/api/credentials/connections/[connection_id]/profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockUpdateConnectionProfileSummary.mockResolvedValue(undefined);
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "github",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    mockRefreshConnection.mockResolvedValue({ accessToken: "fresh-token", expiresIn: 3600 });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ login: "alice", name: "Alice" }),
    })) as jest.Mock;
  });

  it("checks a connected GitHub profile without returning token material", async () => {
    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/user",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer fresh-token" }),
      }),
    );
    expect(json.data).toMatchObject({
      provider: "github",
      ok: true,
      profile: { login: "alice", name: "Alice" },
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("reports GitHub OAuth scope headers from the profile response", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: new Headers({
        "x-oauth-scopes": "repo, user",
        "x-accepted-oauth-scopes": "user",
      }),
      json: async () => ({ login: "alice", name: "Alice" }),
    })) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(json.data).toMatchObject({
      provider: "github",
      ok: true,
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        { id: "provider_profile", status: "passed" },
        {
          id: "github_oauth_scopes",
          label: "GitHub OAuth scopes",
          status: "passed",
          detail: "GitHub token grants repo, user; this endpoint accepts user.",
          action: "No action needed.",
        },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("checks a connected PagerDuty user profile without returning token material", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "pagerduty",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        user: {
          id: "PD123",
          name: "Alice",
          email: "alice@example.com",
          html_url: "https://example.pagerduty.com/users/PD123",
        },
      }),
    })) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.pagerduty.com/users/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/vnd.pagerduty+json;version=2",
          authorization: "Bearer fresh-token",
        }),
      }),
    );
    expect(json.data).toMatchObject({
      provider: "pagerduty",
      ok: true,
      profile: {
        id: "PD123",
        name: "Alice",
        email: "alice@example.com",
      },
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        { id: "provider_profile", label: "PagerDuty user profile", status: "passed" },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("checks a connected GitLab user profile without returning token material", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "gitlab",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 123,
        username: "alice",
        name: "Alice",
        email: "alice@example.com",
        web_url: "https://gitlab.com/alice",
      }),
    })) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/user",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer fresh-token" }),
      }),
    );
    expect(json.data).toMatchObject({
      provider: "gitlab",
      ok: true,
      profile: {
        id: 123,
        username: "alice",
        name: "Alice",
        web_url: "https://gitlab.com/alice",
      },
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        { id: "provider_profile", label: "GitLab user profile", status: "passed" },
      ],
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("returns clean PagerDuty 403 diagnostics without repeating the HTTP failure text", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "pagerduty",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    })) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(json.data).toMatchObject({
      provider: "pagerduty",
      ok: false,
      status: 403,
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        {
          id: "provider_profile",
          label: "PagerDuty user profile",
          status: "failed",
          detail: "PagerDuty returned HTTP 403.",
          action: "Relink PagerDuty and try the profile check again.",
        },
      ],
      next_action: "Relink PagerDuty and try the profile check again.",
    });
    expect(JSON.stringify(json)).not.toContain("PagerDuty returned HTTP 403: Profile check failed with HTTP 403.");
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("returns Webex 403 guidance that calls out people scope and account access", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "webex",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        message:
          "The server understood the request, but refused to fulfill it because the access token is missing required scopes or the user is missing required roles or licenses.",
      }),
    })) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(json.data).toMatchObject({
      provider: "webex",
      ok: false,
      status: 403,
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        {
          id: "provider_profile",
          label: "Webex user profile",
          status: "failed",
          action:
            "Verify the Webex integration includes spark:people_read, then relink Webex. If it still fails, confirm the Webex user can sign in and has the required role or license.",
        },
      ],
      next_action:
        "Verify the Webex integration includes spark:people_read, then relink Webex. If it still fails, confirm the Webex user can sign in and has the required role or license.",
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("falls back to Atlassian accessible resources when the User Identity profile is denied", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "atlassian",
      owner: { type: "user", id: "alice-sub" },
      status: "connected",
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "forbidden" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "cloud-1",
            name: "CAIPE",
            url: "https://caipe.atlassian.net",
            scopes: ["read:me", "read:jira-work"],
          },
        ],
      }) as jest.Mock;

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.atlassian.com/me",
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.atlassian.com/oauth/token/accessible-resources",
      expect.any(Object),
    );
    expect(json.data).toMatchObject({
      provider: "atlassian",
      ok: true,
      profile_check: { ok: false, status: 403 },
      accessible_resources: [{ id: "cloud-1", name: "CAIPE" }],
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "passed" },
        { id: "atlassian_accessible_resources", status: "passed" },
      ],
      next_action: "No action needed.",
    });
    expect(json.data.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provider_profile",
          status: "warning",
        }),
      ]),
    );
    expect(JSON.stringify(json)).not.toContain("Ask an Atlassian admin");
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("returns relink guidance when the provider token cannot be refreshed", async () => {
    mockRefreshConnection.mockRejectedValueOnce(new Error("invalid_grant"));

    const { POST } = await import("../route");
    const response = await POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(json.data).toMatchObject({
      provider: "github",
      ok: false,
      diagnostics: [
        { id: "connection_owner", status: "passed" },
        { id: "token_refresh", status: "failed" },
      ],
      next_action: "Relink GitHub to grant CAIPE a fresh refresh token.",
    });
    expect(JSON.stringify(json)).not.toContain("fresh-token");
  });

  it("denies checks for connections not owned by the signed-in user", async () => {
    mockGetConnection.mockResolvedValue({
      id: "conn-1",
      connectorId: "connector-1",
      provider: "github",
      owner: { type: "user", id: "other-sub" },
      status: "connected",
    });
    const { POST } = await import("../route");

    await expect(
      POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) }),
    ).resolves.toMatchObject({ status: 404 });
    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });
});
