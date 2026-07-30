/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockGetAuthFromBearerOrSession = jest.fn();
const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: (...args: unknown[]) =>
      mockGetAuthFromBearerOrSession(...args),
  };
});

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: (...args: unknown[]) => mockListConnections(...args),
    refreshConnection: (...args: unknown[]) => mockRefreshConnection(...args),
  })),
}));

jest.mock("@/lib/feature-flags/credentials", () => ({
  getCredentialFeatureConfig: jest.fn(() => ({ enabled: true })),
}));

import { GET } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/projects/source-options for Atlassian", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthFromBearerOrSession.mockResolvedValue({
      session: { sub: "example-user" },
    });
    mockListConnections.mockResolvedValue([
      {
        id: "atlassian-connection",
        provider: "atlassian",
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({
      accessToken: "atlassian-token",
      expiresIn: 3600,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("merges favorites, recent spaces, and a bounded browse page without refetching duplicate sites", async () => {
    let browseCalls = 0;
    let favoriteCalls = 0;
    let recentCalls = 0;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.pathname === "/oauth/token/accessible-resources") {
        return jsonResponse([
          {
            id: "cloud-example",
            url: "https://example.atlassian.net",
          },
          {
            id: "cloud-example",
            url: "https://example.atlassian.net/wiki",
          },
        ]);
      }
      if (url.pathname === "/me") {
        return jsonResponse({ account_id: "account-example" });
      }
      if (url.pathname.endsWith("/wiki/api/v2/spaces")) {
        if (url.searchParams.get("favorited-by")) {
          favoriteCalls += 1;
          return jsonResponse({
            results: [
              { key: "CORE", name: "Core Workspace", type: "global" },
            ],
          });
        }
        browseCalls += 1;
        return jsonResponse({
          results: [
            { key: "DOCS", name: "Team Documentation", type: "global" },
          ],
        });
      }
      if (url.pathname.endsWith("/wiki/rest/api/search")) {
        recentCalls += 1;
        expect(url.searchParams.get("cql")).toBe(
          "type=space order by lastmodified desc",
        );
        return jsonResponse({
          results: [
            {
              title: "Recently Active",
              space: { key: "RECENT", name: "Recently Active" },
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://example.test/api/projects/source-options?provider=atlassian",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      connected: true,
      connectedTo: "example.atlassian.net",
      options: [
        {
          label: "Core Workspace (CORE)",
          value: "https://example.atlassian.net/wiki/spaces/CORE",
        },
        {
          label: "Recently Active (RECENT)",
          value: "https://example.atlassian.net/wiki/spaces/RECENT",
        },
        {
          label: "Team Documentation (DOCS)",
          value: "https://example.atlassian.net/wiki/spaces/DOCS",
        },
      ],
    });
    expect(favoriteCalls).toBe(1);
    expect(recentCalls).toBe(1);
    expect(browseCalls).toBe(1);
  });
});
