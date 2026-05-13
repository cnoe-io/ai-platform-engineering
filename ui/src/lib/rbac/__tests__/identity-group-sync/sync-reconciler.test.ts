const upsertTeamMembershipSource = jest.fn();
const markTeamMembershipSourceRemoved = jest.fn();
const writeOpenFgaTuples = jest.fn();

jest.mock("../../team-membership-source-store", () => ({
  upsertTeamMembershipSource: (...args: unknown[]) => upsertTeamMembershipSource(...args),
  markTeamMembershipSourceRemoved: (...args: unknown[]) => markTeamMembershipSourceRemoved(...args),
}));

jest.mock("../../openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => writeOpenFgaTuples(...args),
}));

describe("identity group sync apply reconciler", () => {
  beforeEach(() => {
    jest.resetModules();
    upsertTeamMembershipSource.mockReset().mockResolvedValue(undefined);
    markTeamMembershipSourceRemoved.mockReset().mockResolvedValue(undefined);
    writeOpenFgaTuples.mockReset().mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
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
});
