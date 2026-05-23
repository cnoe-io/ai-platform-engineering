/**
 * @jest-environment node
 *
 * Tests for the admin-token-fetch fallback chain in
 * `ui/src/lib/rbac/keycloak-admin.ts::fetchFreshAdminToken`.
 *
 * The happy path (`KEYCLOAK_ADMIN_CLIENT_ID` + `KEYCLOAK_ADMIN_CLIENT_SECRET`
 * both set, `client_credentials` returns 200) is covered by the existing
 * `keycloak-admin.test.ts`. This file pins the three failure-shaped paths
 * that surfaced in Kevin's in-cluster install:
 *
 *  1. Admin client env vars unset → silent fallback to `password` grant
 *     against `/realms/master` with `admin-cli/admin/admin` (the dev
 *     escape hatch). This MUST be exactly one fetch call.
 *  2. Admin client env vars set, `client_credentials` returns 401 (e.g.
 *     when the operator points `KEYCLOAK_ADMIN_CLIENT_SECRET` at the
 *     unrotated `caipe-platform-dev-secret` placeholder but the realm has
 *     already reconciled to the real secret) → falls back to the
 *     password grant, logs a warning with the upstream error, then
 *     succeeds against `/realms/master`.
 *  3. Both calls 401 → caller sees the exact error string the operator
 *     will copy into a Slack channel:
 *     `Keycloak token (password (admin-cli)) failed: 401 invalid_grant`.
 *
 * The `admin/admin` fallback is itself a security risk — Kevin's bug
 * showed how easy it is to ship a chart where the BFF silently falls back
 * to it in production. As of R1, the fallback is now gated by
 * `adminPasswordFallbackAllowed()` which requires either
 * `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true` or
 * `NODE_ENV !== "production"`. The "production safety gate" describe
 * block below pins that behaviour so a future regression can't silently
 * re-enable master-realm admin escalation from a prod-built BFF.
 *
 * assisted-by Claude:claude-opus-4-7
 */

function response(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers);
  return {
    ok: init.ok ?? status < 400,
    status,
    statusText: String(status),
    headers,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

/**
 * Filter a list of fetch calls down to those that look like Keycloak token
 * requests. The token-cache means a single test may also fire follow-up
 * admin REST calls; this helper keeps the assertions focused on the
 * `/protocol/openid-connect/token` POSTs that drive the fallback chain.
 */
function tokenCalls(mock: jest.Mock): Array<[string, RequestInit | undefined]> {
  return mock.mock.calls.filter((args) => {
    const url = args[0];
    return typeof url === "string" && url.endsWith("/protocol/openid-connect/token");
  }) as Array<[string, RequestInit | undefined]>;
}

/**
 * Parse a `URLSearchParams`-style body the same way Keycloak does, so the
 * assertions are tolerant of key-order changes inside `fetchFreshAdminToken`.
 */
function parseFormBody(init: RequestInit | undefined): Record<string, string> {
  const body = init?.body;
  if (typeof body !== "string") return {};
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

describe("Keycloak admin token fetch — fallback chain", () => {
  const originalEnv = { ...process.env };
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    // Strip both admin client env vars by default so each test sets the
    // shape it cares about explicitly. Anything inherited from the
    // developer's local `.env` would otherwise muddy the assertions.
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
      KEYCLOAK_REALM: "caipe",
      // Explicit opt-in for the admin/admin fallback. Tests that exercise
      // the fallback chain set this; tests that pin the production safety
      // gate clear it (or set NODE_ENV=production).
      ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK: "true",
    };
    delete process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    delete process.env.NODE_ENV;
    global.fetch = jest.fn();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("falls back to /realms/master admin-cli password grant when admin client env is unset", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ access_token: "fallback-token", expires_in: 300 })
    );

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    const token = await getKeycloakAdminToken();
    expect(token).toBe("fallback-token");

    const calls = tokenCalls(global.fetch as jest.Mock);
    // Only the master-realm fallback fires; client_credentials must not be attempted.
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("http://keycloak/realms/master/protocol/openid-connect/token");
    expect(parseFormBody(init)).toEqual({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[KeycloakAdmin] Missing admin client id/secret; using password grant (dev)"
    );
  });

  it("falls back to admin-cli password grant when client_credentials returns 401 invalid_grant", async () => {
    process.env.KEYCLOAK_ADMIN_CLIENT_ID = "caipe-platform";
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "caipe-platform-dev-secret"; // stale placeholder

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        response(
          { error: "invalid_grant", error_description: "Invalid client credentials" },
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(response({ access_token: "fallback-token", expires_in: 300 }));

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    const token = await getKeycloakAdminToken();
    expect(token).toBe("fallback-token");

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toBe("http://keycloak/realms/caipe/protocol/openid-connect/token");
    expect(parseFormBody(calls[0]![1])).toEqual({
      grant_type: "client_credentials",
      client_id: "caipe-platform",
      client_secret: "caipe-platform-dev-secret",
    });
    expect(calls[1]![0]).toBe("http://keycloak/realms/master/protocol/openid-connect/token");
    expect(parseFormBody(calls[1]![1])).toMatchObject({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin",
    });

    // The warning MUST surface the upstream Keycloak error so an operator
    // grepping pod logs for `invalid_grant` finds it without enabling debug.
    expect(warnSpy).toHaveBeenCalledWith(
      "[KeycloakAdmin] client_credentials failed, falling back to password grant:",
      expect.objectContaining({
        message: expect.stringContaining(
          "Keycloak token (client_credentials) failed: 401 invalid_grant: Invalid client credentials"
        ),
      })
    );
  });

  it("throws the exact Kevin error string when both client_credentials and password grant 401", async () => {
    process.env.KEYCLOAK_ADMIN_CLIENT_ID = "caipe-platform";
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "caipe-platform-dev-secret";

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        response(
          { error: "invalid_grant", error_description: "Invalid client credentials" },
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        response({ error: "invalid_grant" }, { status: 401 })
      );

    const { getKeycloakAdminToken } = await import("../keycloak-admin");

    // The exact error string is the literal text Kevin pasted in Slack —
    // pinning it means a future refactor of `requestTokenFromKeycloak`
    // can't silently change the operator-facing log line.
    await expect(getKeycloakAdminToken()).rejects.toThrow(
      "Keycloak token (password (admin-cli)) failed: 401 invalid_grant"
    );

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(2);
  });

  it("does not call /realms/master fallback when client_credentials succeeds (regression guard)", async () => {
    process.env.KEYCLOAK_ADMIN_CLIENT_ID = "caipe-platform";
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "real-rotated-secret";

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ access_token: "happy-token", expires_in: 300 })
    );

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    const token = await getKeycloakAdminToken();
    expect(token).toBe("happy-token");

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("http://keycloak/realms/caipe/protocol/openid-connect/token");
    // No /realms/master call.
    expect(
      calls.some(([url]) => url.includes("/realms/master/"))
    ).toBe(false);
    // No "falling back" warning either.
    expect(
      warnSpy.mock.calls.some(([msg]) =>
        typeof msg === "string" && msg.includes("falling back to password grant")
      )
    ).toBe(false);
  });
});

describe("Keycloak admin token fetch — production safety gate (R1)", () => {
  // This block pins the new gate added in R1: in production builds, the
  // `admin/admin` password-grant fallback is OFF by default so a
  // misconfigured prod install fails loudly instead of silently calling
  // /realms/master with the Keycloak bootstrap credentials.
  //
  // The gate is permissive in dev (NODE_ENV !== "production") because
  // local docker-compose / make targets rely on the fallback to bootstrap
  // a fresh Keycloak. Operators who run their CI with NODE_ENV=production
  // but still want the dev shortcut can opt in with
  // `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true`.

  const originalEnv = { ...process.env };
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
      KEYCLOAK_REALM: "caipe",
      NODE_ENV: "production",
    };
    delete process.env.KEYCLOAK_ADMIN_CLIENT_ID;
    delete process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    delete process.env.ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK;
    global.fetch = jest.fn();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("throws a configuration error in production when admin client env is unset (no /realms/master call)", async () => {
    const { getKeycloakAdminToken } = await import("../keycloak-admin");

    // The literal substring `ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK` MUST
    // appear in the operator-facing error so a fresh-eyes SRE searching
    // their Sentry trail lands directly on the docs.
    await expect(getKeycloakAdminToken()).rejects.toThrow(
      /Keycloak admin credentials missing.*ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK/s
    );

    // Crucially, no fetch was made — we did not even attempt the
    // /realms/master fallback. If anyone refactors this to "try then
    // throw", this test will catch it.
    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(0);
  });

  it("re-raises the client_credentials error verbatim in production (no master fallback)", async () => {
    // When the admin client env IS set but Keycloak returns 401 (e.g.
    // stale `caipe-platform-dev-secret` after reconciliation), the
    // operator sees the upstream Keycloak error directly. The
    // /realms/master fallback is silently disabled.
    process.env.KEYCLOAK_ADMIN_CLIENT_ID = "caipe-platform";
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET = "caipe-platform-dev-secret";

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response(
        { error: "invalid_grant", error_description: "Invalid client credentials" },
        { status: 401 }
      )
    );

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    await expect(getKeycloakAdminToken()).rejects.toThrow(
      "Keycloak token (client_credentials) failed: 401 invalid_grant: Invalid client credentials"
    );

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("http://keycloak/realms/caipe/protocol/openid-connect/token");
    // No /realms/master call.
    expect(calls.some(([url]) => url.includes("/realms/master/"))).toBe(false);
  });

  it("ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true re-enables the fallback even when NODE_ENV=production", async () => {
    // The opt-in flag exists for tightly-controlled CI environments
    // where the operator has explicitly accepted the risk (e.g. an
    // ephemeral test cluster with a known-strong bootstrap admin
    // password). Setting it MUST short-circuit the production block.
    process.env.ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK = "true";

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ access_token: "opt-in-token", expires_in: 300 })
    );

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    const token = await getKeycloakAdminToken();
    expect(token).toBe("opt-in-token");

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("http://keycloak/realms/master/protocol/openid-connect/token");
  });

  it("ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=false overrides NODE_ENV=development (explicit-off wins)", async () => {
    // Symmetric to the previous test: an explicit `false` MUST win even
    // when the implicit dev signal would otherwise allow the fallback.
    // This is the knob an operator flips in a hardened dev cluster.
    process.env.NODE_ENV = "development";
    process.env.ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK = "false";

    const { getKeycloakAdminToken } = await import("../keycloak-admin");
    await expect(getKeycloakAdminToken()).rejects.toThrow(
      /Keycloak admin credentials missing/
    );

    const calls = tokenCalls(global.fetch as jest.Mock);
    expect(calls).toHaveLength(0);
  });
});
