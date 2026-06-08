// The connector now delegates pagination + rate-limit handling to the Okta
// SDK, so these tests mock the SDK Client and assert the parts WE own: auth
// config resolution (SSWS vs OAuth, JWK vs PEM), group->external-group mapping,
// and the health probe. We capture the Client constructor config to verify the
// right auth mode is selected.

const clientCtor = jest.fn();

// Each test sets these to control what the mocked SDK returns.
let mockGroups: unknown[] = [];
let mockUsersByGroup: Record<string, unknown[]> = {};
let listGroupsError: Error | null = null;

function makeCollection<T>(items: T[]) {
  return {
    each: async (iterator: (item: T) => unknown) => {
      for (const item of items) await iterator(item);
    },
    next: async () => ({ done: items.length === 0, value: items[0] ?? null }),
  };
}

const listGroupsCalls: Array<Record<string, unknown>> = [];

jest.mock("@okta/okta-sdk-nodejs", () => ({
  Client: class {
    groupApi: {
      listGroups: (args?: unknown) => Promise<unknown>;
      listGroupUsers: (args: { groupId: string }) => Promise<unknown>;
    };
    constructor(config: unknown) {
      clientCtor(config);
      this.groupApi = {
        listGroups: async (args?: unknown) => {
          listGroupsCalls.push((args ?? {}) as Record<string, unknown>);
          if (listGroupsError) throw listGroupsError;
          return makeCollection(mockGroups);
        },
        listGroupUsers: async ({ groupId }: { groupId: string }) =>
          makeCollection(mockUsersByGroup[groupId] ?? []),
      };
    }
  },
}));

describe("Okta directory connector (SDK-based)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    clientCtor.mockReset();
    mockGroups = [];
    mockUsersByGroup = {};
    listGroupsError = null;
    listGroupsCalls.length = 0;
    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_API_TOKEN: "test-token",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("maps Okta groups + members into external groups (SSWS token auth)", async () => {
    mockGroups = [
      {
        id: "00g-platform",
        profile: { name: "Engineering Platform Users", description: "Platform team users" },
        lastUpdated: "2026-05-12T00:00:00.000Z",
      },
    ];
    mockUsersByGroup["00g-platform"] = [
      { id: "00u-bob", status: "ACTIVE", profile: { email: "bob@example.test", displayName: "Bob Example" } },
    ];

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const groups = await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(groups).toEqual([
      expect.objectContaining({
        provider_id: "okta-main",
        // Keyed by group NAME (not Okta id) so it matches the login/OIDC path
        // and a user synced via both doesn't get two membership rows.
        external_group_id: "Engineering Platform Users",
        display_name: "Engineering Platform Users",
        member_count: 1,
        members: [
          { subject: undefined, email: "bob@example.test", display_name: "Bob Example", active: true },
        ],
      }),
    ]);
    // SSWS auth: client built with a token, not OAuth.
    expect(clientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ orgUrl: "https://example.okta.com", token: "test-token" })
    );
  });

  it("keys external_group_id by group name, fetching members by Okta id", async () => {
    mockGroups = [{ id: "00gABC123", profile: { name: "sg-pfm-d4s" } }];
    mockUsersByGroup["00gABC123"] = [
      { id: "u1", status: "ACTIVE", profile: { email: "a@example.test" } },
    ];

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const [group] = await fetchOktaExternalGroups({ providerId: "okta-main" });

    // Identity keyed by name (matches OIDC login path), not the Okta id.
    expect(group.external_group_id).toBe("sg-pfm-d4s");
    expect(group.members).toHaveLength(1);
  });

  it("sends the group filter via `search`, not `filter` (profile.* needs search)", async () => {
    process.env.IDENTITY_SYNC_OKTA_GROUP_FILTER = 'profile.name eq "sg-pfm-d4s"';
    mockGroups = [];

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    await fetchOktaExternalGroups({ providerId: "okta-main" });

    // Okta's `filter` param only supports id/type/lastUpdated; profile
    // attributes must go through `search`, else Okta returns E0000031.
    expect(listGroupsCalls[0]).toMatchObject({ search: 'profile.name eq "sg-pfm-d4s"' });
    expect(listGroupsCalls[0]).not.toHaveProperty("filter");
  });

  it("marks deprovisioned/suspended members inactive and falls back to login for email", async () => {
    mockGroups = [{ id: "g1", profile: { name: "G1" } }];
    mockUsersByGroup["g1"] = [
      { id: "u1", status: "DEPROVISIONED", profile: { login: "gone@example.test" } },
      { id: "u2", status: "ACTIVE", profile: { email: "ok@example.test" } },
    ];

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const [group] = await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(group.members).toEqual([
      { subject: undefined, email: "gone@example.test", display_name: "gone@example.test", active: false },
      { subject: undefined, email: "ok@example.test", display_name: "ok@example.test", active: true },
    ]);
  });

  it("builds an OAuth client (private-key JWT) with least-privilege scopes; JWK key parsed to object", async () => {
    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID: "0oaclient",
      IDENTITY_SYNC_OKTA_OAUTH_KEY_ID: "kid-1",
      IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY: JSON.stringify({ kty: "RSA", kid: "jwk-kid", d: "x", n: "y", e: "AQAB" }),
    };
    mockGroups = [];

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(clientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUrl: "https://example.okta.com",
        authorizationMode: "PrivateKey",
        clientId: "0oaclient",
        keyId: "kid-1",
        scopes: ["okta.groups.read", "okta.users.read"],
        privateKey: expect.objectContaining({ kty: "RSA" }),
      })
    );
  });

  it("passes a PEM private key through as a string", async () => {
    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID: "0oaclient",
      IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    };

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(clientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationMode: "PrivateKey",
        privateKey: expect.stringContaining("BEGIN PRIVATE KEY"),
      })
    );
  });

  it("fails closed when Okta credentials are not configured", async () => {
    delete process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
    const { fetchOktaExternalGroups, isOktaConnectorConfigured } = await import(
      "../../okta-directory-connector"
    );
    expect(isOktaConnectorConfigured()).toBe(false);
    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).rejects.toThrow(
      "Okta directory connector is not configured"
    );
  });

  describe("checkOktaConnectorHealth", () => {
    it("returns ok when the probe list call succeeds (token mode)", async () => {
      mockGroups = [{ id: "g1", profile: { name: "G1" } }];
      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      await expect(checkOktaConnectorHealth()).resolves.toEqual({ ok: true, mode: "token" });
    });

    it("returns a failure (with scope hint) when the probe throws 403", async () => {
      listGroupsError = new Error("Okta HTTP 403 Forbidden");
      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      const health = await checkOktaConnectorHealth();
      expect(health.ok).toBe(false);
      expect(health.mode).toBe("token");
      expect((health as { error: string }).error).toMatch(/scopes okta\.groups\.read/);
    });

    it("reports unconfigured when no credentials are present", async () => {
      delete process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      expect(await checkOktaConnectorHealth()).toMatchObject({ ok: false, mode: "unconfigured" });
    });
  });
});
