/**
 * @jest-environment node
 */
/**
 * Tests for the hub-source admin scan-override route.
 *
 *   POST   /api/admin/skills/hub/:hubId/:skillId/scan-override
 *   DELETE /api/admin/skills/hub/:hubId/:skillId/scan-override
 *
 * Companion suite to ``admin-scan-override.test.ts`` (which covers the
 * ``agent_skills`` source). Hub overrides write into the
 * ``hub_skills`` cache collection rather than ``agent_skills`` and
 * carry an additional ``hub_id`` field on the audit row, so the
 * preconditions and the persisted shape diverge enough that
 * sharing the suite would force every test to branch on source.
 *
 * Pinning identical behaviour to the agent_skills route on:
 *
 *   - auth gate (401 / 403)
 *   - env-flag gate (``ADMIN_SCAN_OVERRIDE_ENABLED``)
 *   - reason validation (required, non-empty, length cap)
 *   - precondition that only flagged skills are overridable
 *   - audit-row write (set + clear, including ``hub_id``)
 *   - idempotent clear behaviour
 *
 * If the two routes ever drift on policy (e.g. one accepts an empty
 * reason, the other doesn't), one of these tests fails loudly. The
 * Python policy in ``scan_gate`` does not differentiate by source,
 * so both routes must agree on what they let through.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest } from "next/server";

// ============================================================================
// Mocks (same shape as admin-scan-override.test.ts so the two suites
// can be diffed visually for drift)
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

const HUB_DOC = {
  id: "hub-1",
  type: "gitlab",
  location: "gitlab-org/ai/skills",
  enabled: true,
};

const FLAGGED_HUB_SKILL = {
  hub_id: "hub-1",
  skill_id: "gitlab-pipeline-watch",
  name: "GitLab Pipeline Watch",
  description: "Watch a GitLab pipeline",
  content: "# pipeline watch...",
  metadata: {},
  path: "skills/gitlab-pipeline-watch/SKILL.md",
  cached_at: new Date("2026-05-01T00:00:00Z"),
  scan_status: "flagged",
  scan_summary: "Infinite loop without clear exit condition",
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

// Seed the hub_skills + skill_hubs collections with the flagged
// fixture above. Used by the happy-path tests where the route walks
// both collections.
function seedFlaggedHubSkill(): {
  hubsCol: ReturnType<typeof createMockCollection>;
  hubSkillsCol: ReturnType<typeof createMockCollection>;
} {
  const hubsCol = createMockCollection();
  hubsCol.findOne.mockResolvedValue(HUB_DOC);
  mockCollections.skill_hubs = hubsCol;

  const hubSkillsCol = createMockCollection();
  hubSkillsCol.findOne.mockResolvedValue(FLAGGED_HUB_SKILL);
  mockCollections.hub_skills = hubSkillsCol;

  return { hubsCol, hubSkillsCol };
}

// ============================================================================
// POST — set override
// ============================================================================

describe("POST /api/admin/skills/hub/:hubId/:skillId/scan-override", () => {
  let POST: (
    req: NextRequest,
    ctx: { params: Promise<{ hubId: string; skillId: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import(
      "@/app/api/admin/skills/hub/[hubId]/[skillId]/scan-override/route"
    );
    POST = mod.POST as typeof POST;
  });

  const makeCtx = (hubId: string, skillId: string) => ({
    params: Promise.resolve({ hubId, skillId }),
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(403);
  });

  it("returns 503 when Mongo is not configured", async () => {
    mockIsMongoDBConfigured = false;
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when ADMIN_SCAN_OVERRIDE_ENABLED=false", async () => {
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "false";
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("ADMIN_SCAN_OVERRIDE_ENABLED");
  });

  it("returns 400 for missing reason", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: {} },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("reason");
  });

  it("returns 400 for empty reason after trimming", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "   \n  " } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for reason > 4096 chars", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "x".repeat(4097) } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the hub does not exist", async () => {
    // Friendly distinction between a stale hubId (likely in the URL
    // when an admin bookmarks a deleted hub) and a stale skillId.
    mockGetServerSession.mockResolvedValue(adminSession());
    const hubsCol = createMockCollection();
    hubsCol.findOne.mockResolvedValue(null);
    mockCollections.skill_hubs = hubsCol;

    const req = makeRequest(
      "/api/admin/skills/hub/missing-hub/some-skill/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("missing-hub", "some-skill"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Skill hub");
  });

  it("returns 404 when the hub skill is not in the cache", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const hubsCol = createMockCollection();
    hubsCol.findOne.mockResolvedValue(HUB_DOC);
    mockCollections.skill_hubs = hubsCol;
    const hubSkillsCol = createMockCollection();
    hubSkillsCol.findOne.mockResolvedValue(null);
    mockCollections.hub_skills = hubSkillsCol;

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/missing-skill/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "missing-skill"));
    expect(res.status).toBe(404);
    const body = await res.json();
    // Operator hint about re-crawl is intentional — covered here so
    // a future tweak doesn't drop the actionable next step.
    expect(body.error).toContain("re-crawled");
  });

  it("returns 409 when the hub skill is not flagged", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { hubSkillsCol } = seedFlaggedHubSkill();
    hubSkillsCol.findOne.mockResolvedValue({
      ...FLAGGED_HUB_SKILL,
      scan_status: "passed",
    });

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "POST", body: { reason: "Reviewed" } },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Only \"flagged\" skills");
  });

  it("flips status to admin_overridden, persists override on hub_skills, writes audit row with hub_id", async () => {
    // Happy path. The audit row MUST carry hub_id so a reviewer
    // joining override-history with hub_skills can disambiguate the
    // same skill_id appearing across multiple hubs. Pinned because
    // the agent_skills route doesn't write hub_id and copy/paste
    // drift could easily drop it here too.
    mockGetServerSession.mockResolvedValue(adminSession());
    const { hubSkillsCol } = seedFlaggedHubSkill();

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      {
        method: "POST",
        body: { reason: "Reviewed loop, has timeout. Per ticket SEC-123." },
      },
    );
    const res = await POST(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    expect(data.scan_status).toBe("admin_overridden");
    expect(data.id).toBe("hub-hub-1-gitlab-pipeline-watch");
    expect(data.hub_id).toBe("hub-1");
    expect(data.skill_id).toBe("gitlab-pipeline-watch");
    expect(data.scan_override).toEqual(
      expect.objectContaining({
        set_by: "admin@example.com",
        reason: "Reviewed loop, has timeout. Per ticket SEC-123.",
        prior_scan_status: "flagged",
        prior_scan_summary: "Infinite loop without clear exit condition",
      }),
    );

    // The Mongo write keys on the composite (hub_id, skill_id),
    // not the catalog-projected id — pinned because the catalog
    // id and the hub_skills filter shape are independent.
    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(filter).toEqual({
      hub_id: "hub-1",
      skill_id: "gitlab-pipeline-watch",
    });
    expect(update.$set).toEqual(
      expect.objectContaining({
        scan_status: "admin_overridden",
        scan_override: expect.objectContaining({
          reason: "Reviewed loop, has timeout. Per ticket SEC-123.",
        }),
      }),
    );

    expect(recordOverrideEventMock).toHaveBeenCalledTimes(1);
    expect(recordOverrideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "set",
        skill_id: "gitlab-pipeline-watch",
        skill_name: "GitLab Pipeline Watch",
        source: "hub",
        hub_id: "hub-1",
        actor: "admin@example.com",
        reason: "Reviewed loop, has timeout. Per ticket SEC-123.",
        prior_scan_status: "flagged",
        prior_scan_summary: "Infinite loop without clear exit condition",
      }),
    );
  });
});

// ============================================================================
// DELETE — clear override
// ============================================================================

describe("DELETE /api/admin/skills/hub/:hubId/:skillId/scan-override", () => {
  let DELETE: (
    req: NextRequest,
    ctx: { params: Promise<{ hubId: string; skillId: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import(
      "@/app/api/admin/skills/hub/[hubId]/[skillId]/scan-override/route"
    );
    DELETE = mod.DELETE as typeof DELETE;
  });

  const makeCtx = (hubId: string, skillId: string) => ({
    params: Promise.resolve({ hubId, skillId }),
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockGetServerSession.mockResolvedValue(userSession());
    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(403);
  });

  it("works even when ADMIN_SCAN_OVERRIDE_ENABLED=false", async () => {
    // Same rule as agent_skills: cleanup of stuck overrides MUST
    // remain possible after the feature is disabled.
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "false";
    mockGetServerSession.mockResolvedValue(adminSession());

    const hubSkillsCol = createMockCollection();
    hubSkillsCol.findOne.mockResolvedValue({
      ...FLAGGED_HUB_SKILL,
      scan_status: "admin_overridden",
      scan_override: {
        set_by: "admin@example.com",
        set_at: "2026-05-01T00:00:00Z",
        reason: "old reason",
        prior_scan_status: "flagged",
        prior_scan_summary: "old summary",
      },
    });
    mockCollections.hub_skills = hubSkillsCol;

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(body.data.scan_status).toBe("flagged");
  });

  it("returns 200 cleared=false when no override exists (idempotent)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const hubSkillsCol = createMockCollection();
    hubSkillsCol.findOne.mockResolvedValue({
      ...FLAGGED_HUB_SKILL,
      scan_status: "passed",
    });
    mockCollections.hub_skills = hubSkillsCol;

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "DELETE" },
    );
    const res = await DELETE(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(false);
    expect(body.data.scan_status).toBe("passed");

    expect(hubSkillsCol.updateOne).not.toHaveBeenCalled();
    expect(recordOverrideEventMock).not.toHaveBeenCalled();
  });

  it("flips status back to flagged, unsets override, writes audit row with hub_id", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const hubSkillsCol = createMockCollection();
    hubSkillsCol.findOne.mockResolvedValue({
      ...FLAGGED_HUB_SKILL,
      scan_status: "admin_overridden",
      scan_override: {
        set_by: "alice@example.com",
        set_at: "2026-05-01T00:00:00Z",
        reason: "Original reason",
        prior_scan_status: "flagged",
        prior_scan_summary: "Original summary",
      },
    });
    mockCollections.hub_skills = hubSkillsCol;

    const req = makeRequest(
      "/api/admin/skills/hub/hub-1/gitlab-pipeline-watch/scan-override",
      { method: "DELETE", body: { reason: "Skill rewritten upstream" } },
    );
    const res = await DELETE(req, makeCtx("hub-1", "gitlab-pipeline-watch"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(body.data.scan_status).toBe("flagged");

    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(filter).toEqual({
      hub_id: "hub-1",
      skill_id: "gitlab-pipeline-watch",
    });
    expect(update.$set).toEqual(
      expect.objectContaining({
        scan_status: "flagged",
        scan_summary: "Original summary",
      }),
    );
    expect(update.$unset).toEqual({ scan_override: "" });

    expect(recordOverrideEventMock).toHaveBeenCalledTimes(1);
    expect(recordOverrideEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clear",
        skill_id: "gitlab-pipeline-watch",
        source: "hub",
        hub_id: "hub-1",
        actor: "admin@example.com",
        reason: "Skill rewritten upstream",
        prior_scan_status: "admin_overridden",
        prior_scan_summary: "Original summary",
      }),
    );
  });
});
