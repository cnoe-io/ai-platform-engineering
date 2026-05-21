/**
 * @jest-environment node
 */

function response(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
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

describe("Keycloak admin user helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: "http://keycloak",
      KEYCLOAK_REALM: "caipe",
      KEYCLOAK_ADMIN_CLIENT_ID: "caipe-platform",
      KEYCLOAK_ADMIN_CLIENT_SECRET: "secret",
    };
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns an existing Keycloak user for a bootstrap email without mutating it", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 300 }))
      .mockResolvedValueOnce(response([{ id: "existing-sub", email: "admin@cisco.com", username: "admin@cisco.com" }]));

    const { ensureUserByEmail } = await import("../keycloak-admin");

    const result = await ensureUserByEmail("Admin@Cisco.com");

    expect(result).toEqual({ id: "existing-sub", email: "admin@cisco.com", created: false });
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining("/users"), expect.objectContaining({ method: "POST" }));
  });

  it("creates a passwordless verified placeholder when a bootstrap email has not logged in yet", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ access_token: "token", expires_in: 300 }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response("", { status: 201, headers: { Location: "http://keycloak/admin/realms/caipe/users/new-sub" } }))
      .mockResolvedValueOnce(response([{ id: "new-sub", email: "new-admin@cisco.com", username: "new-admin@cisco.com" }]));

    const { ensureUserByEmail } = await import("../keycloak-admin");

    const result = await ensureUserByEmail("new-admin@cisco.com");

    expect(result).toEqual({ id: "new-sub", email: "new-admin@cisco.com", created: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://keycloak/admin/realms/caipe/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          username: "new-admin@cisco.com",
          email: "new-admin@cisco.com",
          enabled: true,
          emailVerified: true,
          requiredActions: [],
        }),
      }),
    );
  });
});
