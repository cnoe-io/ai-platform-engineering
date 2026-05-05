/**
 * @jest-environment node
 */
/**
 * Tests for the admin scan-override route.
 *
 *   POST   /api/admin/skills/:source/:source_id/scan-override
 *   DELETE /api/admin/skills/:source/:source_id/scan-override
 *
 * The route is the only place in the codebase that can flip a skill
 * to ``scan_status: "admin_overridden"`` and the only writer of
 * ``skill_scan_override_history``. Both responsibilities are
 * security-sensitive — the override removes a hard block on a
 * scanner-flagged skill, and the audit log is the only record
 * that says who did it and why. So this suite pins:
 *
 *   - the auth gate (401 / 403),
 *   - the env-flag gate (``ADMIN_SCAN_OVERRIDE_ENABLED``),
 *   - the precondition that only flagged skills can be overridden,
 *   - the audit-row write (set + clear),
 *   - the idempotent clear behaviour.
 *
 * If a future refactor weakens any of these (e.g. forgets to
 * require a reason, or stops recording the history row), one of
 * these tests fails loudly. The Python counterpart is in
 * ``tests/test_scan_gate.py::TestIsStatusBlockedForAdminOverride``.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest } from "next/server";

// ============================================================================
// Mocks (pattern matches admin-write-routes.test.ts)
// ============================================================================

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  authOptions: {},
}));

jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

let mockIsMongoDBConfigured = true;
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> = {};
const mockGetCollection = jest.fn((name: string) => {
  if (!mockCollections[name]) {
    mockCollections[name] = createMockCollection();
  }
  return Promise.resolve(mockCollections[name]);
});

jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
  getCollection: (...args: unknown[]) => mockGetCollection(...(args as [string])),
}));

// Capture audit-history calls so we can assert on the rows written.
const recordOverrideEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/skill-scan-override-history", () => ({
  recordScanOverrideEvent: (event: unknown) => recordOverrideEventMock(event),
}));

jest.spyOn(console, "warn").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});

function createMockCollection() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: "id" }),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
  };
}

function makeRequest(
  url: string,
  options: { method: string; body?: unknown } & RequestInit = { method: "GET" },
): NextRequest {
  const init: RequestInit & { body?: BodyInit | null } = {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin User" },
    role: "admin",
  };
}

function userSession() {
  return {
    user: { email: "user@example.com", name: "Regular User" },
    role: "user",
  };
}

const FLAGGED_SKILL = {
  id: "skill-123",
  name: "Risky Skill",
  description: "Test skill",
  scan_status: "flagged",
  scan_summary: "Detected shell exec with user input",
  is_system: false,
  owner_id: "owner@example.com",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  delete process.env.ADMIN_SCAN_OVERRIDE_ENABLED;
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  recordOverrideEventMock.mockClear();
});

afterEach(() => {
  delete process.env.ADMIN_SCAN_OVERRIDE_ENABLED;
});

// ============================================================================
// POST — set override
// ============================================================================

describe("POST /api/admin/skills/:source/:source_id/scan-override", () => {
  let POST: (
    req: NextRequest,
    ctx: { params: Promise<{ source: string; source_id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import(
      "@/app/api/admin/skills/[source]/[source_id]/scan-override/route"
    );
    POST = mod.POST as typeof POST;
  });

  const makeCtx = (source: string, source_id: string) => ({
    params: Promise.resolve({ source, source_id }),
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Admin access required");
  });

  it("returns 503 when Mongo is not configured", async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when ADMIN_SCAN_OVERRIDE_ENABLED=false", async () => {
    // The env-flag gate is the regulated-environment escape hatch.
    // It must block writes here AND collapse overridden skills to
    // flagged in applyRunnableGate / scan_gate; the latter is
    // covered in the runnable-gate and Python suites. Here we
    // pin: write path 503s with a message naming the env var so an
    // operator who hits this in prod has a fix to apply.
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "false";
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("ADMIN_SCAN_OVERRIDE_ENABLED");
  });

  it("returns 400 for unsupported source", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/default/foo/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("default", "foo"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not supported for source");
  });

  it("returns 400 for missing reason", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: {} },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("reason");
  });

  it("returns 400 for empty reason after trimming", async () => {
    // Whitespace-only reasons defeat the audit purpose; reject so
    // an operator has to actually justify the override.
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "   \n  " } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("cannot be empty");
  });

  it("returns 400 for reason > 4096 chars", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "x".repeat(4097) } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("too long");
  });

  it("returns 404 when the skill does not exist", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue(null);
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/missing-id/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "missing-id"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when the skill is not currently flagged", async () => {
    // Only "flagged" is overridable. Pinning this prevents a future
    // accidental change that would let admins pre-emptively
    // override passed/unscanned skills (would create
    // "admin_overridden" rows whose prior_scan_status doesn't
    // match the type, breaking the audit invariant).
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "passed",
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Only \"flagged\" skills");
  });

  it("returns 409 when the skill is already overridden", async () => {
    // Idempotency rule: re-overriding requires clearing first, so
    // each (skill, override) pair has a single canonical reason.
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "admin_overridden",
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(409);
  });

  it("flips status to admin_overridden, persists override, writes audit row", async () => {
    // The happy path. Critical assertions:
    //   1. updateOne sets scan_status: admin_overridden
    //   2. updateOne sets a complete scan_override sub-doc
    //   3. recordScanOverrideEvent receives action: "set" with the
    //      same reason and the prior status snapshot.
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue(FLAGGED_SKILL);
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      {
        method: "POST",
        body: { reason: "Reviewed shell-out, all paths use allow-list." },
      },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const data = body.data;

    expect(data.scan_status).toBe("admin_overridden");
    expect(data.scan_override).toEqual(
      expect.objectContaining({
        set_by: "admin@example.com",
        reason: "Reviewed shell-out, all paths use allow-list.",
        prior_scan_status: "flagged",
        prior_scan_summary: "Detected shell exec with user input",
      }),
    );
    expect(data.scan_override.set_at).toEqual(expect.any(String));

    // Mongo write
    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = skillsCol.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: "skill-123" });
    expect(update.$set).toEqual(
      expect.objectContaining({
        scan_status: "admin_overridden",
        scan_override: expect.objectContaining({
          reason: "Reviewed shell-out, all paths use allow-list.",
          set_by: "admin@example.com",
          prior_scan_status: "flagged",
        }),
      }),
    );

    // Audit row
    expect(recordOverrideEventMock).toHaveBeenCalledTimes(1);
    expect(recordOverrideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "set",
        skill_id: "skill-123",
        skill_name: "Risky Skill",
        source: "agent_skills",
        actor: "admin@example.com",
        reason: "Reviewed shell-out, all paths use allow-list.",
        prior_scan_status: "flagged",
        prior_scan_summary: "Detected shell exec with user input",
      }),
    );
  });

  it("trims the reason before persisting", async () => {
    // Cosmetic but pinned: leading/trailing whitespace in the audit
    // log makes search and reporting noisier, and we don't want
    // two semantically-identical reasons to differ by a newline.
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue(FLAGGED_SKILL);
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "POST", body: { reason: "   Looks fine.\n\n" } },
    );
    const res = await POST(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_override.reason).toBe("Looks fine.");
  });
});

// ============================================================================
// DELETE — clear override
// ============================================================================

describe("DELETE /api/admin/skills/:source/:source_id/scan-override", () => {
  let DELETE: (
    req: NextRequest,
    ctx: { params: Promise<{ source: string; source_id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import(
      "@/app/api/admin/skills/[source]/[source_id]/scan-override/route"
    );
    DELETE = mod.DELETE as typeof DELETE;
  });

  const makeCtx = (source: string, source_id: string) => ({
    params: Promise.resolve({ source, source_id }),
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(403);
  });

  it("works even when ADMIN_SCAN_OVERRIDE_ENABLED=false", async () => {
    // Operators must always be able to clean up stuck overrides
    // even after disabling the feature. Pinning this prevents the
    // env flag from accidentally trapping overrides forever.
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "false";
    mockGetServerSession.mockResolvedValue(adminSession());

    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "admin_overridden",
      scan_override: {
        set_by: "admin@example.com",
        set_at: "2026-05-01T00:00:00Z",
        reason: "old reason",
        prior_scan_status: "flagged",
        prior_scan_summary: "old summary",
      },
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(body.data.scan_status).toBe("flagged");
  });

  it("returns 200 with cleared=false when no override exists (idempotent)", async () => {
    // Double-fire safety: a UI that retries a DELETE because the
    // first one looked slow shouldn't error on the second call.
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "passed",
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(false);
    expect(body.data.scan_status).toBe("passed");

    // Idempotency means no Mongo write, no audit row.
    expect(skillsCol.updateOne).not.toHaveBeenCalled();
    expect(recordOverrideEventMock).not.toHaveBeenCalled();
  });

  it("flips status back to flagged, unsets override, writes audit row", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "admin_overridden",
      scan_override: {
        set_by: "alice@example.com",
        set_at: "2026-05-01T00:00:00Z",
        reason: "Original reason",
        prior_scan_status: "flagged",
        prior_scan_summary: "Original summary",
      },
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE", body: { reason: "Skill rewritten" } },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(body.data.scan_status).toBe("flagged");

    // updateOne wrote the right shape: status reset, override
    // sub-doc removed via $unset.
    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = skillsCol.updateOne.mock.calls[0];
    expect(filter).toEqual({ id: "skill-123" });
    expect(update.$set).toEqual(
      expect.objectContaining({
        scan_status: "flagged",
        scan_summary: "Original summary",
      }),
    );
    expect(update.$unset).toEqual({ scan_override: "" });

    // Audit row carries the optional clear-reason and the prior
    // status snapshot, so a reviewer can reconstruct the lifecycle.
    expect(recordOverrideEventMock).toHaveBeenCalledTimes(1);
    expect(recordOverrideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clear",
        skill_id: "skill-123",
        actor: "admin@example.com",
        reason: "Skill rewritten",
        prior_scan_status: "admin_overridden",
        prior_scan_summary: "Original summary",
      }),
    );
  });

  it("clears successfully even without a reason in body", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const skillsCol = createMockCollection();
    skillsCol.findOne.mockResolvedValue({
      ...FLAGGED_SKILL,
      scan_status: "admin_overridden",
      scan_override: {
        set_by: "alice@example.com",
        set_at: "2026-05-01T00:00:00Z",
        reason: "old",
        prior_scan_status: "flagged",
      },
    });
    mockCollections.agent_skills = skillsCol;

    const req = makeRequest(
      "/api/admin/skills/agent_skills/skill-123/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("agent_skills", "skill-123"));
    expect(res.status).toBe(200);

    // Audit row written with reason undefined (the helper handles
    // optional reason; we just confirm the call happened).
    expect(recordOverrideEventMock).toHaveBeenCalledTimes(1);
    expect(recordOverrideEventMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ action: "clear", reason: undefined }),
    );
  });
});
