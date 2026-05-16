const applyIdentityGroupSyncPlan = jest.fn();
const listIdentityGroupSyncRules = jest.fn();

jest.mock("../../identity-group-sync-reconciler", () => ({
  applyIdentityGroupSyncPlan: (...args: unknown[]) => applyIdentityGroupSyncPlan(...args),
}));

jest.mock("../../identity-group-sync-rule-store", () => ({
  listIdentityGroupSyncRules: (...args: unknown[]) => listIdentityGroupSyncRules(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async (name: string) => {
    if (name === "teams") {
      return {
        find: jest.fn().mockReturnValue({
          project: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([]),
          }),
        }),
      };
    }
    return {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      }),
    };
  }),
}));

describe("OIDC claim identity group reconciliation", () => {
  beforeEach(() => {
    jest.resetModules();
    applyIdentityGroupSyncPlan.mockReset().mockResolvedValue({
      membershipSourcesAdded: 1,
      membershipSourcesRemoved: 0,
      tupleWrites: 1,
      tupleDeletes: 0,
      openFgaEnabled: true,
    });
    listIdentityGroupSyncRules.mockReset().mockResolvedValue([
      {
        id: "rule-platform",
        provider_id: "oidc-claims",
        name: "Platform users",
        priority: 10,
        enabled: true,
        review_status: "enabled",
        include_patterns: ["^Engineering (?<team>Platform) (?<role>Users)$"],
        exclude_patterns: [],
        team_name_template: "{{team}}",
        team_slug_template: "{{team}}",
        role_map: { Users: "member" },
        auto_create_team: true,
        created_by: "test",
        created_at: "2026-05-12T00:00:00.000Z",
        updated_by: "test",
        updated_at: "2026-05-12T00:00:00.000Z",
      },
    ]);
  });

  it("converts memberOf groups into external group records scoped to the signed-in user", async () => {
    const { groupsToExternalGroupsForUser } = await import("../../oidc-claim-reconciler");

    expect(
      groupsToExternalGroupsForUser({
        providerId: "oidc-claims",
        groups: ["Engineering Platform Users"],
        user: { subject: "keycloak-sub", email: "bob@example.test", displayName: "Bob" },
      })
    ).toEqual([
      expect.objectContaining({
        provider_id: "oidc-claims",
        external_group_id: "Engineering Platform Users",
        display_name: "Engineering Platform Users",
        members: [
          {
            subject: "keycloak-sub",
            email: "bob@example.test",
            display_name: "Bob",
            active: true,
          },
        ],
      }),
    ]);
  });

  it("plans and applies signed-in user claim reconciliation with enabled rules", async () => {
    const { reconcileOidcClaimGroupsForUser } = await import("../../oidc-claim-reconciler");

    await reconcileOidcClaimGroupsForUser({
      subject: "keycloak-sub",
      email: "bob@example.test",
      displayName: "Bob",
      groups: ["Engineering Platform Users"],
      now: "2026-05-12T00:00:00.000Z",
    });

    expect(listIdentityGroupSyncRules).toHaveBeenCalledWith("oidc-claims");
    expect(applyIdentityGroupSyncPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "login:oidc-claims",
        plan: expect.objectContaining({
          matched_groups: [expect.objectContaining({ display_name: "Engineering Platform Users" })],
        }),
      })
    );
  });
});
