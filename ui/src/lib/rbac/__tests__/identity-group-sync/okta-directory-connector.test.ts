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
// When set, the mock oauth.getAccessToken throws this on the first call (no nonce).
let mockDpopNonceError: (Error & { status?: number; headers?: { get: (k: string) => string | null } }) | null = null;

// Captures the last Client instance so tests can inspect oauth state after a call.
let lastClientInstance: { oauth?: { isDPoP: boolean; accessToken: unknown } } | null = null;

function makeCollection<T>(items: T[]) {
  return {
    each: async (iterator: (item: T) => unknown) => {
      for (const item of items) await iterator(item);
    },
    next: async () => ({ done: items.length === 0, value: items[0] ?? null }),
  };
}

const listGroupsCalls: Array<Record<string, unknown>> = [];

jest.mock(
  "@okta/okta-sdk-nodejs",
  () => ({
    // assisted-by Codex Codex-sonnet-4-6
    Client: class {
      groupApi: {
        listGroups: (args?: unknown) => Promise<unknown>;
        listGroupUsers: (args: { groupId: string }) => Promise<unknown>;
      };
      oauth: { isDPoP: boolean; accessToken: unknown; getAccessToken: (nonce?: string | null) => Promise<unknown> };
      constructor(config: unknown) {
        clientCtor(config);
        // Simulate the SDK's OAuth object. patchOAuthDpopNonce wraps getAccessToken,
        // so we set up the real-looking shape here. mockDpopNonceError lets tests
        // inject a use_dpop_nonce failure on the first (no-nonce) call.
        this.oauth = {
          isDPoP: false,
          accessToken: null,
          getAccessToken: async function (nonce?: string | null) {
            if (this.accessToken) return this.accessToken;
            if (mockDpopNonceError && !nonce) throw mockDpopNonceError;
            const tokenType = mockDpopNonceError ? "DPoP" : "Bearer";
            this.accessToken = { access_token: "mock-token", token_type: tokenType };
            return this.accessToken;
          },
        };
        lastClientInstance = this as typeof lastClientInstance;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        this.groupApi = {
          // Simulate the SDK calling oauth.getAccessToken before each request,
          // so tests can exercise the DPoP patch without the real HTTP layer.
          listGroups: async (args?: unknown) => {
            await self.oauth.getAccessToken();
            listGroupsCalls.push((args ?? {}) as Record<string, unknown>);
            if (listGroupsError) throw listGroupsError;
            return makeCollection(mockGroups);
          },
          listGroupUsers: async ({ groupId }: { groupId: string }) =>
            makeCollection(mockUsersByGroup[groupId] ?? []),
        };
      }
    },
  }),
  { virtual: true },
);

describe("Okta directory connector (SDK-based)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    clientCtor.mockReset();
    mockGroups = [];
    mockUsersByGroup = {};
    listGroupsError = null;
    mockDpopNonceError = null;
    listGroupsCalls.length = 0;
    lastClientInstance = null;
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
          {
            subject: undefined,
            email: "bob@example.test",
            okta_user_id: "00u-bob",
            display_name: "Bob Example",
            active: true,
          },
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
      {
        subject: undefined,
        email: "gone@example.test",
        okta_user_id: "u1",
        display_name: "gone@example.test",
        active: false,
      },
      {
        subject: undefined,
        email: "ok@example.test",
        okta_user_id: "u2",
        display_name: "ok@example.test",
        active: true,
      },
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

  describe("DPoP nonce retry (patchOAuthDpopNonce)", () => {
    const oauthEnv = {
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID: "0oaclient",
      IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    };

    it("retries with the nonce and sets isDPoP=true when Okta returns use_dpop_nonce (400 + dpop-nonce header)", async () => {
      process.env = { ...originalEnv, ...oauthEnv };
      mockGroups = [];
      // Inject a use_dpop_nonce error that carries the nonce in its headers.
      // patchOAuthDpopNonce catches this, reads the nonce, retries, and sets isDPoP.
      mockDpopNonceError = Object.assign(new Error("use_dpop_nonce"), {
        status: 400,
        headers: { get: (k: string) => (k === "dpop-nonce" ? "server-nonce-xyz" : null) },
      });

      const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
      // Should not throw: the patch retries with the nonce successfully.
      await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).resolves.toEqual([]);
      // isDPoP must be set so subsequent API calls use DPoP-bound auth.
      expect(lastClientInstance?.oauth?.isDPoP).toBe(true);
    });

    it("does not retry and re-throws when the 400 has no dpop-nonce header", async () => {
      process.env = { ...originalEnv, ...oauthEnv };
      mockGroups = [];
      // 400 error but no nonce header — should not retry, should propagate.
      mockDpopNonceError = Object.assign(new Error("Bad Request"), {
        status: 400,
        headers: { get: () => null },
      });

      const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
      await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).rejects.toThrow("Bad Request");
    });
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
