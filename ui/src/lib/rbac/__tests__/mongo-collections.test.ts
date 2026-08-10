import {
  RBAC_COLLECTION_NAMES,
  getRbacCollectionName,
  listRbacCollectionNames,
} from "../mongo-collections";

describe("RBAC Mongo collection helpers", () => {
  it("defines stable collection names for identity sync and universal ReBAC state", () => {
    expect(RBAC_COLLECTION_NAMES.identityProviders).toBe("identity_providers");
    expect(RBAC_COLLECTION_NAMES.teamMembershipSources).toBe("team_membership_sources");
    expect(RBAC_COLLECTION_NAMES.rebacRelationships).toBe("rebac_relationships");
    expect(RBAC_COLLECTION_NAMES.slackChannelGrants).toBe("slack_channel_grants");
  });

  it("lists every collection name once", () => {
    const names = listRbacCollectionNames();

    expect(names).toContain("identity_group_sync_rules");
    expect(names).toContain("policy_change_sets");
    expect(new Set(names).size).toBe(names.length);
  });

  it("looks up collection names by key", () => {
    expect(getRbacCollectionName("externalGroupTeamLinks")).toBe("external_group_team_links");
  });
});
