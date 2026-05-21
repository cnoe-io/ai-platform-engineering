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
  return { headers: new Headers(), url: "http://localhost/api/credentials/connections/conn-1/profile" } as never;
}

describe("/api/credentials/connections/[connection_id]/profile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CAIPE_CREDENTIALS_ENABLED = "true";
    mockGetAuthFromBearerOrSession.mockResolvedValue({ session: { sub: "alice-sub" } });
    mockListConnections.mockResolvedValue([
      {
        id: "conn-1",
        connectorId: "connector-1",
        provider: "github",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
      },
    ]);
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

  it("falls back to Atlassian accessible resources when the User Identity profile is denied", async () => {
    mockListConnections.mockResolvedValue([
      {
        id: "conn-1",
        connectorId: "connector-1",
        provider: "atlassian",
        owner: { type: "user", id: "alice-sub" },
        status: "connected",
      },
    ]);
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
        { id: "provider_profile", status: "warning", http_status: 403 },
        { id: "atlassian_accessible_resources", status: "passed" },
      ],
    });
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
    mockListConnections.mockResolvedValue([]);
    const { POST } = await import("../route");

    await expect(
      POST(request(), { params: Promise.resolve({ connection_id: "conn-1" }) }),
    ).resolves.toMatchObject({ status: 404 });
    expect(mockRefreshConnection).not.toHaveBeenCalled();
  });
});
