/**
 * @jest-environment node
 *
 * Verifies that `ensureSuperAdminsTeam` wires the Super Admins team to confer
 * organization-admin by writing the userset tuple
 * `team:super-admins#admin -> admin -> organization:<key>`.
 *
 * assisted-by Cursor claude-opus-4-7
 */

const mockGetCollection = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockResolveKeycloakUserSubject = jest.fn();
const mockWriteTeamMembershipTuples = jest.fn();
const mockMongoRoleToOpenFgaRelations = jest.fn();
const mockUpsertTeamMembershipSource = jest.fn();
const mockLoadActiveTeamMembers = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  isMongoDBConfigured: true,
}));

jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/rbac/team-membership-sync", () => ({
  resolveKeycloakUserSubject: (...args: unknown[]) => mockResolveKeycloakUserSubject(...args),
  writeTeamMembershipTuples: (...args: unknown[]) => mockWriteTeamMembershipTuples(...args),
  mongoRoleToOpenFgaRelations: (...args: unknown[]) => mockMongoRoleToOpenFgaRelations(...args),
}));

jest.mock("@/lib/rbac/team-membership-source-store", () => ({
  upsertTeamMembershipSource: (...args: unknown[]) => mockUpsertTeamMembershipSource(...args),
}));

jest.mock("@/lib/rbac/team-membership-store", () => ({
  loadActiveTeamMembers: (...args: unknown[]) => mockLoadActiveTeamMembers(...args),
}));

const ORG_ADMIN_LINK_TUPLE = {
  user: "team:super-admins#admin",
  relation: "admin",
  object: "organization:caipe",
};

describe("ensureSuperAdminsTeam org-admin linkage", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CAIPE_ORG_KEY;

    mockResolveKeycloakUserSubject.mockResolvedValue("sub-a");
    mockMongoRoleToOpenFgaRelations.mockReturnValue(["admin"]);
    mockWriteTeamMembershipTuples.mockResolvedValue(undefined);
    mockUpsertTeamMembershipSource.mockResolvedValue(undefined);
    mockLoadActiveTeamMembers.mockResolvedValue([]);
    mockWriteOpenFgaTuples.mockImplementation(async (input: { writes: unknown[] }) => ({
      enabled: true,
      writes: input.writes.length,
      deletes: 0,
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("writes the org-admin linkage tuple when creating the team", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: "team-id-1" }),
      updateOne: jest.fn().mockResolvedValue({}),
    });

    const { ensureSuperAdminsTeam } = await import("../super-admins-team");
    const result = await ensureSuperAdminsTeam({
      members: [{ email: "a@cisco.com", userSubject: "sub-a" }],
      actor: "test",
    });

    expect(result.status).toBe("created");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [ORG_ADMIN_LINK_TUPLE],
      deletes: [],
    });
  });

  it("writes the org-admin linkage tuple even when the team already exists", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ _id: "team-id-1", slug: "super-admins", created_at: new Date() }),
      insertOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
    });
    // Member already present, so the run is a noop for membership.
    mockLoadActiveTeamMembers.mockResolvedValue([{ user_email: "a@cisco.com" }]);

    const { ensureSuperAdminsTeam } = await import("../super-admins-team");
    const result = await ensureSuperAdminsTeam({
      members: [{ email: "a@cisco.com", userSubject: "sub-a" }],
      actor: "test",
    });

    expect(result.status).toBe("noop");
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [ORG_ADMIN_LINK_TUPLE],
      deletes: [],
    });
  });

  it("honors a custom org key via CAIPE_ORG_KEY", async () => {
    process.env.CAIPE_ORG_KEY = "grid";
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: "team-id-1" }),
      updateOne: jest.fn().mockResolvedValue({}),
    });

    const { ensureSuperAdminsTeam } = await import("../super-admins-team");
    await ensureSuperAdminsTeam({
      members: [{ email: "a@cisco.com", userSubject: "sub-a" }],
      actor: "test",
    });

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{ user: "team:super-admins#admin", relation: "admin", object: "organization:grid" }],
      deletes: [],
    });
  });

  it("captures linkage failures in warnings without throwing", async () => {
    mockWriteOpenFgaTuples.mockRejectedValue(new Error("pdp unavailable"));
    mockGetCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: "team-id-1" }),
      updateOne: jest.fn().mockResolvedValue({}),
    });

    const { ensureSuperAdminsTeam } = await import("../super-admins-team");
    const result = await ensureSuperAdminsTeam({
      members: [{ email: "a@cisco.com", userSubject: "sub-a" }],
      actor: "test",
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("super-admins org-admin linkage")]),
    );
  });

  it("skips entirely when no bootstrap admins are configured", async () => {
    const { ensureSuperAdminsTeam } = await import("../super-admins-team");
    const result = await ensureSuperAdminsTeam({ members: [], actor: "test" });

    expect(result.status).toBe("skipped");
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });
});
