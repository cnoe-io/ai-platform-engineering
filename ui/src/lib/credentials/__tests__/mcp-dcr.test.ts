import { describe, expect, it, jest } from "@jest/globals";

import { discoverMcpOAuth, registerMcpDcrConnector } from "../mcp-dcr";
import type { OAuthConnectorMetadata } from "../oauth-service";

function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

const resourceMetadata = {
  resource: "https://grid.example.test/api/example/mcp",
  authorization_servers: ["https://grid.example.test/realms/example"],
  scopes_supported: ["openid", "profile", "offline_access"],
};

const authorizationMetadata = {
  issuer: "https://grid.example.test/realms/example",
  authorization_endpoint: "https://grid.example.test/realms/example/protocol/openid-connect/auth",
  token_endpoint: "https://grid.example.test/realms/example/protocol/openid-connect/token",
  registration_endpoint: "https://grid.example.test/realms/example/clients-registrations/openid-connect",
  scopes_supported: ["openid", "profile", "offline_access"],
  code_challenge_methods_supported: ["S256"],
};

describe("MCP OAuth dynamic client registration", () => {
  it("discovers protected-resource and authorization-server metadata from the MCP challenge", async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(
        mockResponse(null, 401, {
          "www-authenticate":
            'Bearer resource_metadata="https://grid.example.test/.well-known/oauth-protected-resource/api/example/mcp"',
        }),
      )
      .mockResolvedValueOnce(mockResponse(resourceMetadata))
      .mockResolvedValueOnce(mockResponse(authorizationMetadata));

    await expect(
      discoverMcpOAuth(
        { mcpUrl: "https://grid.example.test/api/example/mcp" },
        fetchImpl,
      ),
    ).resolves.toEqual({
      resource: "https://grid.example.test/api/example/mcp",
      resourceMetadataUrl:
        "https://grid.example.test/.well-known/oauth-protected-resource/api/example/mcp",
      issuer: "https://grid.example.test/realms/example",
      authorizationEndpoint:
        "https://grid.example.test/realms/example/protocol/openid-connect/auth",
      tokenEndpoint:
        "https://grid.example.test/realms/example/protocol/openid-connect/token",
      registrationEndpoint:
        "https://grid.example.test/realms/example/clients-registrations/openid-connect",
      scopes: ["openid", "profile", "offline_access"],
    });
  });

  it("registers a public PKCE client and persists a resource-bound connector", async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse(null, 401))
      .mockResolvedValueOnce(mockResponse(resourceMetadata))
      .mockResolvedValueOnce(mockResponse(authorizationMetadata))
      .mockResolvedValueOnce(
        mockResponse(
          {
            client_id: "generated-client",
            registration_access_token: "registration-token",
            registration_client_uri:
              "https://grid.example.test/realms/example/clients-registrations/openid-connect/generated-client",
          },
          201,
        ),
      );
    const metadata: OAuthConnectorMetadata = {
      id: "connector-1",
      name: "Example MCP",
      provider: "example-mcp",
      clientId: "generated-client",
      authorizationUrl: authorizationMetadata.authorization_endpoint,
      tokenUrl: authorizationMetadata.token_endpoint,
      scopes: resourceMetadata.scopes_supported,
      redirectUri: "https://grid-client.example.test/api/credentials/oauth/example-mcp/callback",
      resource: resourceMetadata.resource,
      source: "mcp_dcr",
      registrationEndpoint: authorizationMetadata.registration_endpoint,
      registrationClientUri:
        "https://grid.example.test/realms/example/clients-registrations/openid-connect/generated-client",
      enabled: true,
      pkce: true,
      createdAt: new Date("2026-08-08T00:00:00Z"),
      updatedAt: new Date("2026-08-08T00:00:00Z"),
      clientSecretConfigured: false,
    };
    const connectorService = {
      listConnectors: jest.fn(async () => [] as OAuthConnectorMetadata[]),
      createConnector: jest.fn(async () => metadata),
    };

    await expect(
      registerMcpDcrConnector({
        input: {
          name: "Example MCP",
          provider: "example-mcp",
          mcpUrl: "https://grid.example.test/api/example/mcp",
          redirectUri:
            "https://grid-client.example.test/api/credentials/oauth/example-mcp/callback",
        },
        connectorService,
        fetchImpl,
      }),
    ).resolves.toEqual(metadata);

    expect(connectorService.createConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "generated-client",
        pkce: true,
        resource: "https://grid.example.test/api/example/mcp",
        source: "mcp_dcr",
        registrationAccessToken: "registration-token",
      }),
    );
    const registrationRequest = fetchImpl.mock.calls[3];
    expect(registrationRequest[0]).toBe(authorizationMetadata.registration_endpoint);
    expect(JSON.parse(String(registrationRequest[1]?.body))).toMatchObject({
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [
        "https://grid-client.example.test/api/credentials/oauth/example-mcp/callback",
      ],
    });
  });

  it("rejects an authorization server that does not support PKCE S256", async () => {
    const fetchImpl = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(mockResponse(null, 401))
      .mockResolvedValueOnce(mockResponse(resourceMetadata))
      .mockResolvedValueOnce(
        mockResponse({
          ...authorizationMetadata,
          code_challenge_methods_supported: ["plain"],
        }),
      );

    await expect(
      discoverMcpOAuth(
        { mcpUrl: "https://grid.example.test/api/example/mcp" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "MCP_OAUTH_PKCE_UNSUPPORTED" });
  });
});
