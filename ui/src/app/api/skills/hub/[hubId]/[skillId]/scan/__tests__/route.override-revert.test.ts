/**
 * @jest-environment node
 */
/**
 * Hub-source counterpart to
 * ``app/api/skills/configs/[id]/scan/__tests__/route.override-revert.test.ts``.
 *
 * Pins the auto-revert-on-clean-rescan policy for hub-cached skills:
 *
 *   - Rescan returns ``"passed"`` on an ``admin_overridden`` hub skill →
 *     atomic ``$unset scan_override`` + status flip to passed, plus a
 *     ``clear`` audit row attributed to ``"system:scanner"`` carrying
 *     the ``hub_id`` (so a reviewer joining override-history with
 *     hub_skills can disambiguate the same skill_id across multiple
 *     hubs).
 *   - Rescan still flags / unscanned → keep the override untouched.
 *   - Skill was not overridden in the first place → never write an
 *     override audit row.
 *
 * The drift surface this protects is the hub branch of bulk
 * ``scan-all`` plus this per-skill route — both must apply the same
 * policy or you'd get auto-revert via one path and not the other,
 * which would confuse audit reviewers.
 *
 * assisted-by Cursor Composer-Sonnet-4.7
 */

import { NextRequest } from "next/server";

// ----------------------------------------------------------------------------
// Mocks (mirror the agent_skills route.override-revert.test.ts so the
// two suites can be diffed for drift)
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

const mockScan = jest.fn();
jest.mock("@/lib/skill-scan", () => ({
  scanSkillContent: (...args: unknown[]) => mockScan(...args),
  isSkillScannerConfigured: () => true,
}));

const mockRecordScanEvent = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/skill-scan-history", () => ({
  recordScanEvent: (event: unknown) => mockRecordScanEvent(event),
}));

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
    new URL(
      "/api/skills/hub/hub-1/gitlab-pipeline-watch/scan",
      "http://localhost:3000",
    ),
    { method: "POST" },
  );
}

const HUB_DOC = {
  id: "hub-1",
  type: "gitlab",
  location: "gitlab-org/ai/skills",
  enabled: true,
};

const OVERRIDDEN_HUB_SKILL = {
  hub_id: "hub-1",
  skill_id: "gitlab-pipeline-watch",
  name: "GitLab Pipeline Watch",
  description: "Watch a GitLab pipeline",
  content: "# pipeline watch...",
  metadata: {},
  path: "skills/gitlab-pipeline-watch/SKILL.md",
  cached_at: new Date("2026-05-01T00:00:00Z"),
  scan_status: "admin_overridden" as const,
  scan_summary: "Flagged before override",
  scan_override: {
    set_by: "alice@example.com",
    set_at: "2026-05-01T00:00:00Z",
    reason: "Reviewed",
    prior_scan_status: "flagged" as const,
    prior_scan_summary: "Flagged before override",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsMongoDBConfigured = true;
  Object.keys(mockCollections).forEach((k) => delete mockCollections[k]);
  mockRecordOverrideEvent.mockClear();
});

// Seed both required collections (skill_hubs for the hub lookup,
// hub_skills for the cached skill doc) with overridden state.
function seedOverriddenHubSkill(): {
  hubsCol: ReturnType<typeof createMockCollection>;
  hubSkillsCol: ReturnType<typeof createMockCollection>;
} {
  const hubsCol = createMockCollection();
  hubsCol.findOne.mockResolvedValue(HUB_DOC);
  mockCollections.skill_hubs = hubsCol;

  const hubSkillsCol = createMockCollection();
  hubSkillsCol.findOne.mockResolvedValue(OVERRIDDEN_HUB_SKILL);
  mockCollections.hub_skills = hubSkillsCol;

  return { hubsCol, hubSkillsCol };
}

// ----------------------------------------------------------------------------
// Test cases
// ----------------------------------------------------------------------------

describe("POST /api/skills/hub/[hubId]/[skillId]/scan — override auto-revert", () => {
  let POST: (
    req: NextRequest,
    ctx: { params: Promise<{ hubId: string; skillId: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import(
      "@/app/api/skills/hub/[hubId]/[skillId]/scan/route"
    );
    POST = mod.POST as typeof POST;
  });

  const ctx = {
    params: Promise.resolve({
      hubId: "hub-1",
      skillId: "gitlab-pipeline-watch",
    }),
  };

  it("clears override + writes hub-tagged system audit row when rescan returns passed", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { hubSkillsCol } = seedOverriddenHubSkill();
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

    // Atomic update: status flip + override removal in a single
    // updateOne. Same invariant as the agent_skills route — a
    // separate update would create a "passed but still has
    // override" window the audit reviewer would have to explain.
    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(filter).toEqual({
      hub_id: "hub-1",
      skill_id: "gitlab-pipeline-watch",
    });
    expect(update.$set).toEqual(
      expect.objectContaining({ scan_status: "passed" }),
    );
    expect(update.$unset).toEqual({ scan_override: "" });

    // Audit row carries hub_id so override-history joins to
    // hub_skills cleanly. Without hub_id a reviewer couldn't tell
    // which hub a "gitlab-pipeline-watch" override belonged to
    // when the same skill_id appears across multiple hubs.
    expect(mockRecordOverrideEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordOverrideEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clear",
        skill_id: "gitlab-pipeline-watch",
        source: "hub",
        hub_id: "hub-1",
        actor: "system:scanner",
        reason: "Scanner returned passed",
        prior_scan_status: "admin_overridden",
      }),
    );
  });

  it("keeps override untouched when rescan still flags", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { hubSkillsCol } = seedOverriddenHubSkill();
    mockScan.mockResolvedValue({
      scan_status: "flagged",
      scan_summary: "Still detected loop",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("flagged");
    expect(body.data.override_auto_cleared).toBeUndefined();

    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });

  it("keeps override untouched when rescan returns unscanned (scanner unreachable)", async () => {
    mockGetServerSession.mockResolvedValue(adminSession());
    const { hubSkillsCol } = seedOverriddenHubSkill();
    mockScan.mockResolvedValue({
      scan_status: "unscanned",
      unscanned_reason: "Scanner unreachable",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("unscanned");
    expect(body.data.override_auto_cleared).toBeUndefined();

    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });

  it("does not auto-clear when the hub skill was not overridden in the first place", async () => {
    // A passing rescan on a flagged-but-not-overridden hub skill
    // is the regular happy path. Pinned to prevent an accidental
    // refactor that audits a clear for every passing rescan.
    mockGetServerSession.mockResolvedValue(adminSession());
    const hubsCol = createMockCollection();
    hubsCol.findOne.mockResolvedValue(HUB_DOC);
    mockCollections.skill_hubs = hubsCol;
    const hubSkillsCol = createMockCollection();
    hubSkillsCol.findOne.mockResolvedValue({
      ...OVERRIDDEN_HUB_SKILL,
      scan_status: "flagged",
      scan_override: undefined,
    });
    mockCollections.hub_skills = hubSkillsCol;

    mockScan.mockResolvedValue({
      scan_status: "passed",
      scan_summary: "All checks passed",
    });

    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.scan_status).toBe("passed");
    expect(body.data.override_auto_cleared).toBeUndefined();

    expect(hubSkillsCol.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = hubSkillsCol.updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(mockRecordOverrideEvent).not.toHaveBeenCalled();
  });
});
