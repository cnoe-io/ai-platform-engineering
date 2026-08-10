/**
 * @jest-environment node
 *
 * PRC-4 — GET /api/integrations/unlinked-service-account
 *
 * Contract:
 *  1. 401 when unauthenticated (no bearer token, no session).
 *  2. 200 with { success: true, data: { sa_sub: "<sub>" } } for any authed caller.
 *  3. 200 with { success: true, data: { sa_sub: null } } when SA is not bootstrapped.
 *  4. Never returns credential material (client_secret, client_uuid).
 *  5. 503 when getUnlinkedServiceAccount throws.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

// ── Auth mock ────────────────────────────────────────────────────────────────
const mockGetAuthFromBearerOrSession = jest.fn();
jest.mock("@/lib/api-middleware", () => ({
  ...jest.requireActual("@/lib/api-middleware"),
  getAuthFromBearerOrSession: (...args: unknown[]) =>
    mockGetAuthFromBearerOrSession(...args),
}));

// ── SA resolver mock ─────────────────────────────────────────────────────────
const mockGetUnlinkedServiceAccount = jest.fn();
jest.mock("@/lib/rbac/unlinked-service-account", () => ({
  getUnlinkedServiceAccount: () => mockGetUnlinkedServiceAccount(),
}));

import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api-middleware";
import { GET } from "../route";

const SESSION = { sub: "bot-sub", user: { email: "slack-bot@sa.internal" } };

const ANON_SA_DOC = {
  sa_sub: "anon-sub-xyz",
  client_id: "caipe-sa-unlinked-abc",
  client_uuid: "kc-uuid-secret",
  client_secret: "never-expose-this",
  name: "unlinked",
  owning_team_id: "super-admins",
  is_platform_unlinked: true,
  status: "active" as const,
};

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/integrations/unlinked-service-account", {
    method: "GET",
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/integrations/unlinked-service-account", () => {
  it("401 when unauthenticated (getAuthFromBearerOrSession throws)", async () => {
    mockGetAuthFromBearerOrSession.mockRejectedValue(
      new ApiError("Not signed in", 401),
    );

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/unauthorized/i);
    expect(mockGetUnlinkedServiceAccount).not.toHaveBeenCalled();
  });

  it("200 with sa_sub for any authenticated caller", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: SESSION.user, session: SESSION });
    mockGetUnlinkedServiceAccount.mockResolvedValue(ANON_SA_DOC);

    const res = await GET(makeRequest("Bearer sa-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sa_sub).toBe("anon-sub-xyz");
  });

  it("200 with sa_sub null when SA is not bootstrapped", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: SESSION.user, session: SESSION });
    mockGetUnlinkedServiceAccount.mockResolvedValue(null);

    const res = await GET(makeRequest("Bearer sa-token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.sa_sub).toBeNull();
  });

  it("never returns credential material (client_secret, client_uuid)", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: SESSION.user, session: SESSION });
    mockGetUnlinkedServiceAccount.mockResolvedValue(ANON_SA_DOC);

    const res = await GET(makeRequest("Bearer sa-token"));
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("client_uuid");
    expect(serialized).not.toContain("never-expose-this");
    expect(serialized).not.toContain("kc-uuid-secret");
  });

  it("503 when getUnlinkedServiceAccount throws", async () => {
    mockGetAuthFromBearerOrSession.mockResolvedValue({ user: SESSION.user, session: SESSION });
    mockGetUnlinkedServiceAccount.mockRejectedValue(new Error("DB connection lost"));

    const res = await GET(makeRequest("Bearer sa-token"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
