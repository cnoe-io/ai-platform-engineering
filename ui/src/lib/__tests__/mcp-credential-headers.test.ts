/**
 * @jest-environment node
 */

// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";

import {
  readMcpToolApplicationSuccess,
  resolveMcpHeaderCredentials,
} from "@/lib/mcp-credential-headers";

const mockRetrieve = jest.fn();
const mockGetCredentialRetrievalService = jest.fn();
const mockGetProviderConnectionService = jest.fn();
const mockRefreshConnection = jest.fn();
const mockListConnections = jest.fn();
const mockGetConnection = jest.fn();
const mockIsCredentialFeatureEnabled = jest.fn();

jest.mock("@/lib/credentials/retrieval-service-factory", () => ({
  getCredentialRetrievalService: (...args: unknown[]) => mockGetCredentialRetrievalService(...args),
}));

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: (...args: unknown[]) => mockGetProviderConnectionService(...args),
}));

jest.mock("@/lib/feature-flags/credentials", () => ({
  isCredentialFeatureEnabled: (...args: unknown[]) => mockIsCredentialFeatureEnabled(...args),
}));

jest.mock("@/lib/rbac/resource-authz", () => ({
  requireResourcePermission: jest.fn(),
}));

describe("mcp-credential-headers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCredentialRetrievalService.mockResolvedValue({ retrieve: mockRetrieve });
    mockGetProviderConnectionService.mockResolvedValue({
      listConnections: mockListConnections,
      getConnection: mockGetConnection,
      refreshConnection: mockRefreshConnection,
    });
    mockIsCredentialFeatureEnabled.mockReturnValue(true);
    mockRetrieve.mockResolvedValue({ credential: "secret-token" });
    mockListConnections.mockResolvedValue([
      {
        id: "atlassian-conn-1",
        provider: "atlassian",
        status: "connected",
        owner: { type: "user", id: "user-sub" },
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "atlassian-oauth-token", expiresIn: 3600 });
  });

  it("exchanges provider_connection credentials onto X-CAIPE-Provider-Token for AgentGateway", async () => {
    const request = new NextRequest("http://localhost:3000/api/mcp-servers/test-tool", { method: "POST" });
    const resolution = await resolveMcpHeaderCredentials({
      request,
      session: { sub: "user-sub", accessToken: "user-jwt" },
      viaAgentGateway: true,
      server: {
        _id: "jira",
        id: "jira",
        name: "Jira",
        transport: "http",
        enabled: true,
        credential_sources: [
          {
            kind: "provider_connection",
            target: "header",
            name: "X-CAIPE-Provider-Token",
            provider: "atlassian",
          },
        ],
      },
    });

    expect(resolution.headers.Authorization).toBe("Bearer user-jwt");
    expect(resolution.headers["X-CAIPE-Provider-Token"]).toBe("atlassian-oauth-token");
    expect(resolution.sources).toEqual([
      expect.objectContaining({
        kind: "provider_connection",
        origin: "provider_connection",
        provider: "atlassian",
        provider_connection_id: "atlassian-conn-1",
      }),
    ]);
    expect(mockRefreshConnection).toHaveBeenCalledWith("atlassian-conn-1");
  });

  it("reports origin none when no connected provider is available", async () => {
    mockListConnections.mockResolvedValue([]);
    const request = new NextRequest("http://localhost:3000/api/mcp-servers/test-tool", { method: "POST" });

    const resolution = await resolveMcpHeaderCredentials({
      request,
      session: { sub: "user-sub", accessToken: "user-jwt" },
      viaAgentGateway: true,
      server: {
        _id: "jira",
        id: "jira",
        name: "Jira",
        transport: "http",
        enabled: true,
        credential_sources: [
          {
            kind: "provider_connection",
            target: "header",
            name: "X-CAIPE-Provider-Token",
            provider: "atlassian",
          },
        ],
      },
    });

    expect(resolution.headers["X-CAIPE-Provider-Token"]).toBeUndefined();
    expect(resolution.sources[0]?.origin).toBe("none");
  });

  it("detects nested application failures in MCP tool payloads", () => {
    expect(
      readMcpToolApplicationSuccess({
        isError: false,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "Failed to fetch Jira issue",
            }),
          },
        ],
      }),
    ).toBe(false);
  });
});
