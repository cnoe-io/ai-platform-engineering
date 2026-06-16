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

  it("uses existing users-management permissions when runtime admin cannot enable them", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.endsWith("/protocol/openid-connect/token")) {
        return response({ access_token: "token", expires_in: 300 });
      }
      if (url.endsWith("/clients?clientId=caipe-slack-bot")) {
        return response([{ id: "bot-client-uuid", clientId: "caipe-slack-bot" }]);
      }
      if (url.endsWith("/clients?clientId=caipe-platform")) {
        return response([{ id: "platform-client-uuid", clientId: "caipe-platform" }]);
      }
      if (url.endsWith("/clients?clientId=realm-management")) {
        return response([{ id: "realm-management-uuid", clientId: "realm-management" }]);
      }
      if (url.includes("/clients/bot-client-uuid/management/permissions")) {
        return response({ enabled: true, scopePermissions: { "token-exchange": "bot-token-perm" } });
      }
      if (url.includes("/clients/platform-client-uuid/management/permissions")) {
        return response({ enabled: true, scopePermissions: { "token-exchange": "platform-token-perm" } });
      }
      if (url.endsWith("/users-management-permissions") && method === "PUT") {
        return response({ error: "forbidden" }, { status: 403 });
      }
      if (url.endsWith("/users-management-permissions") && method === "GET") {
        return response({ enabled: true, scopePermissions: { impersonate: "users-impersonate-perm" } });
      }
      if (url.includes("/authz/resource-server/policy?name=caipe-slack-bot-token-exchange")) {
        return response([{ id: "policy-id", name: "caipe-slack-bot-token-exchange" }]);
      }
      if (
        url.includes("/authz/resource-server/permission/scope/") &&
        url.endsWith("/associatedPolicies")
      ) {
        return response([{ id: "policy-id", name: "caipe-slack-bot-token-exchange" }]);
      }
      if (url.includes("/authz/resource-server/permission/scope/")) {
        return response({ id: "permission-id", policies: ["policy-id"] });
      }

      throw new Error(`unexpected fetch ${method} ${url}`);
    });

    const { ensureSlackBotOboPermissions } = await import("../keycloak-admin");

    await expect(ensureSlackBotOboPermissions()).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://keycloak/admin/realms/caipe/users-management-permissions",
      expect.objectContaining({ method: "PUT" })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://keycloak/admin/realms/caipe/users-management-permissions",
      expect.objectContaining({ method: "GET" })
    );
    const botTokenExchangePermissionUpdate = (global.fetch as jest.Mock).mock.calls.find(
      ([input, init]: [string | URL, RequestInit | undefined]) =>
        String(input).endsWith(
          "/clients/realm-management-uuid/authz/resource-server/permission/scope/bot-token-perm"
        ) && init?.method === "PUT"
    );
    expect(botTokenExchangePermissionUpdate).toBeDefined();
    expect(JSON.parse(botTokenExchangePermissionUpdate![1]!.body as string)).toEqual(
      expect.objectContaining({
        decisionStrategy: "AFFIRMATIVE",
      })
    );
  });
});
