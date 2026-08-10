/**
 * @jest-environment node
 */

describe("baseline FGA profile bundles", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.CAIPE_ORG_KEY = "grid";
  });

  it("creates built-in organization member and admin profiles from defaults", async () => {
    const { defaultBaselineFgaProfileBundle } = await import("../baseline-access");

    const bundle = defaultBaselineFgaProfileBundle();

    expect(bundle.global_member_profile_id).toBe("org-member");
    expect(bundle.global_admin_profile_id).toBe("org-admin");
    expect(bundle.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "org-member",
          role: "member",
          grants: expect.arrayContaining(["organization-member", "own-profile-owner", "mcp-gateway-call"]),
        }),
        expect.objectContaining({
          id: "org-admin",
          role: "admin",
          grants: expect.arrayContaining(["organization-admin", "agentgateway-manage"]),
        }),
      ]),
    );
  });

  it("uses a team member override instead of the global member profile", async () => {
    const { defaultBaselineFgaProfileBundle, effectiveBaselineBootstrapTuples } = await import("../baseline-access");

    const bundle = defaultBaselineFgaProfileBundle();
    bundle.profiles.push({
      id: "support-member",
      name: "Support member",
      role: "member",
      grants: ["organization-member"],
      built_in: false,
    });

    const tuples = effectiveBaselineBootstrapTuples({
      subject: "sub-user",
      isAdmin: false,
      bundle,
      teamOverrides: [{ team_slug: "support", role: "member", member_profile_id: "support-member" }],
    });

    expect(tuples).toEqual([{ user: "user:sub-user", relation: "member", object: "organization:grid" }]);
  });

  it("uses a team admin override instead of the global admin profile", async () => {
    const { defaultBaselineFgaProfileBundle, effectiveBaselineBootstrapTuples } = await import("../baseline-access");

    const bundle = defaultBaselineFgaProfileBundle();
    bundle.profiles.push({
      id: "limited-admin",
      name: "Limited admin",
      role: "admin",
      grants: ["organization-admin"],
      built_in: false,
    });

    const tuples = effectiveBaselineBootstrapTuples({
      subject: "sub-admin",
      isAdmin: true,
      bundle,
      teamOverrides: [{ team_slug: "platform", role: "admin", admin_profile_id: "limited-admin" }],
    });

    expect(tuples).toEqual(
      expect.arrayContaining([
        { user: "user:sub-admin", relation: "member", object: "organization:grid" },
        { user: "user:sub-admin", relation: "admin", object: "organization:grid" },
      ]),
    );
    expect(tuples).not.toEqual(
      expect.arrayContaining([
        { user: "user:sub-admin", relation: "manager", object: "mcp_server:agentgateway" },
      ]),
    );
  });

  it("unions multiple team override profiles without unioning the global profile", async () => {
    const { defaultBaselineFgaProfileBundle, effectiveBaselineBootstrapTuples } = await import("../baseline-access");

    const bundle = defaultBaselineFgaProfileBundle();
    bundle.profiles.push(
      {
        id: "support-member",
        name: "Support member",
        role: "member",
        grants: ["organization-member"],
        built_in: false,
      },
      {
        id: "metrics-member",
        name: "Metrics member",
        role: "member",
        grants: ["admin-surface:metrics:read"],
        built_in: false,
      },
    );

    const tuples = effectiveBaselineBootstrapTuples({
      subject: "sub-user",
      isAdmin: false,
      bundle,
      teamOverrides: [
        { team_slug: "support", role: "member", member_profile_id: "support-member" },
        { team_slug: "observability", role: "member", member_profile_id: "metrics-member" },
      ],
    });

    expect(tuples).toEqual(
      expect.arrayContaining([
        { user: "user:sub-user", relation: "member", object: "organization:grid" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:metrics" },
      ]),
    );
    expect(tuples).not.toEqual(
      expect.arrayContaining([
        { user: "user:sub-user", relation: "owner", object: "user_profile:sub-user" },
      ]),
    );
  });
});
