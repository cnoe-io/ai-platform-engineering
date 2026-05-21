/**
 * @jest-environment node
 */

const mockWriteOpenFgaTuples = jest.fn();
const mockGetCollection = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

describe("login OpenFGA bootstrap", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      CAIPE_ORG_KEY: "grid",
    };
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 8, deletes: 0 });
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("writes baseline product access for an admitted user", async () => {
    const { reconcileLoginOpenFgaAccess } = await import("../login-openfga-bootstrap");

    const result = await reconcileLoginOpenFgaAccess({
      subject: "sub-user",
      email: "user@example.com",
      isAuthorized: true,
      isAdmin: false,
    });

    expect(result.status).toBe("completed");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        { user: "user:sub-user", relation: "member", object: "organization:grid" },
        { user: "user:sub-user", relation: "reader", object: "system_config:platform_settings" },
        { user: "user:sub-user", relation: "owner", object: "user_profile:sub-user" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:users" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:teams" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:skills" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:metrics" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:health" },
        { user: "user:sub-user", relation: "reader", object: "admin_surface:credentials" },
      ],
      deletes: [],
    });
  });

  it("adds durable admin tuples only when the login is admin-eligible", async () => {
    const { reconcileLoginOpenFgaAccess } = await import("../login-openfga-bootstrap");

    const result = await reconcileLoginOpenFgaAccess({
      subject: "sub-admin",
      email: "admin@example.com",
      isAuthorized: true,
      isAdmin: true,
    });

    expect(result.status).toBe("completed");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        { user: "user:sub-admin", relation: "member", object: "organization:grid" },
        { user: "user:sub-admin", relation: "reader", object: "system_config:platform_settings" },
        { user: "user:sub-admin", relation: "owner", object: "user_profile:sub-admin" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:users" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:teams" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:skills" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:metrics" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:health" },
        { user: "user:sub-admin", relation: "reader", object: "admin_surface:credentials" },
        { user: "user:sub-admin", relation: "admin", object: "organization:grid" },
        { user: "user:sub-admin", relation: "manager", object: "system_config:platform_settings" },
        { user: "user:sub-admin", relation: "manager", object: "mcp_server:agentgateway" },
      ],
      deletes: [],
    });
  });

  it("repairs the all-users OpenFGA grant for the configured default dynamic agent on login", async () => {
    mockGetCollection.mockImplementation(async (name: string) => {
      if (name === "platform_config") {
        return { findOne: jest.fn().mockResolvedValue({ default_agent_id: "agent-default" }) };
      }
      throw new Error(`unexpected collection ${name}`);
    });
    const { reconcileLoginOpenFgaAccess } = await import("../login-openfga-bootstrap");

    const result = await reconcileLoginOpenFgaAccess({
      subject: "sub-user",
      email: "user@example.com",
      isAuthorized: true,
      isAdmin: false,
    });

    expect(result.status).toBe("completed");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        { user: "user:*", relation: "user", object: "agent:agent-default" },
      ]),
      deletes: [],
    });
  });

  it("does not bootstrap users who failed the OIDC admission gate", async () => {
    const { reconcileLoginOpenFgaAccess } = await import("../login-openfga-bootstrap");

    const result = await reconcileLoginOpenFgaAccess({
      subject: "sub-outsider",
      email: "outsider@example.com",
      isAuthorized: false,
      isAdmin: true,
    });

    expect(result.status).toBe("skipped");
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});
