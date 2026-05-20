jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

import {
  deriveAgentOrganizationInheritancePlan,
  deriveOrganizationMembershipPlan,
  deriveSkillHubTeamGrantPlan,
} from "../registry";

describe("agent organization inheritance migration", () => {
  it("plans organization-admin manager tuples for existing dynamic agents", () => {
    const plan = deriveAgentOrganizationInheritancePlan([
      { _id: "agent-one" },
      { id: "agent-two" },
      { _id: "bad id" },
    ]);

    expect(plan.counts).toMatchObject({
      agents_scanned: 3,
      tuples_planned: 2,
      invalid_identifiers: 1,
    });
    expect(plan.tuple_writes_planned).toBe(2);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "agent_org_admin_inheritance_v1:0",
        before: {},
        after: { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-one" },
      },
      {
        collection: "openfga_tuples",
        id: "agent_org_admin_inheritance_v1:1",
        before: {},
        after: { user: "organization:caipe#admin", relation: "manager", object: "agent:agent-two" },
      },
    ]);
  });
});

describe("organization membership migration", () => {
  it("plans organization member tuples for existing users with stable subjects", () => {
    const plan = deriveOrganizationMembershipPlan(
      [
        { email: "alice@example.com", keycloak_sub: "alice-sub" },
        { email: "bob@example.com", metadata: { keycloak_sub: "bob-sub" } },
        { email: "bad@example.com", keycloak_sub: "bad subject" },
        { email: "missing@example.com" },
      ],
      "caipe",
    );

    expect(plan.counts).toMatchObject({
      users_scanned: 4,
      users_with_subjects: 2,
      tuples_planned: 2,
      invalid_subjects: 1,
      missing_subjects: 1,
    });
    expect(plan.tuple_writes_planned).toBe(2);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "organization_membership_backfill_v1:0",
        before: {},
        after: { user: "user:alice-sub", relation: "member", object: "organization:caipe" },
      },
      {
        collection: "openfga_tuples",
        id: "organization_membership_backfill_v1:1",
        before: {},
        after: { user: "user:bob-sub", relation: "member", object: "organization:caipe" },
      },
    ]);
  });
});

describe("skill hub team grant migration", () => {
  it("plans team member skill user tuples for already-crawled hub skills", () => {
    const plan = deriveSkillHubTeamGrantPlan({
      hubs: [
        { id: "hub-one", shared_with_teams: ["507f1f77bcf86cd799439011", "sre"] },
        { id: "hub-two", shared_with_teams: [] },
      ],
      hubSkills: [
        { hub_id: "hub-one", skill_id: "deploy" },
        { hub_id: "hub-one", skill_id: "debug" },
        { hub_id: "hub-two", skill_id: "ignored" },
      ],
      teams: [
        { _id: "507f1f77bcf86cd799439011", slug: "platform" },
        { slug: "sre" },
      ],
    });

    expect(plan.counts).toMatchObject({
      hubs_scanned: 2,
      hubs_with_team_grants: 1,
      hub_skills_scanned: 3,
      tuples_planned: 4,
    });
    expect(plan.tuple_writes_planned).toBe(4);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "skill_hub_team_grants_backfill_v1:0",
        before: {},
        after: { user: "team:platform#member", relation: "user", object: "skill:hub-hub-one-deploy" },
      },
      {
        collection: "openfga_tuples",
        id: "skill_hub_team_grants_backfill_v1:1",
        before: {},
        after: { user: "team:platform#member", relation: "user", object: "skill:hub-hub-one-debug" },
      },
      {
        collection: "openfga_tuples",
        id: "skill_hub_team_grants_backfill_v1:2",
        before: {},
        after: { user: "team:sre#member", relation: "user", object: "skill:hub-hub-one-deploy" },
      },
      {
        collection: "openfga_tuples",
        id: "skill_hub_team_grants_backfill_v1:3",
        before: {},
        after: { user: "team:sre#member", relation: "user", object: "skill:hub-hub-one-debug" },
      },
    ]);
  });
});
