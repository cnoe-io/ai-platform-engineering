/**
 * @jest-environment node
 *
 * B2 — GET /api/admin/service-accounts/unlinked
 *
 * Core contracts:
 *  1. 401 for unauthenticated callers.
 *  2. 403 for authenticated non-admins (org-admin gate).
 *  3. 200 + SA payload for platform admins.
 *  4. 404 when the unlinked SA has not been bootstrapped.
 *  5. 503 when getUnlinkedServiceAccount throws.
 *  6. Bootstrap-admin email bypasses the OpenFGA check (break-glass).
 */

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: (email: string) => email === "bootstrap@example.com",
}));

const mockCheckOpenFgaTuple = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  organizationObjectId: () => "organization:caipe",
}));

const mockGetUnlinkedServiceAccount = jest.fn();
jest.mock("@/lib/rbac/unlinked-service-account", () => ({
  getUnlinkedServiceAccount: () => mockGetUnlinkedServiceAccount(),
}));

// QUAL-7: isPlatformAdmin is now imported from @/lib/rbac/platform-admin in the route.
const mockIsPlatformAdmin = jest.fn();
jest.mock("@/lib/rbac/platform-admin", () => ({
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
  hasOrganizationAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
}));

import { GET } from "../route";

const ADMIN_SESSION = { sub: "admin-sub", user: { email: "admin@example.com" } };
const NON_ADMIN_SESSION = { sub: "user-sub", user: { email: "user@example.com" } };
const BOOTSTRAP_SESSION = { sub: "bootstrap-sub", user: { email: "bootstrap@example.com" } };

const ANON_SA_DOC = {
  sa_sub: "anon-sub-abc",
  client_id: "caipe-sa-unlinked-12345",
  client_uuid: "kc-uuid-anon",
  name: "unlinked",
  description: "Platform-managed unlinked identity.",
  owning_team_id: "super-admins",
  created_by: "unlinked-bootstrap",
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  status: "active" as const,
  is_platform_unlinked: true,
  scopes_snapshot: [
    { type: "agent" as const, ref: "hello-world", added_by: "admin-sub", added_at: new Date() },
    { type: "tool" as const, ref: "jira/search", added_by: "admin-sub", added_at: new Date() },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: non-admin. Individual tests override as needed.
  mockIsPlatformAdmin.mockResolvedValue(false);
});

describe("GET /api/admin/service-accounts/unlinked", () => {
  it("401s when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("401s when session has no email or sub", async () => {
    mockGetServerSession.mockResolvedValue({ sub: "sub", user: {} });

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("403s when caller is not a platform admin", async () => {
    mockGetServerSession.mockResolvedValue(NON_ADMIN_SESSION);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/platform admin/i);
    // Should not have called the SA resolver
    expect(mockGetUnlinkedServiceAccount).not.toHaveBeenCalled();
  });

  it("200s for org-admin with correct SA payload", async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetUnlinkedServiceAccount.mockResolvedValue(ANON_SA_DOC);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("anon-sub-abc");
    // QUAL-10: sa_sub is no longer in the response — only id/name/scopes
    expect(body.data.sa_sub).toBeUndefined();
    expect(body.data.name).toBe("unlinked");
    expect(body.data.scopes).toEqual([
      { type: "agent", ref: "hello-world" },
      { type: "tool", ref: "jira/search" },
    ]);
  });

  it("does not return credential material in the response", async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetUnlinkedServiceAccount.mockResolvedValue(ANON_SA_DOC);

    const res = await GET();
    const body = await res.json();
    const serialized = JSON.stringify(body);

    // NEVER expose these in any response
    expect(serialized).not.toContain("client_secret");
    expect(serialized).not.toContain("client_uuid");
    expect(serialized).not.toContain("kc-uuid-anon");
  });

  it("200s for bootstrap-admin without an OpenFGA check", async () => {
    mockGetServerSession.mockResolvedValue(BOOTSTRAP_SESSION);
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetUnlinkedServiceAccount.mockResolvedValue(ANON_SA_DOC);

    const res = await GET();
    expect(res.status).toBe(200);
    // Break-glass path should not call OpenFGA
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
  });

  it("404s when the unlinked SA has not been bootstrapped", async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetUnlinkedServiceAccount.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it("503s when getUnlinkedServiceAccount throws", async () => {
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetUnlinkedServiceAccount.mockRejectedValue(new Error("DB connection lost"));

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("403s when isPlatformAdmin returns false (non-admin)", async () => {
    // isPlatformAdmin is now the shared lib helper; this test verifies the route
    // enforces its result rather than checking the inner OpenFGA call (which is
    // covered by the unlinked-service-account lib tests).
    mockGetServerSession.mockResolvedValue(NON_ADMIN_SESSION);
    mockIsPlatformAdmin.mockResolvedValue(false);

    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockGetUnlinkedServiceAccount).not.toHaveBeenCalled();
  });
});
