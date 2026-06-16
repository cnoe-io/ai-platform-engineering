/**
 * @jest-environment node
 */
/**
 * GET /api/admin/service-accounts/token-providers.
 *
 * The token-provider list is derived from ENABLED mcp_servers that declare a
 * `provider_connection` credential source. It powers the SA "Add a token"
 * dropdown — enabling only the GitLab MCP must yield only GitLab. It must NOT
 * leak disabled servers or non-provider_connection sources, and must be gated
 * by the credential feature flag + an authenticated session.
 */

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

const mockGetCollection = jest.fn();
jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

const mockIsServiceAccountTokensEnabled = jest.fn();
jest.mock("@/lib/feature-flags/credentials", () => ({
  isServiceAccountTokensEnabled: (...args: unknown[]) =>
    mockIsServiceAccountTokensEnabled(...args),
}));

const mockListOpenFgaObjects = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
}));

import { GET } from "../token-providers/route";

const SESSION = { sub: "caller-sub", user: { email: "caller@example.com" } };

function mockServers(docs: unknown[]) {
  mockGetCollection.mockResolvedValue({
    find: () => ({ toArray: async () => docs }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockIsServiceAccountTokensEnabled.mockReturnValue(true);
  // Caller is a member of at least one team by default (membership gate).
  mockListOpenFgaObjects.mockResolvedValue({ objects: ["team:platform-eng"] });
});

describe("GET /api/admin/service-accounts/token-providers", () => {
  it("returns distinct providers from enabled provider_connection sources", async () => {
    mockServers([
      {
        _id: "gitlab",
        enabled: true,
        credential_sources: [
          { kind: "provider_connection", provider: "gitlab", target: "header", name: "X-CAIPE-Provider-Token" },
        ],
      },
      {
        _id: "github",
        enabled: true,
        credential_sources: [
          { kind: "provider_connection", provider: "github", target: "header", name: "X-CAIPE-Provider-Token" },
        ],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Sorted by display name: GitHub then GitLab.
    expect(body.data).toEqual([
      { provider: "github", name: "GitHub" },
      { provider: "gitlab", name: "GitLab" },
    ]);
  });

  it("excludes disabled servers (only the query returns enabled, but guard the shape)", async () => {
    // The route queries { enabled: true } — simulate Mongo honoring it by only
    // returning the enabled doc.
    mockServers([
      {
        _id: "gitlab",
        enabled: true,
        credential_sources: [
          { kind: "provider_connection", provider: "gitlab", target: "header", name: "X-CAIPE-Provider-Token" },
        ],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.data).toEqual([{ provider: "gitlab", name: "GitLab" }]);
  });

  it("ignores credential sources that are not provider_connection or lack a provider", async () => {
    mockServers([
      {
        _id: "knowledge-base",
        enabled: true,
        credential_sources: [{ kind: "caller_token", target: "header", name: "X-CAIPE-Provider-Token" }],
      },
      {
        _id: "weird",
        enabled: true,
        credential_sources: [{ kind: "provider_connection", target: "header", name: "X" }], // no provider
      },
      {
        _id: "argocd",
        enabled: true,
        // no credential_sources at all
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.data).toEqual([]);
  });

  it("dedupes a provider declared by multiple servers", async () => {
    mockServers([
      {
        _id: "gitlab",
        enabled: true,
        credential_sources: [{ kind: "provider_connection", provider: "gitlab", target: "header", name: "X" }],
      },
      {
        _id: "gitlab-mirror",
        enabled: true,
        credential_sources: [{ kind: "provider_connection", provider: "gitlab", target: "header", name: "X" }],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.data).toEqual([{ provider: "gitlab", name: "GitLab" }]);
  });

  it("excludes providers not in the built-in set (POST would reject them)", async () => {
    mockServers([
      {
        _id: "gitlab",
        enabled: true,
        credential_sources: [{ kind: "provider_connection", provider: "gitlab", target: "header", name: "X" }],
      },
      {
        _id: "custom",
        enabled: true,
        // a provider invented in an MCP config that isn't a built-in connector
        credential_sources: [{ kind: "provider_connection", provider: "made-up-provider", target: "header", name: "X" }],
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(body.data).toEqual([{ provider: "gitlab", name: "GitLab" }]);
  });

  it("returns 404 (with code) when the service-account tokens feature is disabled", async () => {
    mockIsServiceAccountTokensEnabled.mockReturnValue(false);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.code).toBe("CREDENTIALS_DISABLED");
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no authenticated session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("returns 403 when the caller is a member of no team", async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: [] });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
    // Must not reach the mcp_servers query for an un-teamed caller.
    expect(mockGetCollection).not.toHaveBeenCalled();
  });
});
