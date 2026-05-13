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
    expect(find).toHaveBeenCalledWith({ provider_id: "oidc-claims" });
    expect(sort).toHaveBeenCalledWith({ priority: 1, name: 1 });
  });

  it("upserts membership sources by source identity", async () => {
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    getRbacCollection.mockResolvedValue({ updateOne });

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
  });
});
