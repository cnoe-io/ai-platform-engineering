// Sign a deterministic, fake assertion so the OAuth path doesn't need a real
// PEM private key. The chainable SignJWT builder mirrors the jose API surface
// the connector uses.
jest.mock("jose", () => {
  const builder = {
    setProtectedHeader: () => builder,
    setIssuer: () => builder,
    setSubject: () => builder,
    setAudience: () => builder,
    setIssuedAt: () => builder,
    setExpirationTime: () => builder,
    setJti: () => builder,
    sign: async () => "signed-client-assertion",
  };
  return {
    importPKCS8: jest.fn(async () => ({})),
    importJWK: jest.fn(async () => ({})),
    SignJWT: jest.fn(() => builder),
  };
});

describe("Okta directory connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
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

  it("fetches Okta groups and members as identity sync external groups", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/api/v1/groups?limit=200")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [
            {
              id: "00g-platform",
              profile: { name: "Engineering Platform Users", description: "Platform team users" },
              lastUpdated: "2026-05-12T00:00:00.000Z",
            },
          ],
        } as Response;
      }
      if (value.endsWith("/api/v1/groups/00g-platform/users?limit=1000")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [
            {
              id: "00u-bob",
              status: "ACTIVE",
              profile: {
                email: "bob@example.test",
                displayName: "Bob Example",
              },
            },
          ],
        } as Response;
      }
      throw new Error(`Unexpected URL ${value}`);
    });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");

    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).resolves.toEqual([
      expect.objectContaining({
        provider_id: "okta-main",
        external_group_id: "00g-platform",
        display_name: "Engineering Platform Users",
        members: [
          {
            subject: undefined,
            email: "bob@example.test",
            display_name: "Bob Example",
            active: true,
          },
        ],
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.okta.com/api/v1/groups?limit=200",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "SSWS test-token" }),
      })
    );
  });

  it("fails closed when Okta credentials are not configured", async () => {
    delete process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");

    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).rejects.toThrow(
      "Okta directory connector is not configured"
    );
  });

  it("retries on 429 (honoring Retry-After) then succeeds", async () => {
    jest.useFakeTimers();
    let groupsCalls = 0;
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/api/v1/groups?limit=200")) {
        groupsCalls += 1;
        if (groupsCalls === 1) {
          // First attempt is rate-limited; Retry-After is honored via fake timers.
          return {
            ok: false,
            status: 429,
            headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? "1" : null) },
            json: async () => ({}),
          } as unknown as Response;
        }
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [{ id: "00g-x", profile: { name: "X" } }],
        } as Response;
      }
      if (value.endsWith("/api/v1/groups/00g-x/users?limit=1000")) {
        return { ok: true, headers: { get: () => null }, json: async () => [] } as Response;
      }
      throw new Error(`Unexpected URL ${value}`);
    });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const promise = fetchOktaExternalGroups({ providerId: "okta-main" });
    // Advance through the backoff sleep so the retry fires.
    await jest.runOnlyPendingTimersAsync();
    const result = await promise;

    expect(groupsCalls).toBe(2);
    expect(result).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    jest.useRealTimers();
  });

  it("fails fast on a non-retryable status (403)", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response);

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).rejects.toThrow(/status 403/);
  });

  it("uses OAuth2 client-credentials when configured, minting a Bearer token", async () => {
    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID: "0oaclient",
      IDENTITY_SYNC_OKTA_OAUTH_KEY_ID: "kid-1",
      IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
    };

    const authHeaders: Array<string | undefined> = [];
    let tokenCalls = 0;
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const value = url.toString();
        if (value.endsWith("/oauth2/v1/token")) {
          tokenCalls += 1;
          // Assertion-bearing client-credentials request.
          expect(String(init?.body)).toContain("client_assertion=signed-client-assertion");
          expect(String(init?.body)).toContain("okta.groups.read");
          return {
            ok: true,
            headers: { get: () => null },
            json: async () => ({ access_token: "okta-access-token", expires_in: 3600 }),
          } as unknown as Response;
        }
        authHeaders.push((init?.headers as Record<string, string> | undefined)?.Authorization);
        if (value.endsWith("/api/v1/groups?limit=200")) {
          return { ok: true, headers: { get: () => null }, json: async () => [{ id: "00g-1", profile: { name: "G1" } }] } as Response;
        }
        if (value.endsWith("/api/v1/groups/00g-1/users?limit=1000")) {
          return { ok: true, headers: { get: () => null }, json: async () => [] } as Response;
        }
        throw new Error(`Unexpected URL ${value}`);
      });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const result = await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(result).toHaveLength(1);
    // Token minted once and reused (cached) for both group + member calls.
    expect(tokenCalls).toBe(1);
    expect(authHeaders).toEqual(["Bearer okta-access-token", "Bearer okta-access-token"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.okta.com/oauth2/v1/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("accepts a JWK-format private key (Backstage style) and signs via importJWK", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jose = require("jose") as { importJWK: jest.Mock; importPKCS8: jest.Mock };
    jose.importJWK.mockClear();
    jose.importPKCS8.mockClear();

    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_OAUTH_CLIENT_ID: "0oaclient",
      // No separate KEY_ID env — the kid should come from the JWK itself.
      IDENTITY_SYNC_OKTA_OAUTH_PRIVATE_KEY: JSON.stringify({ kty: "RSA", kid: "jwk-kid", d: "x", n: "y", e: "AQAB" }),
    };

    jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/oauth2/v1/token")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => ({ access_token: "tok", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (value.endsWith("/api/v1/groups?limit=200")) {
        return { ok: true, headers: { get: () => null }, json: async () => [] } as Response;
      }
      throw new Error(`Unexpected URL ${value}`);
    });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).resolves.toEqual([]);

    // JWK branch used; PEM importer untouched.
    expect(jose.importJWK).toHaveBeenCalledTimes(1);
    expect(jose.importJWK).toHaveBeenCalledWith(
      expect.objectContaining({ kid: "jwk-kid", kty: "RSA" }),
      "RS256"
    );
    expect(jose.importPKCS8).not.toHaveBeenCalled();
  });

  it("resolves all members across many groups with bounded concurrency", async () => {
    const groupCount = 25;
    jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/api/v1/groups?limit=200")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => Array.from({ length: groupCount }, (_, i) => ({ id: `00g-${i}`, profile: { name: `G${i}` } })),
        } as Response;
      }
      const m = value.match(/\/api\/v1\/groups\/00g-(\d+)\/users\?limit=1000$/);
      if (m) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [{ id: `00u-${m[1]}`, status: "ACTIVE", profile: { email: `u${m[1]}@x.test` } }],
        } as Response;
      }
      throw new Error(`Unexpected URL ${value}`);
    });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");
    const result = await fetchOktaExternalGroups({ providerId: "okta-main" });

    expect(result).toHaveLength(groupCount);
    // Order is preserved and every group resolved its single member.
    expect(result.every((g, i) => g.external_group_id === `00g-${i}` && g.members.length === 1)).toBe(true);
  });

  describe("checkOktaConnectorHealth", () => {
    it("returns ok on a 200 probe (token mode)", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [],
      } as unknown as Response);

      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      await expect(checkOktaConnectorHealth()).resolves.toEqual({ ok: true, mode: "token" });
    });

    it("probes with limit=1 and does not retry a 401 (fast verdict)", async () => {
      const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: { get: () => null },
        json: async () => ({}),
      } as unknown as Response);

      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      const health = await checkOktaConnectorHealth();

      expect(health.ok).toBe(false);
      expect(health.mode).toBe("token");
      expect((health as { error: string }).error).toMatch(/401/);
      // Single probe call — no retry loop.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://example.okta.com/api/v1/groups?limit=1",
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: "SSWS test-token" }),
        })
      );
    });

    it("reports unconfigured when no credentials are present", async () => {
      delete process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
      const { checkOktaConnectorHealth } = await import("../../okta-directory-connector");
      const health = await checkOktaConnectorHealth();
      expect(health).toMatchObject({ ok: false, mode: "unconfigured" });
    });
  });
});
