/**
 * @jest-environment node
 */

const mockEnsureUserByEmail = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  ensureUserByEmail: (...args: unknown[]) => mockEnsureUserByEmail(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

describe("bootstrap admin reconciliation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      BOOTSTRAP_ADMIN_EMAILS: "Admin@Cisco.com,second@cisco.com,admin@cisco.com",
      CAIPE_ORG_KEY: "grid",
    };
    mockEnsureUserByEmail
      .mockResolvedValueOnce({ id: "sub-admin", email: "admin@cisco.com", created: false })
      .mockResolvedValueOnce({ id: "sub-second", email: "second@cisco.com", created: true });
    mockGetCollection.mockRejectedValue(new Error("Mongo unavailable in bootstrap admin test"));
    mockWriteOpenFgaTuples.mockImplementation(async (input: { writes: unknown[] }) => ({
      enabled: true,
      writes: input.writes.length,
      deletes: 0,
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("resolves bootstrap emails and writes durable OpenFGA admin tuples", async () => {
    const { reconcileBootstrapAdmins } = await import("../keycloak-bootstrap-admins");

    const result = await reconcileBootstrapAdmins({ actor: "test-admin" });

    expect(result.enabled).toBe(true);
    expect(result.configured_emails).toEqual(["admin@cisco.com", "second@cisco.com"]);
    expect(result.resolved_count).toBe(2);
    expect(result.created_count).toBe(1);
    expect(result.tuple_write_count).toBe(62);
    expect(mockEnsureUserByEmail).toHaveBeenCalledWith("admin@cisco.com");
    expect(mockEnsureUserByEmail).toHaveBeenCalledWith("second@cisco.com");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:sub-admin", relation: "member", object: "organization:grid" },
        { user: "user:sub-admin", relation: "reader", object: "system_config:platform_settings" },
        { user: "user:sub-admin", relation: "owner", object: "user_profile:sub-admin" },
        { user: "user:sub-admin", relation: "caller", object: "mcp_gateway:list" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:users" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:teams" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:skills" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:metrics" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:health" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:credentials" },
        { user: "user:sub-admin", relation: "admin", object: "organization:grid" },
        { user: "user:sub-admin", relation: "manager", object: "system_config:platform_settings" },
        { user: "user:sub-admin", relation: "manager", object: "mcp_server:agentgateway" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:users" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:teams" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:skills" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:metrics" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:health" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:credentials" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:openfga" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:migrations" },
        { user: "user:sub-admin", relation: "manager", object: "admin_surface:rag_datasources" },
      ]),
      deletes: [],
    });
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "admin@cisco.com",
          user_id: "sub-admin",
          status: "existing",
          tuple_write_count: 31,
        }),
        expect.objectContaining({
          email: "second@cisco.com",
          user_id: "sub-second",
          status: "created",
          tuple_write_count: 31,
        }),
      ]),
    );
  });

  it("keeps reconciling remaining emails when one bootstrap email fails", async () => {
    mockEnsureUserByEmail
      .mockReset()
      .mockRejectedValueOnce(new Error("Keycloak duplicate email"))
      .mockResolvedValueOnce({ id: "sub-second", email: "second@cisco.com", created: false });

    const { reconcileBootstrapAdmins } = await import("../keycloak-bootstrap-admins");

    const result = await reconcileBootstrapAdmins({ actor: "test-admin" });

    expect(result.resolved_count).toBe(1);
    expect(result.failed_count).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("admin@cisco.com: Keycloak duplicate email")]),
    );
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "admin@cisco.com",
          status: "failed",
          error: "Keycloak duplicate email",
        }),
      ]),
    );
  });

  it("marks bootstrap outcomes failed when OpenFGA is not configured", async () => {
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: false, writes: 0, deletes: 0 });

    const { reconcileBootstrapAdmins } = await import("../keycloak-bootstrap-admins");

    const result = await reconcileBootstrapAdmins({ actor: "test-admin" });

    expect(result.resolved_count).toBe(0);
    expect(result.failed_count).toBe(2);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("OpenFGA is not configured; bootstrap admin tuples were not written"),
      ]),
    );
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "admin@cisco.com",
          user_id: "sub-admin",
          status: "failed",
        }),
      ]),
    );
  });
});
