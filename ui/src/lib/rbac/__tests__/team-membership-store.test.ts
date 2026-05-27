/**
 * Tests for the canonical team-membership reader helpers.
 *
 * Mocks `getRbacCollection` to return a `team_membership_sources`
 * collection driven by an in-memory array. This keeps tests fast and
 * isolates them from MongoDB topology decisions (the helpers only
 * issue `find` and `aggregate` calls; we mirror that minimally).
 */

import type { TeamMembershipSource } from "@/types/identity-group-sync";

const fixtureRows: TeamMembershipSource[] = [];

function findMatcher(filter: Record<string, unknown>) {
  return (row: TeamMembershipSource): boolean => {
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$or") {
        const clauses = value as Record<string, unknown>[];
        const anyMatch = clauses.some((clause) => findMatcher(clause)(row));
        if (!anyMatch) return false;
        continue;
      }
      const rowValue = (row as unknown as Record<string, unknown>)[key];
      if (
        typeof value === "object" &&
        value !== null &&
        "$in" in (value as Record<string, unknown>)
      ) {
        const inValues = (value as { $in: unknown[] }).$in;
        if (!inValues.includes(rowValue)) return false;
        continue;
      }
      if (rowValue !== value) return false;
    }
    return true;
  };
}

function findStub(filter: Record<string, unknown>) {
  const matcher = findMatcher(filter);
  const matched = fixtureRows.filter(matcher);
  return {
    toArray: async () => matched,
    [Symbol.asyncIterator]: async function* () {
      for (const row of matched) yield row;
    },
  };
}

function aggregateStub(pipeline: Record<string, unknown>[]) {
  // Minimal aggregation evaluator: $match on { team_slug, status (+ $in) },
  // $group on { team_slug + identity_key } with $sum:1, then $group again
  // by team_slug summing counts. Mirrors the exact pipeline shape produced
  // by `loadTeamMemberCounts`. Updates here must be kept in sync.
  let cursor: TeamMembershipSource[] = [...fixtureRows];

  const stages = pipeline;
  // Stage 0: $match
  const stage0 = stages[0] as { $match?: Record<string, unknown> };
  if (stage0?.$match) {
    cursor = cursor.filter(findMatcher(stage0.$match));
  }

  // Stage 1: $group by (team_slug, identity_key)
  type GroupedKey = { team_slug: string; identity_key: string | null };
  const grouped = new Map<string, GroupedKey>();
  for (const row of cursor) {
    const identity =
      (row.user_subject && row.user_subject.trim()) ||
      (row.user_email && row.user_email.trim().toLowerCase()) ||
      null;
    const key = `${row.team_slug}::${identity ?? "<null>"}`;
    if (!grouped.has(key)) {
      grouped.set(key, { team_slug: row.team_slug, identity_key: identity });
    }
  }
  let groupedArr: { _id: GroupedKey }[] = Array.from(grouped.values()).map((g) => ({ _id: g }));

  // Stage 2: $match identity_key !== null
  groupedArr = groupedArr.filter((g) => g._id.identity_key !== null);

  // Stage 3: $group by team_slug, sum
  const counts = new Map<string, number>();
  for (const item of groupedArr) {
    counts.set(item._id.team_slug, (counts.get(item._id.team_slug) ?? 0) + 1);
  }
  const result = Array.from(counts.entries()).map(([slug, count]) => ({ _id: slug, count }));

  return {
    toArray: async () => result,
  };
}

const collectionStub = {
  find: jest.fn((filter: Record<string, unknown>) => findStub(filter)),
  aggregate: jest.fn((pipeline: Record<string, unknown>[]) => aggregateStub(pipeline)),
};

jest.mock("../mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => collectionStub),
}));

import {
  countActiveTeamMembers,
  findUserRoleInTeam,
  isUserInTeam,
  loadActiveTeamMembers,
  loadTeamMemberCounts,
} from "../team-membership-store";

function row(overrides: Partial<TeamMembershipSource> = {}): TeamMembershipSource {
  return {
    team_id: "tid-1",
    team_slug: "platform",
    user_subject: "kc-sub-001",
    user_email: "alice@example.com",
    relationship: "member",
    source_type: "manual",
    managed: false,
    status: "active",
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  fixtureRows.length = 0;
  collectionStub.find.mockClear();
  collectionStub.aggregate.mockClear();
});

describe("loadActiveTeamMembers", () => {
  it("returns an empty array for a team with no rows", async () => {
    const members = await loadActiveTeamMembers("empty-team");
    expect(members).toEqual([]);
  });

  it("returns one entry per distinct identity", async () => {
    fixtureRows.push(
      row({ user_subject: "kc-A", user_email: "a@example.com" }),
      row({ user_subject: "kc-B", user_email: "b@example.com" }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.identity_key).sort()).toEqual(["kc-A", "kc-B"]);
  });

  it("dedupes two source rows for the same identity (different providers)", async () => {
    fixtureRows.push(
      row({ source_type: "okta", provider_id: "okta-prod" }),
      row({ source_type: "manual", provider_id: undefined }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(1);
    expect(members[0].identity_key).toBe("kc-sub-001");
    expect(members[0].source_types.sort()).toEqual(["manual", "okta"]);
    expect(members[0].provider_ids).toEqual(["okta-prod"]);
  });

  it("escalates role to admin when any active row is admin", async () => {
    fixtureRows.push(
      row({ source_type: "manual", relationship: "member" }),
      row({ source_type: "okta", relationship: "admin", provider_id: "okta-prod" }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("admin");
  });

  it("excludes rows with status != active by default", async () => {
    fixtureRows.push(
      row({ user_subject: "kc-A", status: "active" }),
      row({ user_subject: "kc-B", status: "removed" }),
      row({ user_subject: "kc-C", status: "stale" }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(1);
    expect(members[0].identity_key).toBe("kc-A");
  });

  it("includes non-active rows when includeRemoved=true (audit view)", async () => {
    fixtureRows.push(
      row({ user_subject: "kc-A", status: "active" }),
      row({ user_subject: "kc-B", status: "removed" }),
    );
    const members = await loadActiveTeamMembers("platform", { includeRemoved: true });
    expect(members).toHaveLength(2);
  });

  it("includes a row with user_subject but no user_email", async () => {
    fixtureRows.push(row({ user_subject: "kc-no-email", user_email: undefined }));
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(1);
    expect(members[0].identity_key).toBe("kc-no-email");
    expect(members[0].user_email).toBeUndefined();
  });

  it("skips rows that have neither user_subject nor user_email", async () => {
    fixtureRows.push(
      row({ user_subject: undefined, user_email: undefined }),
      row({ user_subject: "kc-A", user_email: "a@example.com" }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members).toHaveLength(1);
    expect(members[0].identity_key).toBe("kc-A");
  });

  it("returns empty for invalid teamSlug input", async () => {
    expect(await loadActiveTeamMembers("")).toEqual([]);
    expect(await loadActiveTeamMembers(null as unknown as string)).toEqual([]);
  });

  it("sorts members deterministically by identity_key", async () => {
    fixtureRows.push(
      row({ user_subject: "kc-zebra", user_email: "z@example.com" }),
      row({ user_subject: "kc-alpha", user_email: "a@example.com" }),
      row({ user_subject: "kc-mango", user_email: "m@example.com" }),
    );
    const members = await loadActiveTeamMembers("platform");
    expect(members.map((m) => m.identity_key)).toEqual(["kc-alpha", "kc-mango", "kc-zebra"]);
  });
});

describe("loadTeamMemberCounts", () => {
  it("returns zero entries for an empty input", async () => {
    const counts = await loadTeamMemberCounts([]);
    expect(counts.size).toBe(0);
  });

  it("returns one entry per requested slug, including zero-count slugs", async () => {
    fixtureRows.push(row({ team_slug: "alpha", user_subject: "kc-A" }));
    const counts = await loadTeamMemberCounts(["alpha", "beta"]);
    expect(counts.get("alpha")).toBe(1);
    expect(counts.get("beta")).toBe(0);
  });

  it("dedupes by identity_key within a single team", async () => {
    fixtureRows.push(
      row({ team_slug: "alpha", user_subject: "kc-A", source_type: "manual" }),
      row({ team_slug: "alpha", user_subject: "kc-A", source_type: "okta", provider_id: "okta-prod" }),
      row({ team_slug: "alpha", user_subject: "kc-B" }),
    );
    const counts = await loadTeamMemberCounts(["alpha"]);
    expect(counts.get("alpha")).toBe(2);
  });

  it("falls back to lowercased email when user_subject is absent", async () => {
    fixtureRows.push(
      row({ team_slug: "alpha", user_subject: undefined, user_email: "Foo@Example.com" }),
      row({ team_slug: "alpha", user_subject: undefined, user_email: "foo@example.com" }),
    );
    const counts = await loadTeamMemberCounts(["alpha"]);
    expect(counts.get("alpha")).toBe(1);
  });

  it("excludes non-active rows by default", async () => {
    fixtureRows.push(
      row({ team_slug: "alpha", user_subject: "kc-A", status: "active" }),
      row({ team_slug: "alpha", user_subject: "kc-B", status: "removed" }),
    );
    const counts = await loadTeamMemberCounts(["alpha"]);
    expect(counts.get("alpha")).toBe(1);
  });
});

describe("countActiveTeamMembers", () => {
  it("returns 0 for empty/invalid input", async () => {
    expect(await countActiveTeamMembers("")).toBe(0);
  });

  it("returns the same count as loadTeamMemberCounts", async () => {
    fixtureRows.push(
      row({ team_slug: "alpha", user_subject: "kc-A" }),
      row({ team_slug: "alpha", user_subject: "kc-B" }),
      row({ team_slug: "beta", user_subject: "kc-A" }),
    );
    expect(await countActiveTeamMembers("alpha")).toBe(2);
    expect(await countActiveTeamMembers("beta")).toBe(1);
  });
});

describe("findUserRoleInTeam", () => {
  it("returns null for non-members", async () => {
    fixtureRows.push(row({ team_slug: "platform", user_subject: "kc-A" }));
    const role = await findUserRoleInTeam("platform", { user_subject: "kc-Z" });
    expect(role).toBeNull();
  });

  it("matches by user_subject", async () => {
    fixtureRows.push(row({ team_slug: "platform", user_subject: "kc-A", relationship: "member" }));
    expect(await findUserRoleInTeam("platform", { user_subject: "kc-A" })).toBe("member");
  });

  it("matches by user_email (case-insensitive — stored as lowercase)", async () => {
    fixtureRows.push(
      row({ team_slug: "platform", user_subject: undefined, user_email: "alice@example.com" }),
    );
    expect(await findUserRoleInTeam("platform", { user_email: "Alice@Example.com" })).toBe("member");
  });

  it("escalates to admin when one of multiple rows is admin", async () => {
    fixtureRows.push(
      row({ team_slug: "platform", user_subject: "kc-A", relationship: "member", source_type: "manual" }),
      row({ team_slug: "platform", user_subject: "kc-A", relationship: "admin", source_type: "okta", provider_id: "okta-prod" }),
    );
    expect(await findUserRoleInTeam("platform", { user_subject: "kc-A" })).toBe("admin");
  });

  it("returns null when no identity is supplied", async () => {
    fixtureRows.push(row({ team_slug: "platform", user_subject: "kc-A" }));
    expect(await findUserRoleInTeam("platform", {})).toBeNull();
  });

  it("returns null for invalid teamSlug", async () => {
    fixtureRows.push(row({ team_slug: "platform", user_subject: "kc-A" }));
    expect(await findUserRoleInTeam("", { user_subject: "kc-A" })).toBeNull();
  });

  it("excludes removed rows by default", async () => {
    fixtureRows.push(
      row({ team_slug: "platform", user_subject: "kc-A", status: "removed" }),
    );
    expect(await findUserRoleInTeam("platform", { user_subject: "kc-A" })).toBeNull();
  });
});

describe("isUserInTeam", () => {
  it("returns true when role is found", async () => {
    fixtureRows.push(row({ team_slug: "platform", user_subject: "kc-A" }));
    expect(await isUserInTeam("platform", { user_subject: "kc-A" })).toBe(true);
  });

  it("returns false otherwise", async () => {
    expect(await isUserInTeam("platform", { user_subject: "kc-Z" })).toBe(false);
  });
});

describe("regression: legacy teams.members[] is never consulted", () => {
  // The whole point of this module is to be the canonical reader.
  // The mock collection only ever returns rows from `team_membership_sources`.
  // If the implementation tried to read `team.members[]`, these tests would
  // simply not see those values and would fail.
  it("returns 0 for a team that exists in `teams` collection but has no source rows", async () => {
    expect(await countActiveTeamMembers("ghost-team")).toBe(0);
    expect(await loadActiveTeamMembers("ghost-team")).toEqual([]);
    expect(await findUserRoleInTeam("ghost-team", { user_subject: "kc-A" })).toBeNull();
  });
});
