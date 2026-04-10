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
 * - No auth: request proceeds without Authorization header when session is null
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

jest.mock("next/server", () => ({
  NextRequest: Request,
  NextResponse: { json: (...args: unknown[]) => mockNextResponseJson(...args) },
}));

jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
const mockGetServerSession =
  jest.requireMock<{ getServerSession: jest.Mock }>("next-auth")
    .getServerSession;

jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

const mockGetInternalA2AUrl = jest.fn().mockReturnValue("http://test-supervisor:8000");
jest.mock("@/lib/config", () => ({
  getInternalA2AUrl: (...args: unknown[]) => mockGetInternalA2AUrl(...args),
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
    mockGetServerSession.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: true, status: 200, body: { tools: {} } }),
    );
  });

  // ── URL construction ──────────────────────────────────────────────────────

  it("calls getInternalA2AUrl() to build the supervisor URL", async () => {
    await GET();
    expect(mockGetInternalA2AUrl).toHaveBeenCalledTimes(1);
  });

  it("fetches from <internalUrl>/tools", async () => {
    mockGetInternalA2AUrl.mockReturnValue("http://internal-svc:9000");
    await GET();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://internal-svc:9000/tools",
      expect.any(Object),
    );
  });

  it("does NOT use getServerConfig() or caipeUrl", async () => {
    // getServerConfig is not exported from our mock — if the route tried to
    // call it the mock would throw 'not a function'.
    await expect(GET()).resolves.not.toThrow();
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

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { tools } });
  });

  it("defaults tools to {} when supervisor response omits the tools key", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: true, status: 200, body: {} }),
    );

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({ success: true, data: { tools: {} } });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it("returns 502 with success:false when supervisor returns a non-2xx status", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: false, status: 503, body: {} }),
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toContain("503");
  });

  it("returns 502 with the status code in the error message", async () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      makeFetchResponse({ ok: false, status: 401, body: {} }),
    );

    const res = await GET();
    const body = await res.json();

    expect(body.error).toMatch(/401/);
  });

  it("returns 502 when fetch throws a network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error).toBe("ECONNREFUSED");
  });

  it("returns 502 with 'Supervisor unreachable' when a non-Error is thrown", async () => {
    (global.fetch as jest.Mock).mockRejectedValue("timeout");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("Supervisor unreachable");
  });

  // ── Auth forwarding ───────────────────────────────────────────────────────

  it("forwards the OAuth2 access token as a Bearer header when a session exists", async () => {
    mockGetServerSession.mockResolvedValue({ accessToken: "tok-abc123" });

    await GET();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok-abc123",
    });
  });

  it("sends no Authorization header when session is null", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await GET();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("sends no Authorization header when session has no accessToken", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "a@b.com" } });

    await GET();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("continues without auth (no throw) when getServerSession rejects", async () => {
    mockGetServerSession.mockRejectedValue(new Error("session store unavailable"));

    await expect(GET()).resolves.toBeDefined();
    // fetch should still be called — auth failure is non-fatal
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── Accept header ─────────────────────────────────────────────────────────

  it("always sends Accept: application/json", async () => {
    await GET();
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });
});
