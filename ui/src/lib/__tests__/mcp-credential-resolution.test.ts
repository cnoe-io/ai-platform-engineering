import { McpCredentialUnavailableError, resolveProviderConnectionCredential } from "@/lib/mcp-credential-resolution";

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(),
}));

jest.mock("@/lib/feature-flags/credentials", () => ({
  isCredentialFeatureEnabled: jest.fn(() => true),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(async () => undefined),
}));

const { getProviderConnectionService } = jest.requireMock("@/lib/credentials/oauth-service-factory");
const { requireResourcePermission } = jest.requireMock("@/lib/rbac/resource-authz");

describe("mcp-credential-resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves the caller's OWN connection for a provider-scoped source", async () => {
    const refreshConnection = jest.fn(async () => ({ accessToken: "alice-token", expiresIn: 3600 }));
    getProviderConnectionService.mockResolvedValue({
      listConnections: jest.fn(async () => [
        {
          id: "conn-alice",
          provider: "atlassian",
          status: "connected",
          owner: { type: "user", id: "alice-sub" },
        },
      ]),
      refreshConnection,
    });

    const token = await resolveProviderConnectionCredential({
      session: { sub: "alice-sub", user: { email: "alice@caipe.local" } },
      source: {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "caller",
        provider: "atlassian",
      },
      mcpServer: {
        _id: "mcp-custom-jira",
        credential_sources: [
          {
            kind: "provider_connection",
            target: "header",
            name: "X-CAIPE-Provider-Token",
            connection_scope: "caller",
            provider: "atlassian",
          },
        ],
      },
    });

    expect(token).toEqual({
      token: "alice-token",
      provider: "atlassian",
      providerConnectionId: "conn-alice",
    });
    // The caller owns the resolved connection, so no cross-user grant is required.
    expect(requireResourcePermission).not.toHaveBeenCalled();
    expect(refreshConnection).toHaveBeenCalledWith("conn-alice");
  });

  it("never reuses another user's pinned connection — resolves the CALLER's own instead", async () => {
    // A legacy id-only ("pinned") source references admin's connection, but the
    // caller is a different user. We must derive the provider from the referenced
    // connection and then resolve the CALLER's OWN connection — never admin's.
    const refreshConnection = jest.fn(async () => ({ accessToken: "member-token", expiresIn: 3600 }));
    getProviderConnectionService.mockResolvedValue({
      getConnection: jest.fn(async (id: string) => {
        expect(id).toBe("conn-admin");
        return {
          id: "conn-admin",
          provider: "atlassian",
          status: "connected",
          owner: { type: "user", id: "admin-sub" },
        };
      }),
      listConnections: jest.fn(async () => [
        {
          id: "conn-member",
          provider: "atlassian",
          status: "connected",
          owner: { type: "user", id: "member-sub" },
        },
      ]),
      refreshConnection,
    });

    const token = await resolveProviderConnectionCredential({
      session: { sub: "member-sub", user: { email: "member@caipe.local" } },
      source: {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "pinned",
        provider_connection_id: "conn-admin",
      },
      mcpServer: {
        _id: "mcp-custom-jira",
        credential_sources: [
          {
            kind: "provider_connection",
            target: "header",
            name: "X-CAIPE-Provider-Token",
            connection_scope: "pinned",
            provider_connection_id: "conn-admin",
          },
        ],
      },
    });

    expect(token).toEqual({
      token: "member-token",
      provider: "atlassian",
      providerConnectionId: "conn-member",
    });
    // Resolved the member's own connection — admin's token is never refreshed.
    expect(refreshConnection).toHaveBeenCalledWith("conn-member");
    expect(refreshConnection).not.toHaveBeenCalledWith("conn-admin");
    expect(requireResourcePermission).not.toHaveBeenCalled();
  });

  it("throws when the caller has no connected provider connection", async () => {
    getProviderConnectionService.mockResolvedValue({
      listConnections: jest.fn(async () => []),
    });

    await expect(
      resolveProviderConnectionCredential({
        session: { sub: "member-sub", user: { email: "member@caipe.local" } },
        source: {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          connection_scope: "caller",
          provider: "atlassian",
        },
        mcpServer: {
          _id: "mcp-custom-jira",
          credential_sources: [
            {
              kind: "provider_connection",
              target: "header",
              name: "X-CAIPE-Provider-Token",
              connection_scope: "caller",
              provider: "atlassian",
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(McpCredentialUnavailableError);
  });
});
