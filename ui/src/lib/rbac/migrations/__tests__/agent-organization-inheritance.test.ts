jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

import {
  deriveAdminSurfaceRagDatasourcesAdminGrantPlan,
  deriveAgentOrganizationInheritancePlan,
  deriveAgentSharedTeamGrantsPlan,
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

// assisted-by Cursor Claude:claude-opus-4-7
//
// Regression test for the May-27-2026 silent-shared-team-grant bug:
// before this migration, the dynamic_agents.shared_with_teams field
// was Mongo-only — no canonical OpenFGA `team:<slug>#member can_use
// agent:<id>` tuples were written. The backfill walks every existing
// agent, resolves shared entries (legacy _id OR slug) against the
// teams collection, and writes the two-tuple pair per shared team.
describe("agent shared team grants migration", () => {
  it("writes member+admin tuples for every resolved shared team and skips the owner-team duplicate", () => {
    const plan = deriveAgentSharedTeamGrantsPlan(
      [
        {
          _id: "agent-deploy-helper",
          owner_team_slug: "platform",
          // Mixed legacy + modern + duplicate + bogus entries — only
          // sre + ops should produce tuples (platform is owner,
          // "missing-team" doesn't exist).
          shared_with_teams: [
            "507f1f77bcf86cd799439011", // → sre via _id
            "ops", // → ops via slug
            "platform", // owner — must be filtered
            "missing-team", // unresolved — warning only
          ],
        },
        {
          _id: "agent-noop",
          owner_team_slug: "platform",
          shared_with_teams: [],
        },
        {
          _id: "bad id",
          owner_team_slug: "platform",
          shared_with_teams: ["sre"],
        },
      ],
      [
        { _id: "507f1f77bcf86cd799439011", slug: "sre" },
        { slug: "ops" },
        { slug: "platform" },
      ],
    );

    expect(plan.counts).toMatchObject({
      agents_scanned: 3,
      agents_with_shared_teams: 1,
      shared_slugs_resolved: 2,
      unresolved_entries: 1,
      teams_scanned: 3,
      tuples_planned: 4,
    });
    expect(plan.tuple_writes_planned).toBe(4);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "agent_shared_team_grants_backfill_v1:0",
        before: {},
        after: { user: "team:sre#member", relation: "user", object: "agent:agent-deploy-helper" },
      },
      {
        collection: "openfga_tuples",
        id: "agent_shared_team_grants_backfill_v1:1",
        before: {},
        after: { user: "team:sre#admin", relation: "manager", object: "agent:agent-deploy-helper" },
      },
      {
        collection: "openfga_tuples",
        id: "agent_shared_team_grants_backfill_v1:2",
        before: {},
        after: { user: "team:ops#member", relation: "user", object: "agent:agent-deploy-helper" },
      },
      {
        collection: "openfga_tuples",
        id: "agent_shared_team_grants_backfill_v1:3",
        before: {},
        after: { user: "team:ops#admin", relation: "manager", object: "agent:agent-deploy-helper" },
      },
    ]);
    // Warnings exist for the bad agent id and the unresolved team
    // reference — the migration must surface these instead of silently
    // dropping them, so admins know exactly what wasn't backfilled.
    expect(plan.warnings.some((w: string) => w.includes("missing-team"))).toBe(true);
    expect(plan.warnings.some((w: string) => w.includes("bad id"))).toBe(true);
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

describe("admin_surface:rag_datasources admin grant migration", () => {
  it("writes manager tuples for every org admin and dedupes repeated subjects", () => {
    const plan = deriveAdminSurfaceRagDatasourcesAdminGrantPlan([
      "admin-one",
      "admin-two",
      "admin-one", // duplicate
      "  admin-three  ", // whitespace
    ]);

    expect(plan.counts).toMatchObject({
      admins_scanned: 4,
      admins_resolved: 3,
      tuples_planned: 3,
      invalid_subjects: 0,
    });
    expect(plan.tuple_writes_planned).toBe(3);
    expect(plan.sample_diffs).toEqual([
      {
        collection: "openfga_tuples",
        id: "admin_surface_rag_datasources_admin_grant_v1:0",
        before: {},
        after: {
          user: "user:admin-one",
          relation: "manager",
          object: "admin_surface:rag_datasources",
        },
      },
      {
        collection: "openfga_tuples",
        id: "admin_surface_rag_datasources_admin_grant_v1:1",
        before: {},
        after: {
          user: "user:admin-two",
          relation: "manager",
          object: "admin_surface:rag_datasources",
        },
      },
      {
        collection: "openfga_tuples",
        id: "admin_surface_rag_datasources_admin_grant_v1:2",
        before: {},
        after: {
          user: "user:admin-three",
          relation: "manager",
          object: "admin_surface:rag_datasources",
        },
      },
    ]);
  });

  it("warns and skips subjects that fail OpenFGA id validation", () => {
    const plan = deriveAdminSurfaceRagDatasourcesAdminGrantPlan([
      "valid-sub",
      "bad sub with space",
      "",
    ]);

    expect(plan.counts).toMatchObject({
      admins_scanned: 3,
      admins_resolved: 1,
      tuples_planned: 1,
      invalid_subjects: 1,
    });
    expect(plan.warnings.some((w: string) => w.includes("bad sub with space"))).toBe(true);
  });
});
