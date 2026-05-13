/**
 * @jest-environment node
 */
/**
 * Tests for GET /api/agents/tools
 *
 * The route proxies to the supervisor's /tools endpoint using the
 * internal (server-side) A2A URL, not the browser-facing public URL.
 *
 * Covers:
 * - Happy path: supervisor returns tool map → 200 with { success: true, data: { tools } }
 * - Supervisor returns non-2xx → 502 with { success: false, error }
 * - Fetch throws (network error / timeout) → 502 with { success: false, error }
 * - Auth forwarding: accessToken from session is sent as Bearer header
 * - No auth: request is rejected before proxying
 * - getInternalA2AUrl() is used (not getServerConfig().caipeUrl)
 * - Supervisor response missing `tools` key defaults to {}
 */

// ============================================================================
// Mocks — must be declared before any imports that reference them
// ============================================================================

const mockNextResponseJson = jest.fn(
  (data: unknown, init?: { status?: number }) => ({
    _isNextResponse: true,
    json: async () => data,
    status: init?.status ?? 200,
  }),
);
const mockCheckPermission = jest.fn();
const mockValidateBearerJWT = jest.fn();
const mockValidateLocalSkillsJWT = jest.fn();

jest.mock("next/server", () => ({
  NextRequest: Request,
  NextResponse: { json: (...args: unknown[]) => mockNextResponseJson(...args) },
}));

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
const mockGetServerSession =
  jest.requireMock<{ getServerSession: jest.Mock }>("next-auth")
    .getServerSession;

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
  REQUIRED_ADMIN_GROUP: "",
}));
jest.mock("@/lib/jwt-validation", () => ({
  validateBearerJWT: (...args: unknown[]) => mockValidateBearerJWT(...args),
  validateLocalSkillsJWT: (...args: unknown[]) => mockValidateLocalSkillsJWT(...args),
}));
jest.mock("@/lib/rbac/keycloak-authz", () => ({
  checkPermission: (...args: unknown[]) => mockCheckPermission(...args),
}));
jest.mock("@/lib/rbac/audit", () => ({
  logAuthzDecision: jest.fn(),
}));

const mockGetInternalA2AUrl = jest.fn().mockReturnValue("http://test-supervisor:8000");
jest.mock("@/lib/config", () => ({
  getInternalA2AUrl: (...args: unknown[]) => mockGetInternalA2AUrl(...args),
  getConfig: (key: string) => key === "ssoEnabled",
}));

jest.spyOn(console, "error").mockImplementation(() => {});
jest.spyOn(console, "warn").mockImplementation(() => {});

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal mock fetch response */
function makeFetchResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
}) {
  return Promise.resolve({
    ok: opts.ok,
    status: opts.status,
    json: async () => opts.body ?? {},
  });
}

function makeRequest(init: RequestInit = {}) {
  return new Request("http://localhost:3000/api/agents/tools", init);
}

// ============================================================================
// Subject under test
// ============================================================================

import { GET } from "../agents/tools/route";

// ============================================================================
// Tests
// ============================================================================

describe("GET /api/agents/tools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInternalA2AUrl.mockReturnValue("http://test-supervisor:8000");
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@example.com", name: "Admin" },
      role: "admin",
      accessToken: "tok-admin",
    });
    mockCheckPermission.mockResolvedValue({ allowed: true, reason: "OK" });
    mockValidateBearerJWT.mockResolvedValue({
      email: "bob@example.com",
      name: "Bob",
      sub: "bob-sub",
      org: "default",
    });
    mockValidateLocalSkillsJWT.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: true, status: 200, body: { tools: {} } }),
    );
  });

  // ── URL construction ──────────────────────────────────────────────────────

  it("calls getInternalA2AUrl() to build the supervisor URL", async () => {
    await GET(makeRequest());
    expect(mockGetInternalA2AUrl).toHaveBeenCalledTimes(1);
  });

  it("fetches from <internalUrl>/tools", async () => {
    mockGetInternalA2AUrl.mockReturnValue("http://internal-svc:9000");
    await GET(makeRequest());
    expect(global.fetch).toHaveBeenCalledWith(
      "http://internal-svc:9000/tools",
      expect.any(Object),
    );
  });

  it("does NOT use getServerConfig() or caipeUrl", async () => {
    // getServerConfig is not exported from our mock — if the route tried to
    // call it the mock would throw 'not a function'.
    await expect(GET(makeRequest())).resolves.not.toThrow();
    // And the fetch target should be the internal URL, not a public one
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("test-supervisor"),
      expect.any(Object),
    );
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns 200 with success:true and the tools map on a successful response", async () => {
    const tools = { argocd: ["list_apps", "sync_app"], github: ["get_pr"] };
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: true, status: 200, body: { tools } }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { tools } });
  });

  it("defaults tools to {} when supervisor response omits the tools key", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: true, status: 200, body: {} }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body).toEqual({ success: true, data: { tools: {} } });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 502 with success:false when supervisor returns a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: false, status: 503, body: {} }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toContain("503");
  });

  it("returns 502 with the status code in the error message", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: false, status: 401, body: {} }),
    );

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.error).toMatch(/401/);
  });

  it("returns 502 when fetch throws a network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toBe("ECONNREFUSED");
  });

  it("returns 502 with 'Supervisor unreachable' when a non-Error is thrown", async () => {
    (global.fetch as jest.Mock).mockRejectedValue("timeout");

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("Supervisor unreachable");
  });

  // ── Auth forwarding ───────────────────────────────────────────────────────

  it("forwards the OAuth2 access token as a Bearer header when a session exists", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@example.com", name: "Admin" },
      role: "admin",
      accessToken: "tok-abc123",
    });

    await GET(makeRequest());

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok-abc123",
    });
  });

  it("returns 401 and does not proxy when session is null", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.reason).toBe("not_signed_in");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 and does not proxy when session has no accessToken", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "a@b.com" } });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.reason).toBe("session_expired");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 403 and does not proxy when PDP denies bearer token access", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockCheckPermission.mockResolvedValueOnce({
      allowed: false,
      reason: "DENY_NO_CAPABILITY",
    });

    const res = await GET(makeRequest({ headers: { Authorization: "Bearer user-token" } }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.reason).toBe("pdp_denied");
    expect(body.code).toBe("mcp_server#read");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not proxy when getServerSession rejects", async () => {
    mockGetServerSession.mockRejectedValue(new Error("session store unavailable"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // ── Accept header ─────────────────────────────────────────────────────────

  it("always sends Accept: application/json", async () => {
    await GET(makeRequest());
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });
});
