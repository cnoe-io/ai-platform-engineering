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

  it("writes member+admin tuples for every additional shared team", () => {
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre", "ops"],
      previousSharedTeamSlugs: [],
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "user", object: "agent:agent-test" },
        { user: "team:platform#admin", relation: "manager", object: "agent:agent-test" },
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:sre#admin", relation: "manager", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    expect(diff.deletes).toEqual([]);
  });

  it("does NOT duplicate tuples when a shared slug is also the owner slug", () => {
    // Defensive: even though the route filters out the owner slug
    // before passing `nextSharedTeamSlugs`, the diff builder is the
    // last line of defence — passing an overlapping slug must not
    // produce duplicate write entries.
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      ownerTeamSlug: "platform",
      nextSharedTeamSlugs: ["platform", "sre"],
      previousSharedTeamSlugs: [],
    });

    const platformMemberWrites = diff.writes.filter(
      (t) => t.user === "team:platform#member" && t.object === "agent:agent-test",
    );
    expect(platformMemberWrites).toHaveLength(1);
    const sreMemberWrites = diff.writes.filter(
      (t) => t.user === "team:sre#member" && t.object === "agent:agent-test",
    );
    expect(sreMemberWrites).toHaveLength(1);
  });

  it("emits deletes for slugs removed from the shared set", () => {
    // Admin unchecks "ops" in the editor. The diff must include a
    // delete for both the member and admin tuple so the team
    // genuinely loses `can_use` / `can_manage` on the agent. Without
    // this delete the team kept its grant forever (the original bug).
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre"],
      previousSharedTeamSlugs: ["sre", "ops"],
    });

    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    // And NOT a delete for sre (still shared) or platform (owner).
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:sre#member" }),
      ]),
    );
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:platform#member" }),
      ]),
    );
  });

  it("does not delete a shared team that has been promoted to owner", () => {
    // Edge case: admin changes ownerTeamSlug from "platform" to "sre"
    // (sre was previously in shared_with_teams). The reconciler
    // already emits a delete for the *old* owner team via
    // `previousOwnerTeamSlug`. It must NOT also emit a delete for sre
    // just because sre moved off `shared_with_teams` — sre's tuples
    // are still required by the new owner role.
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      ownerTeamSlug: "sre",
      previousOwnerTeamSlug: "platform",
      nextSharedTeamSlugs: [],
      previousSharedTeamSlugs: ["sre"],
    });

    // platform (old owner) should be deleted — that's existing
    // owner-team transition behaviour.
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "user", object: "agent:agent-test" },
        { user: "team:platform#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
    // sre must NOT be deleted — it's now the owner.
    expect(diff.deletes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: "team:sre#member" }),
      ]),
    );
    // sre's owner tuples must be written.
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:sre#admin", relation: "manager", object: "agent:agent-test" },
      ]),
    );
  });

  it("silently drops invalid slugs without throwing", () => {
    // Defensive: even though the route resolver should never pass a
    // bogus slug, the diff builder uses the same OpenFGA id pattern
    // and must skip anything that fails the regex rather than
    // producing tuples with garbage subject ids.
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
        "team:platform#member",
        "team:platform#admin",
        "team:sre#member",
        "team:sre#admin",
      ]),
    );
    // No garbage slug bled through.
    for (const subject of teamSubjects) {
      expect(subject).not.toMatch(/team:\s/);
      expect(subject).not.toMatch(/team:!/);
    }
  });

  it("is a no-op for the shared set when previous and next match", () => {
    // Idempotent re-reconcile (e.g. another field on the agent was
    // edited, but the team membership didn't change). The shared set
    // contributes 4 writes (sre member+admin, ops member+admin) but
    // ZERO deletes.
    const diff = buildAgentRelationshipTupleDiff({
      ...baseInput,
      nextSharedTeamSlugs: ["sre", "ops"],
      previousSharedTeamSlugs: ["sre", "ops"],
    });

    expect(diff.deletes).toEqual([]);
    // Writes are idempotent at the OpenFGA layer, so they're still
    // produced — the downstream `writeOpenFgaTupleDiff` no-ops on
    // tuples that already exist.
    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "team:sre#member", relation: "user", object: "agent:agent-test" },
        { user: "team:ops#member", relation: "user", object: "agent:agent-test" },
      ]),
    );
  });
});
