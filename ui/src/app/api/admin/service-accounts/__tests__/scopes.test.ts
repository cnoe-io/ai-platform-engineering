/**
 * @jest-environment node
 */
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
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

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
      if (t.relation === "can_manage") return { allowed: true };
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

  it("404 for a non-manager (does not reveal existence)", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });

    const res = await POST(scopeRequest({ type: "tool", ref: "jira/search" }), ctx());
    expect(res.status).toBe(404);
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("400 on malformed scope ref", async () => {
    manageableWithHeld(new Set());
    const res = await POST(scopeRequest({ type: "tool", ref: "no-slash" }), ctx());
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
    const checkedRelations = mockCheckOpenFgaTuple.mock.calls.map((c) => c[0].relation);
    expect(checkedRelations).toEqual(["can_manage"]);
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
