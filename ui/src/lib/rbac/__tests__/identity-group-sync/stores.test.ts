const getRbacCollection = jest.fn();

jest.mock("../../mongo-collections", () => ({
  getRbacCollection: (...args: unknown[]) => getRbacCollection(...args),
}));

describe("identity group sync stores", () => {
  beforeEach(() => {
    jest.resetModules();
    getRbacCollection.mockReset();
  });

  it("lists sync rules by provider ordered by priority", async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const sort = jest.fn().mockReturnValue({ toArray });
    const find = jest.fn().mockReturnValue({ sort });
    getRbacCollection.mockResolvedValue({ find });

    const { listIdentityGroupSyncRules } = await import("../../identity-group-sync-rule-store");
    await listIdentityGroupSyncRules("oidc-claims");

    expect(getRbacCollection).toHaveBeenCalledWith("identityGroupSyncRules");
    // Provider-scoped queries also include wildcard ("*") rules so the shared
    // catch-all applies regardless of which IdP produced the groups.
    expect(find).toHaveBeenCalledWith({ provider_id: { $in: ["oidc-claims", "*"] } });
    expect(sort).toHaveBeenCalledWith({ priority: 1, name: 1 });
  });

  it("upserts membership sources by source identity", async () => {
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 0 });
    getRbacCollection.mockResolvedValue({ updateOne, deleteMany });

    const { upsertTeamMembershipSource } = await import("../../team-membership-source-store");
    await upsertTeamMembershipSource({
      team_id: "team-1",
      team_slug: "platform",
      user_subject: "user-sub",
      relationship: "member",
      source_type: "oidc_claim",
      provider_id: "oidc-claims",
      external_group_id: "gid",
      sync_rule_id: "rule",
      managed: true,
      status: "active",
      created_at: "2026-05-12T00:00:00.000Z",
    });

    expect(getRbacCollection).toHaveBeenCalledWith("teamMembershipSources");
    expect(updateOne).toHaveBeenCalledWith(
      {
        team_slug: "platform",
        user_subject: "user-sub",
        relationship: "member",
        source_type: "oidc_claim",
        provider_id: "oidc-claims",
        external_group_id: "gid",
        sync_rule_id: "rule",
      },
      expect.objectContaining({ $set: expect.objectContaining({ status: "active" }) }),
      { upsert: true }
    );
    // The new orphan-collapse path in #1555 also calls `deleteMany` to drop
    // stale `status:"removed"` rows when a user re-appears under a different
    // relationship. We assert that the mock is invoked with the same logical
    // identity but a different status filter so it cannot collide with active
    // rows.
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        team_slug: "platform",
        user_subject: "user-sub",
        source_type: "oidc_claim",
        status: "removed",
      })
    );
  });
});
