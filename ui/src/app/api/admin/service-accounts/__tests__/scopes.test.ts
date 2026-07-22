/**
 * @jest-environment node
 */
// assisted-by Codex Codex-sonnet-4-6

/**
 * T027 — POST/DELETE /api/admin/service-accounts/[id]/scopes.
 *
 * Asymmetric add/remove rule:
 *  - ADD (FR-015): can_manage AND the editor must hold the scope → else 403.
 *  - REMOVE (FR-016): can_manage ONLY — editor need NOT hold the scope.
 * Neither verb touches the credential (FR-019): no Keycloak module is even
 * imported by the route, and the responses carry no secret material.
 */

import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));
jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
}));

const mockCheckOpenFgaTuple = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockListOpenFgaObjects = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
}));

const mockLogAudit = jest.fn();
jest.mock("@/lib/rbac/audit", () => ({
  logOpenFgaRebacAuditEvent: (...args: unknown[]) => mockLogAudit(...args),
}));

const mockGetBySub = jest.fn();
const mockUpdateScopesSnapshot = jest.fn();
jest.mock("@/lib/service-accounts", () => ({
  getBySub: (...args: unknown[]) => mockGetBySub(...args),
  updateScopesSnapshot: (...args: unknown[]) => mockUpdateScopesSnapshot(...args),
}));

jest.mock("@/lib/rbac/organization", () => ({
  organizationObjectId: jest.fn().mockReturnValue("organization:caipe"),
}));

import { POST, DELETE } from "../[id]/scopes/route";

const SESSION = { sub: "editor-sub", user: { email: "editor@example.com" } };
const SA_ID = "sa-123";

function scopeRequest(body: unknown): Request {
  return new NextRequest(
    `http://localhost:3000/api/admin/service-accounts/${SA_ID}/scopes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function ctx() {
  return { params: Promise.resolve({ id: SA_ID }) };
}

/** can_manage allowed; named held-scope checks toggle on `held`. */
function manageableWithHeld(held: Set<string>) {
  mockCheckOpenFgaTuple.mockImplementation(
    async (t: { relation: string; object: string }) => {
      if (t.relation === "can_manage" && t.object.startsWith("service_account:")) {
        return { allowed: true };
      }
      if (t.relation === "can_manage" && t.object.startsWith("organization:")) {
        return { allowed: false };
      }
      return { allowed: held.has(`${t.relation} ${t.object}`) };
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
  mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
  // refreshSnapshot reads current tuples + the prior doc.
  mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
  mockGetBySub.mockResolvedValue({ sa_sub: SA_ID, scopes_snapshot: [] });
  mockUpdateScopesSnapshot.mockResolvedValue(true);
});

describe("POST .../[id]/scopes (add)", () => {
  it("adds a held scope → 200, writes the base tuple, audits, no secret", async () => {
    manageableWithHeld(new Set(["can_call tool:jira/search"]));

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.added).toEqual({ type: "tool", ref: "jira/search" });
    expect(JSON.stringify(body)).not.toContain("secret");

    // Base relation `caller` for a tool (not can_*).
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: `service_account:${SA_ID}`, relation: "caller", object: "tool:jira/search" }],
      deletes: [],
    });
    expect(mockUpdateScopesSnapshot).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "service_account.scope_add" }),
    );
  });

  it("rejects an unheld scope → 403, nothing written (FR-015)", async () => {
    manageableWithHeld(new Set()); // manage ok, holds nothing

    const res = await POST(scopeRequest({ type: "agent", ref: "incident-resolver" }), ctx());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.data.rejected_scope).toEqual({ type: "agent", ref: "incident-resolver" });
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockUpdateScopesSnapshot).not.toHaveBeenCalled();
  });

  it("allows a platform admin to add an unheld MCP tool scope to a managed service account", async () => {
    mockCheckOpenFgaTuple.mockImplementation(
      async (t: { relation: string; object: string }) => {
        if (t.relation === "can_manage" && t.object === `service_account:${SA_ID}`) {
          return { allowed: true };
        }
        if (t.relation === "can_manage" && t.object === "organization:caipe") {
          return { allowed: true };
        }
        if (t.relation === "can_call" && t.object === "tool:jira/*") {
          return { allowed: false };
        }
        return { allowed: false };
      },
    );
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: false,
      scopes_snapshot: [],
    });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/*" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.added).toEqual({ type: "tool", ref: "jira/*" });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: `service_account:${SA_ID}`, relation: "caller", object: "tool:jira/*" }],
      deletes: [],
    });
  });

  it("404 for a non-manager (does not reveal existence)", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(404);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("400 on genuinely malformed scope ref", async () => {
    manageableWithHeld(new Set());
    // A space is genuinely malformed (not OpenFGA-safe). NOTE: a bare
    // separator-less id like "no-slash" is NOT malformed — it's a valid
    // single-segment tool id (#43), so it would proceed to the can_call check.
    const res = await POST(scopeRequest({ type: "tool", ref: "bad ref" }), ctx());
    expect(res.status).toBe(400);
    // can_manage not even checked when the body is malformed.
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(401);
  });
});

describe("DELETE .../[id]/scopes (remove)", () => {
  it("removes a scope the editor does NOT hold → 200 (FR-016)", async () => {
    // Editor can_manage but does NOT hold the tool — removal must still succeed.
    manageableWithHeld(new Set());

    const res = await DELETE(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.removed).toEqual({ type: "tool", ref: "jira/search" });

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      { user: `service_account:${SA_ID}`, relation: "caller", object: "tool:jira/search" },
    ]);
    // The editor's scope-holding was NOT checked — only can_manage.
    const checkedTuples = mockCheckOpenFgaTuple.mock.calls.map((c) => c[0]);
    expect(checkedTuples).toEqual([
      {
        user: "user:editor-sub",
        relation: "can_manage",
        object: `service_account:${SA_ID}`,
      },
      {
        user: "user:editor-sub",
        relation: "can_manage",
        object: "organization:caipe",
      },
    ]);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "service_account.scope_remove" }),
    );
  });

  it("404 for a non-manager", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    const res = await DELETE(scopeRequest({ type: "agent", ref: "incident-resolver" }), ctx());
    expect(res.status).toBe(404);
    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
  });
});

// ── [TS-B1] Org-admin bypass for the unlinked SA ───────────────────────────
describe("org-admin bypass for the unlinked SA (TS-B1)", () => {
  /**
   * Simulates an org-admin who is NOT in the super-admins team:
   * - can_manage on the SA → false (not in super-admins)
   * - can_manage on the organization → true (org-admin)
   */
  function orgAdminNotInSuperAdmins() {
    mockCheckOpenFgaTuple.mockImplementation(
      async (t: { relation: string; object: string }) => {
        if (t.relation === "can_manage" && t.object.startsWith("service_account:")) {
          return { allowed: false };
        }
        if (t.relation === "can_manage" && t.object.startsWith("organization:")) {
          return { allowed: true };
        }
        // scope-holding checks for can_call/can_use — grant everything
        return { allowed: true };
      },
    );
  }

  it("POST: org-admin can add a scope to the unlinked SA (is_platform_unlinked=true)", async () => {
    orgAdminNotInSuperAdmins();
    // Target SA is the platform unlinked SA.
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: true,
      scopes_snapshot: [],
    });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.added).toEqual({ type: "tool", ref: "jira/search" });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalled();
  });

  it("POST: org-admin can add an unheld tool scope to the unlinked SA", async () => {
    mockCheckOpenFgaTuple.mockImplementation(
      async (t: { relation: string; object: string }) => {
        if (t.relation === "can_manage" && t.object.startsWith("service_account:")) {
          return { allowed: false };
        }
        if (t.relation === "can_manage" && t.object.startsWith("organization:")) {
          return { allowed: true };
        }
        if (t.relation === "can_call" && t.object === "tool:jira/*") {
          return { allowed: false };
        }
        return { allowed: true };
      },
    );
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: true,
      scopes_snapshot: [],
    });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/*" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.added).toEqual({ type: "tool", ref: "jira/*" });
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: `service_account:${SA_ID}`, relation: "caller", object: "tool:jira/*" }],
      deletes: [],
    });
  });

  it("DELETE: org-admin can remove a scope from the unlinked SA", async () => {
    orgAdminNotInSuperAdmins();
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: true,
      scopes_snapshot: [],
    });

    const res = await DELETE(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalled();
  });

  it("POST: org-admin can also add a scope to a NORMAL SA (bypass is not unlinked-only)", async () => {
    // can_manage on the SA → false (not on the owning team); org-admin → true;
    // target doc is a normal SA. The org-admin bypass now applies uniformly
    // across all service accounts (mirrors the detail/rotate/credentials routes).
    mockCheckOpenFgaTuple.mockImplementation(
      async (t: { relation: string; object: string }) => {
        if (t.relation === "can_manage" && t.object.startsWith("service_account:")) {
          return { allowed: false };
        }
        if (t.relation === "can_manage" && t.object.startsWith("organization:")) {
          return { allowed: true };
        }
        return { allowed: true };
      },
    );
    // Target doc is a normal SA (no is_platform_unlinked flag).
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: false,
      scopes_snapshot: [],
    });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(200);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalled();
  });

  it("POST: non-org-admin is blocked even on the unlinked SA", async () => {
    // can_manage on SA → false; org-admin → false (neither super-admins member nor org-admin).
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockGetBySub.mockResolvedValue({
      sa_sub: SA_ID,
      is_platform_unlinked: true,
      scopes_snapshot: [],
    });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(404);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});
