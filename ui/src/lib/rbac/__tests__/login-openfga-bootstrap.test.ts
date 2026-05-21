/**
 * @jest-environment node
 */

const mockWriteOpenFgaTuples = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
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
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 2, deletes: 0 });
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
        { user: "user:sub-admin", relation: "admin", object: "organization:grid" },
        { user: "user:sub-admin", relation: "manager", object: "system_config:platform_settings" },
      ],
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
