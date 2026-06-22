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

  it("resolves pinned connection for a non-owner with mcp_server use", async () => {
    getProviderConnectionService.mockResolvedValue({
      getConnection: jest.fn(async () => ({
        id: "conn-admin",
        provider: "atlassian",
        status: "connected",
        owner: { type: "user", id: "admin-sub" },
      })),
      refreshConnection: jest.fn(async () => ({ accessToken: "pinned-token", expiresIn: 3600 })),
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
      token: "pinned-token",
      provider: "atlassian",
      providerConnectionId: "conn-admin",
    });
    expect(requireResourcePermission).toHaveBeenCalledWith(
      { sub: "member-sub", user: { email: "member@caipe.local" } },
      { type: "mcp_server", id: "mcp-custom-jira", action: "use" },
    );
  });

  it("throws when pinned connection is disconnected", async () => {
    getProviderConnectionService.mockResolvedValue({
      getConnection: jest.fn(async () => ({
        id: "conn-admin",
        provider: "atlassian",
        status: "needs_reauth",
        owner: { type: "user", id: "admin-sub" },
      })),
    });

    await expect(
      resolveProviderConnectionCredential({
        session: { sub: "admin-sub", user: { email: "admin@caipe.local" } },
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
      }),
    ).rejects.toBeInstanceOf(McpCredentialUnavailableError);
  });
});
