/**
 * @jest-environment node
 */
/**
 * Tests the auto-revert-on-clean-rescan behaviour for the per-skill
 * scan route (``POST /api/skills/configs/[id]/scan``).
 *
 * The user-selected policy on rescans:
 *   - When a rescan returns ``"passed"`` on a skill currently in
 *     ``scan_status: "admin_overridden"``, the route auto-clears
 *     the override (``$unset scan_override``) and writes a
 *     ``clear`` audit row attributed to ``"system:scanner"``. The
 *     skill is now plain-passing; the override is no longer needed.
 *   - When a rescan still flags (or comes back unscanned), the
 *     override is kept untouched. The admin's assertion still
 *     applies, no audit churn.
 *
 * This is the rescan-side counterpart to the explicit clear path
 * tested in ``admin-scan-override.test.ts``. It pins the cleanup
 * invariant so a future refactor of the rescan path can't silently
 * leave a "passed" skill with a stale override sub-doc — that
 * combination would confuse audit reviewers ("why is there an
 * override on a passing skill?") and would make the override
 * count unbounded over time.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest } from "next/server";

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

const mockGetServerSession = jest.fn();
jest.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));
jest.mock("@/lib/config", () => ({
  getConfig: (key: string) => key === "ssoEnabled",
}));

let mockIsMongoDBConfigured = true;
const mockCollections: Record<string, ReturnType<typeof createMockCollection>> =
  {};
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

// The visibility helper: we mock to return whatever findOne would
// have returned, with full modify access. The route's "owner check"
// isn't what this test cares about — we're focused on the post-scan
// override cleanup.
const mockGetSkillVisible = jest.fn();
jest.mock("@/lib/agent-skill-visibility", () => ({
  getAgentSkillVisibleToUser: (...args: unknown[]) =>
    mockGetSkillVisible(...args),
  userCanModifyAgentSkill: () => true,
}));

// Stub the scanner: we choose its verdict per test to drive the
// auto-revert decision branch directly, without standing up a real
// service.
const mockScan = jest.fn();
jest.mock("@/lib/skill-scan", () => ({
  scanSkillContent: (...args: unknown[]) => mockScan(...args),
  isSkillScannerConfigured: () => true,
}));

const mockRecordScanEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/skill-scan-history", () => ({
  recordScanEvent: (event: unknown) => mockRecordScanEvent(event),
}));

// THE call we're asserting on: the override audit row written
// when a passing rescan auto-clears an existing override.
const mockRecordOverrideEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/skill-scan-override-history", () => ({
  recordScanOverrideEvent: (event: unknown) =>
    mockRecordOverrideEvent(event),
}));

jest.spyOn(console, "warn").mockImplementation(() => {});
jest.spyOn(console, "error").mockImplementation(() => {});

function createMockCollection() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  };
}

function adminSession() {
  return {
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
  };
}

function makeRequest(): NextRequest {
  return new NextRequest(
    new URL("/api/skills/configs/skill-123/scan", "http://localhost:3000"),
    { method: "POST" },
  );
}

const OVERRIDDEN_SKILL = {
  id: "skill-123",
  name: "Risky Skill",
  description: "Test",
  is_system: false,
  owner_id: "owner@example.com",
  scan_status: "admin_overridden" as const,
  scan_summary: "Flagged before override",
  scan_override: {
    set_by: "alice@example.com",
    set_at: "2026-05-01T00:00:00Z",
    reason: "Reviewed",
    prior_scan_status: "flagged" as const,
    prior_scan_summary: "Flagged before override",
  },
  // Provide skill_content so resolveSkillMarkdownForScan returns
  // non-empty. Otherwise the route 400s before we get to the
  // post-scan code.
  skill_content: "# Test\nHello",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  mockRecordOverrideEvent.mockClear();
});

// ----------------------------------------------------------------------------
// Test cases
// ----------------------------------------------------------------------------

describe("POST /api/skills/configs/[id]/scan — override auto-revert", () => {
  let POST: (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import("@/app/api/skills/configs/[id]/scan/route");
    POST = mod.POST as typeof POST;
  });

  const ctx = { params: Promise.resolve({ id: "skill-123" }) };

  it("clears override + writes system audit row when rescan returns passed", async () => {
    // The whole point of "auto-revert-on-clean": the override was
    // the admin's "trust me even though the scanner doesn't"
    // assertion. Once the scanner agrees, the assertion is moot
    // and we drop it so audit reviewers don't see "override on a
    // passing skill" forever.
    mockGetServerSession.mockResolvedValue(adminSession());
    mockGetSkillVisible.mockResolvedValue(OVERRIDDEN_SKILL);
    const skillsCol = createMockCollection();
    mockCollections.agent_skills = skillsCol;
    mockScan.mockResolvedValue({
      scan_status: "passed",
      scan_summary: "All checks passed",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.scan_status).toBe("passed");
    expect(body.data.override_auto_cleared).toBe(true);

    // Mongo write: $unset removes the override sub-doc atomically
    // with the new status. Doing both in one updateOne is
    // important — a separate update would leave a window where
    // the doc was "passed but still has override".
    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = skillsCol.updateOne.mock.calls[0];
    expect(update.$set).toEqual(
      expect.objectContaining({ scan_status: "passed" }),
    );
    expect(update.$unset).toEqual({ scan_override: "" });

    // Audit row: action=clear, actor=system:scanner, reason
    // hard-coded so future log readers can grep for the auto-
    // revert events specifically.
    expect(mockRecordOverrideEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOverrideEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clear",
        skill_id: "skill-123",
        actor: "system:scanner",
        reason: "Scanner returned passed",
        prior_scan_status: "admin_overridden",
      }),
    );
  });

  it("keeps override untouched when rescan still flags", async () => {
    // The other half of the policy: a still-flagged rescan must
    // NOT clear the override. Otherwise an admin-overridden skill
    // would oscillate every time a rescan happened — an admin
    // that keeps overriding it would have an unbounded number of
    // set/clear pairs in the audit log for no operator benefit.
    mockGetServerSession.mockResolvedValue(adminSession());
    mockGetSkillVisible.mockResolvedValue(OVERRIDDEN_SKILL);
    const skillsCol = createMockCollection();
    mockCollections.agent_skills = skillsCol;
    mockScan.mockResolvedValue({
      scan_status: "flagged",
      scan_summary: "Still detected shell exec",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("flagged");
    expect(body.data.override_auto_cleared).toBeUndefined();

    // No $unset, no audit row.
    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = skillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });

  it("keeps override untouched when rescan returns unscanned (scanner unreachable)", async () => {
    // A scanner that 503s shouldn't undo the admin's assertion.
    // We treat unscanned the same as flagged-still: keep the
    // override, don't audit.
    mockGetServerSession.mockResolvedValue(adminSession());
    mockGetSkillVisible.mockResolvedValue(OVERRIDDEN_SKILL);
    const skillsCol = createMockCollection();
    mockCollections.agent_skills = skillsCol;
    mockScan.mockResolvedValue({
      scan_status: "unscanned",
      unscanned_reason: "Scanner unreachable",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("unscanned");
    expect(body.data.override_auto_cleared).toBeUndefined();

    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = skillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });

  it("does not auto-clear when the skill was not overridden in the first place", async () => {
    // A passing rescan on a flagged-but-not-overridden skill is
    // the regular happy path: just persist the new status, no
    // override action needed. Pinning this prevents an accidental
    // future refactor that audits a clear for every passing rescan.
    mockGetServerSession.mockResolvedValue(adminSession());
    mockGetSkillVisible.mockResolvedValue({
      ...OVERRIDDEN_SKILL,
      scan_status: "flagged",
      scan_override: undefined,
    });
    const skillsCol = createMockCollection();
    mockCollections.agent_skills = skillsCol;
    mockScan.mockResolvedValue({
      scan_status: "passed",
      scan_summary: "All checks passed",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("passed");
    expect(body.data.override_auto_cleared).toBeUndefined();

    expect(skillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = skillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });
});
