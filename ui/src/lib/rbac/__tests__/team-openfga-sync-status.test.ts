/**
 * Tests for the pure team OpenFGA sync-status helper.
 *
 * Covers the four-state model (synced / pending / drifted / unknown) and
 * the team-level summary, plus a few edge cases (multiple identity
 * sources for the same user, non-active source rows).
 */

import type { TeamMembershipSource } from "@/types/identity-group-sync";

const mockIsOpenFgaConfigured = jest.fn(() => true);
const mockReadOpenFgaTuples = jest.fn();

// Only `readTeamMemberOpenFgaTuples` touches OpenFGA; the rest of the module
// (the pure classifier + report builder) is unaffected by these mocks.
jest.mock("@/lib/rbac/openfga", () => ({
  isOpenFgaConfigured: () => mockIsOpenFgaConfigured(),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

import {
  classifyMemberSyncStatus,
  computeTeamMembershipSyncReport,
  readTeamMemberOpenFgaTuples,
  type TeamMembershipSyncSummary,
} from "@/lib/rbac/team-openfga-sync-status";

const baseSource = (
  overrides: Partial<TeamMembershipSource> = {},
): TeamMembershipSource => ({
  team_id: "team-123",
  team_slug: "platform",
  user_subject: "kc-sub-alice",
  user_email: "alice@example.com",
  relationship: "member",
  source_type: "manual",
  managed: false,
  status: "active",
  created_at: "2026-05-22T00:00:00Z",
  ...overrides,
});

describe("computeTeamMembershipSyncReport", () => {
  it("reports synced when source has user_subject and matching tuple exists", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({ user_subject: "kc-sub-alice", relationship: "member" }),
      ],
      tuples: [
        {
          user: "user:kc-sub-alice",
          relation: "member",
          object: "team:platform",
        },
      ],
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].status).toBe("synced");
    expect(report.entries[0].expected_tuple).toEqual({
      user: "user:kc-sub-alice",
      relation: "member",
      object: "team:platform",
    });
    expect(report.summary).toMatchObject<Partial<TeamMembershipSyncSummary>>({
      total: 1,
      synced: 1,
      pending: 0,
      drifted: 0,
      unknown: 0,
      needs_attention: false,
      openfga_available: true,
    });
  });

  it("reports pending when source has no user_subject", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({
          user_subject: undefined,
          user_email: "newbie@example.com",
          relationship: "member",
        }),
      ],
      tuples: [],
    });

    expect(report.entries[0]).toMatchObject({
      status: "pending",
      user_subject: undefined,
      user_email: "newbie@example.com",
    });
    expect(report.summary.pending).toBe(1);
    expect(report.summary.needs_attention).toBe(false);
  });

  it("reports drifted when subject is resolved but the matching tuple is absent", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({ user_subject: "kc-sub-bob", relationship: "admin" }),
      ],
      tuples: [
        // wrong relation — bob is `member` in OpenFGA but `admin` in mongo
        {
          user: "user:kc-sub-bob",
          relation: "member",
          object: "team:platform",
        },
      ],
    });

    expect(report.entries[0].status).toBe("drifted");
    expect(report.summary).toMatchObject({
      drifted: 1,
      synced: 0,
      needs_attention: true,
      openfga_available: true,
    });
  });

  it("reports unknown for every active row when OpenFGA tuples is null (read failed)", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({ user_subject: "kc-sub-alice" }),
        baseSource({
          user_subject: "kc-sub-bob",
          user_email: "bob@example.com",
        }),
      ],
      tuples: null,
    });

    expect(report.entries.every((e) => e.status === "unknown")).toBe(true);
    expect(report.summary).toMatchObject({
      total: 2,
      unknown: 2,
      needs_attention: true,
      openfga_available: false,
    });
  });

  it("still reports pending (not unknown) when OpenFGA is unavailable but the source has no subject anyway", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({ user_subject: undefined, user_email: "x@example.com" }),
      ],
      tuples: null,
    });

    expect(report.entries[0].status).toBe("pending");
    expect(report.summary).toMatchObject({ pending: 1, unknown: 0 });
  });

  it("ignores non-active source rows", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({ status: "removed" }),
        baseSource({ status: "pending_identity_link" }),
        baseSource({
          status: "active",
          user_subject: "kc-sub-alice",
        }),
      ],
      tuples: [
        {
          user: "user:kc-sub-alice",
          relation: "member",
          object: "team:platform",
        },
      ],
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].status).toBe("synced");
  });

  it("treats the same subject in two source rows as two independent entries", () => {
    // E.g. user was added manually AND inherited from an Okta group
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [
        baseSource({
          user_subject: "kc-sub-alice",
          relationship: "member",
          source_type: "manual",
        }),
        baseSource({
          user_subject: "kc-sub-alice",
          relationship: "member",
          source_type: "okta",
          provider_id: "okta",
          external_group_id: "okta-platform-team",
        }),
      ],
      tuples: [
        {
          user: "user:kc-sub-alice",
          relation: "member",
          object: "team:platform",
        },
      ],
    });

    expect(report.entries).toHaveLength(2);
    // Both point to the same tuple, so both are synced.
    expect(report.entries.every((e) => e.status === "synced")).toBe(true);
    // But their signatures differ so the UI keys them as distinct rows.
    expect(report.entries[0].source_signature).not.toBe(
      report.entries[1].source_signature,
    );
  });

  it("returns an empty summary when there are no sources", () => {
    const report = computeTeamMembershipSyncReport({
      teamSlug: "platform",
      sources: [],
      tuples: [],
    });

    expect(report.entries).toHaveLength(0);
    expect(report.summary).toMatchObject({
      total: 0,
      synced: 0,
      pending: 0,
      drifted: 0,
      unknown: 0,
      needs_attention: false,
      openfga_available: true,
    });
  });
});

describe("classifyMemberSyncStatus (per-member, page-scoped)", () => {
  it("reports synced when the held relations cover every required relation", () => {
    const result = classifyMemberSyncStatus({
      teamSlug: "platform",
      userSubject: "kc-sub-alice",
      requiredRelations: ["member"],
      relationsHeld: new Set(["member"]),
    });
    expect(result.status).toBe("synced");
  });

  it("treats admin as satisfying a member requirement (admin implies member)", () => {
    const result = classifyMemberSyncStatus({
      teamSlug: "platform",
      userSubject: "kc-sub-owner",
      // owner role maps to both admin+member, but holding only `admin` in
      // OpenFGA still satisfies `member` per the team authz model.
      requiredRelations: ["admin", "member"],
      relationsHeld: new Set(["admin"]),
    });
    expect(result.status).toBe("synced");
  });

  it("reports drifted when a required relation is missing", () => {
    const result = classifyMemberSyncStatus({
      teamSlug: "platform",
      userSubject: "kc-sub-bob",
      requiredRelations: ["member"],
      relationsHeld: new Set(), // OpenFGA reachable, but no tuple
    });
    expect(result.status).toBe("drifted");
    expect(result.reason).toContain("member");
  });

  it("reports pending when no Keycloak subject is resolved", () => {
    const result = classifyMemberSyncStatus({
      teamSlug: "platform",
      userSubject: undefined,
      requiredRelations: ["member"],
      relationsHeld: null,
    });
    expect(result.status).toBe("pending");
  });

  it("reports unknown when the OpenFGA read failed (relationsHeld === null) but a subject exists", () => {
    const result = classifyMemberSyncStatus({
      teamSlug: "platform",
      userSubject: "kc-sub-alice",
      requiredRelations: ["member"],
      relationsHeld: null,
    });
    expect(result.status).toBe("unknown");
  });
});

describe("readTeamMemberOpenFgaTuples (page-scoped reader)", () => {
  beforeEach(() => {
    mockIsOpenFgaConfigured.mockReturnValue(true);
    mockReadOpenFgaTuples.mockReset();
  });

  it("returns null when OpenFGA is not configured", async () => {
    mockIsOpenFgaConfigured.mockReturnValue(false);
    const result = await readTeamMemberOpenFgaTuples("platform", ["sub-a"]);
    expect(result).toBeNull();
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("returns an empty map without any reads when there are no subjects", async () => {
    const result = await readTeamMemberOpenFgaTuples("platform", []);
    expect(result).toEqual(new Map());
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("issues one filtered read per subject and maps the relations held", async () => {
    mockReadOpenFgaTuples.mockImplementation(async ({ tuple }: { tuple: { user: string } }) => {
      if (tuple.user === "user:sub-alice") {
        return { tuples: [{ key: { relation: "member" } }], continuationToken: undefined };
      }
      if (tuple.user === "user:sub-owner") {
        return {
          tuples: [{ key: { relation: "admin" } }, { key: { relation: "member" } }],
          continuationToken: undefined,
        };
      }
      return { tuples: [], continuationToken: undefined };
    });

    const result = await readTeamMemberOpenFgaTuples("platform", [
      "sub-alice",
      "sub-owner",
      "sub-nobody",
    ]);

    expect(result).not.toBeNull();
    expect(result!.get("sub-alice")).toEqual(new Set(["member"]));
    expect(result!.get("sub-owner")).toEqual(new Set(["admin", "member"]));
    expect(result!.get("sub-nobody")).toEqual(new Set());
    // One read per unique subject; object filter scopes to this team.
    expect(mockReadOpenFgaTuples).toHaveBeenCalledTimes(3);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({ tuple: { user: "user:sub-alice", object: "team:platform" } }),
    );
  });

  it("de-duplicates and trims subjects before reading", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({ tuples: [], continuationToken: undefined });
    await readTeamMemberOpenFgaTuples("platform", ["sub-a", " sub-a ", "", "sub-b"]);
    // "sub-a" (and its whitespace variant) collapse to one; "" is dropped.
    expect(mockReadOpenFgaTuples).toHaveBeenCalledTimes(2);
  });

  it("returns null when any per-subject read throws (don't infer drift from a partial read)", async () => {
    mockReadOpenFgaTuples.mockRejectedValue(new Error("openfga down"));
    const result = await readTeamMemberOpenFgaTuples("platform", ["sub-a"]);
    expect(result).toBeNull();
  });
});
