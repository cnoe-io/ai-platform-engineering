/**
 * @jest-environment node
 */

import {
  buildAgentSkillShareTupleDiff,
  deriveAgentSkillOpenFgaReconcilePlan,
  groupSkillTuplesById,
  skillHasOrgWideUserGrant,
  teamSlugsFromSkillTuples,
} from "../agent-skill-openfga-reconcile";

describe("agent-skill-openfga-reconcile", () => {
  it("reads team slugs from existing skill user tuples", () => {
    const tuples = [
      { user: "team:platform#member", relation: "user", object: "skill:hello" },
      { user: "team:sre#member", relation: "user", object: "skill:hello" },
      { user: "user:alice-sub", relation: "owner", object: "skill:hello" },
    ];
    expect(teamSlugsFromSkillTuples("hello", tuples)).toEqual(["platform", "sre"]);
  });

  it("revokes stale team grants when Mongo visibility is private", () => {
    const existingTuples = [
      { user: "team:platform#member", relation: "user", object: "skill:hello" },
      { user: "team:platform#admin", relation: "manager", object: "skill:hello" },
      { user: "user:alice-sub", relation: "owner", object: "skill:hello" },
    ];
    const { diff } = buildAgentSkillShareTupleDiff({
      skillId: "hello",
      visibility: "private",
      sharedTeamRefs: [],
      ownerSubject: "alice-sub",
      existingTuples,
      slugByMongoId: new Map(),
      knownSlugs: new Set(["platform"]),
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        { user: "user:alice-sub", relation: "owner", object: "skill:hello" },
        { user: "user:alice-sub", relation: "creator", object: "skill:hello" },
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "user", object: "skill:hello" },
        { user: "team:platform#admin", relation: "manager", object: "skill:hello" },
      ]),
    );
  });

  it("grants org-wide user access for global visibility", () => {
    const { diff } = buildAgentSkillShareTupleDiff({
      skillId: "global-skill",
      visibility: "global",
      sharedTeamRefs: [],
      ownerSubject: "bob-sub",
      existingTuples: [],
      slugByMongoId: new Map(),
      knownSlugs: new Set(),
    });

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        {
          user: "organization:caipe#member",
          relation: "user",
          object: "skill:global-skill",
        },
      ]),
    );
    expect(skillHasOrgWideUserGrant("global-skill", diff.writes)).toBe(true);
  });

  it("plans aggregate writes and deletes across skills", () => {
    const tuplesBySkillId = groupSkillTuplesById([
      { user: "team:platform#member", relation: "user", object: "skill:hello" },
    ]);
    const plan = deriveAgentSkillOpenFgaReconcilePlan({
      skills: [
        {
          id: "hello",
          owner_id: "alice@example.com",
          visibility: "private",
        },
      ],
      tuplesBySkillId,
      subjectsByOwnerEmail: new Map([["alice@example.com", "alice-sub"]]),
      slugByMongoId: new Map(),
      knownSlugs: new Set(["platform"]),
    });

    expect(plan.counts.skills_reconciled).toBe(1);
    expect(plan.deletes).toEqual(
      expect.arrayContaining([
        { user: "team:platform#member", relation: "user", object: "skill:hello" },
      ]),
    );
  });
});
