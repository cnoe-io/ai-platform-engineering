// assisted-by Cursor Claude:claude-opus-4-7
//
// Unit tests for `buildAgentRelationshipTupleDiff` focused on the
// `nextSharedTeamSlugs` / `previousSharedTeamSlugs` plumbing added on
// 2026-05-27 to make the Agent editor's "Share with Teams" multi-select
// genuinely write canonical team-grant tuples to OpenFGA (it used to
// silently persist to Mongo only — see route-rbac.test.ts for the
// route-level regression test).

import { buildAgentRelationshipTupleDiff } from "../openfga-agent-tools";

describe("buildAgentRelationshipTupleDiff: shared_with_teams", () => {
  const baseInput = {
    agentId: "agent-test",
    previousAllowedTools: {},
    nextAllowedTools: {},
    ownerSubject: "alice-sub",
    organizationId: "caipe",
    ownerTeamSlug: "platform",
  } as const;

  it("writes member+admin tuples for the owner team but use-only for shared teams (no member writer)", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre", "ops"],
      previousSharedTeamSlugs: [],
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        // owner team members get both user and manager
        { user: "team:platform#member", relation: "user", object: "agent:agent-test" },
        { user: "team:platform#member", relation: "manager", object: "agent:agent-test" },
        { user: "team:platform#admin", relation: "manager", object: "agent:agent-test" },
        // shared team members AND admins only get user — sharing is use-only
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "writer" }),
        { user: "team:sre#admin", relation: "manager", object: "agent:agent-test" },
        { user: "team:ops#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:sre#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "writer", object: "agent:agent-test" },
        // stale/never-existed admin-manager grants for shared teams are
        // always revoked defensively, whether or not they were ever written
        { user: "team:sre#admin", relation: "manager", object: "agent:agent-test" },
        { user: "team:ops#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
  });

  it("does NOT duplicate tuples when a shared slug is also the owner slug", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["platform", "sre"],
      previousSharedTeamSlugs: [],
    });

    const platformMemberWrites = diff.writes.filter(
      (t) => t.user === "team:platform#member" && t.object === "agent:agent-test",
    );
    // owner team members get user + manager (no duplicates)
    expect(platformMemberWrites.map((t) => t.relation).sort()).toEqual(["manager", "user"]);
    const sreMemberWrites = diff.writes.filter(
      (t) => t.user === "team:sre#member" && t.object === "agent:agent-test",
    );
    // shared-only team members get just user
    expect(sreMemberWrites.map((t) => t.relation).sort()).toEqual(["user"]);
  });

  it("emits deletes for slugs removed from the shared set", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre"],
      previousSharedTeamSlugs: ["sre", "ops"],
    });

    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:ops#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:sre#member", relation: "user" }),
      ]),
    );
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:platform#member", relation: "user" }),
      ]),
    );
  });

  it("does not delete a shared team that has been promoted to owner", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      ownerTeamSlug: "sre",
      previousOwnerTeamSlug: "platform",
      nextSharedTeamSlugs: [],
      previousSharedTeamSlugs: ["sre"],
    });

    // old owner team loses its user grant (from teamGrants diff) and its member manager grant
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "user", object: "agent:agent-test" },
        { user: "team:platform#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:platform#member", relation: "manager", object: "agent:agent-test" },
        { user: "team:platform#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:sre#member", relation: "user" }),
      ]),
    );
    // new owner team gets user + manager for members
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:sre#member", relation: "manager", object: "agent:agent-test" },
        { user: "team:sre#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:sre#member", relation: "writer" }),
      ]),
    );
  });

  it("silently drops invalid slugs without throwing", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre", "", "  ", "!@#$%^"],
      previousSharedTeamSlugs: [],
    });

    const teamSubjects = diff.writes
      .map((t) => t.user)
      .filter((u) => u.startsWith("team:"));
    expect(teamSubjects).toEqual(
      expect.arrayContaining([
        "team:platform#member", // user
        "team:platform#member", // manager (owner team)
        "team:platform#admin",
        "team:sre#member", // shared team: use-only, no #admin manager
      ]),
    );
    expect(teamSubjects).not.toContain("team:sre#admin");
    for (const subject of teamSubjects) {
      expect(subject).not.toMatch(/team:\s/);
      expect(subject).not.toMatch(/team:!/);
    }
  });

  it("is a no-op for the shared set when previous and next match", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre", "ops"],
      previousSharedTeamSlugs: ["sre", "ops"],
    });

    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:sre#member", relation: "writer", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "writer", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        // owner team members get manager
        { user: "team:platform#member", relation: "manager", object: "agent:agent-test" },
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "writer" }),
      ]),
    );
    // shared-only teams must NOT receive the member manager grant
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        { user: "team:sre#member", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        { user: "team:ops#member", relation: "manager", object: "agent:agent-test" },
      ]),
    );
  });

  it("emits no member manager write when ownerTeamSlug is absent", () => {
    const diff = buildAgentRelationshipTupleDiff({
      agentId: "agent-test",
      previousAllowedTools: {},
      nextAllowedTools: {},
      ownerSubject: "alice-sub",
      organizationId: "caipe",
      // no ownerTeamSlug
    });

    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "manager", user: expect.stringContaining("#member") }),
      ]),
    );
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "manager", user: expect.stringContaining("#member") }),
      ]),
    );
  });

  it("deletes member manager grant when owner team is removed (transfer to no team)", () => {
    const diff = buildAgentRelationshipTupleDiff({
      agentId: "agent-test",
      previousAllowedTools: {},
      nextAllowedTools: {},
      ownerSubject: "alice-sub",
      organizationId: "caipe",
      ownerTeamSlug: undefined,
      previousOwnerTeamSlug: "platform",
    });

    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.writes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: "manager", user: expect.stringContaining("#member") }),
      ]),
    );
  });
});
