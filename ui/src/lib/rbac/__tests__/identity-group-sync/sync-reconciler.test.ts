const upsertTeamMembershipSource = jest.fn();
const markTeamMembershipSourceRemoved = jest.fn();
const writeOpenFgaTuples = jest.fn();
const teamsFind = jest.fn();
const teamsInsertOne = jest.fn();

jest.mock("../../team-membership-source-store", () => ({
  upsertTeamMembershipSource: (...args: unknown[]) => upsertTeamMembershipSource(...args),
  markTeamMembershipSourceRemoved: (...args: unknown[]) => markTeamMembershipSourceRemoved(...args),
}));

jest.mock("../../openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => writeOpenFgaTuples(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(async (name: string) => {
    if (name === "teams") {
      return {
        find: (...args: unknown[]) => teamsFind(...args),
        insertOne: (...args: unknown[]) => teamsInsertOne(...args),
      };
    }
    return {};
  }),
}));

describe("identity group sync apply reconciler", () => {
  beforeEach(() => {
    jest.resetModules();
    upsertTeamMembershipSource.mockReset().mockResolvedValue(undefined);
    markTeamMembershipSourceRemoved.mockReset().mockResolvedValue(undefined);
    writeOpenFgaTuples.mockReset().mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    teamsFind.mockReset().mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
    teamsInsertOne.mockReset().mockResolvedValue({ insertedId: "created-team-id" });
  });

  it("persists membership source changes and writes OpenFGA tuple diff", async () => {
    const { applyIdentityGroupSyncPlan } = await import("../../identity-group-sync-reconciler");

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [],
          membership_sources_to_add: [
            {
              team_id: "team-1",
              team_slug: "platform",
              user_subject: "bob-sub",
              relationship: "member",
              source_type: "oidc_claim",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      })
    ).resolves.toEqual({
      teamsCreated: 0,
      membershipSourcesAdded: 1,
      membershipSourcesRemoved: 0,
      tupleWrites: 1,
      tupleDeletes: 0,
      openFgaEnabled: true,
    });

    expect(upsertTeamMembershipSource).toHaveBeenCalledTimes(1);
    expect(writeOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "user:bob-sub", relation: "member", object: "team:platform" }],
      deletes: [],
    });
  });

  it("creates missing teams during reviewed apply and uses created ids for membership sources", async () => {
    const { applyIdentityGroupSyncPlan } = await import("../../identity-group-sync-reconciler");

    await expect(
      applyIdentityGroupSyncPlan({
        plan: {
          matched_groups: [],
          ignored_groups: [],
          teams_to_create: [{ slug: "caipe-users", name: "caipe-users", source_group_id: "caipe-users" }],
          membership_sources_to_add: [
            {
              team_id: "caipe-users",
              team_slug: "caipe-users",
              user_subject: "bob-sub",
              user_email: "bob@example.test",
              relationship: "member",
              source_type: "oidc_claim",
              provider_id: "oidc-claims",
              external_group_id: "caipe-users",
              sync_rule_id: "rule-caipe-users",
              managed: true,
              status: "active",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          membership_sources_to_remove: [],
          tuple_writes: [{ user: "user:bob-sub", relation: "member", object: "team:caipe-users" }],
          tuple_deletes: [],
          skipped_users: [],
          conflicts: [],
        },
        actor: "admin@example.test",
        now: "2026-05-12T01:00:00.000Z",
      })
    ).resolves.toEqual(expect.objectContaining({ teamsCreated: 1, membershipSourcesAdded: 1 }));

    expect(teamsInsertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "caipe-users",
        name: "caipe-users",
        source: "identity_group_sync",
        status: "active",
        created_by: "admin@example.test",
        source_group_id: "caipe-users",
      })
    );
    expect(upsertTeamMembershipSource).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "created-team-id",
        team_slug: "caipe-users",
        user_subject: "bob-sub",
      })
    );
  });
});
