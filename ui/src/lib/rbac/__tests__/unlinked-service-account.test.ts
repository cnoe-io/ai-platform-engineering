/**
 * @jest-environment node
 *
 * Unit tests for the unlinked SA bootstrap + resolver
 * (`ui/src/lib/rbac/unlinked-service-account.ts`).
 *
 * Tests cover:
 *  - Idempotent no-op when a `is_platform_unlinked:true` SA already exists.
 *  - Full creation path (Keycloak → OpenFGA → Mongo) when absent.
 *  - Keycloak failure → returns `skipped` with a warning, no Mongo write.
 *  - OpenFGA failure → compensates (deletes Keycloak client), returns `skipped`.
 *  - Mongo failure → returns `skipped` with a warning.
 *  - `getUnlinkedServiceAccount` returns null when MongoDB is unconfigured.
 *  - `getUnlinkedServiceAccount` returns the matching doc.
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

// ── Mocks (declared before imports so jest.mock hoisting works) ─────────────

const mockGetCollection = jest.fn();
let mockIsMongoDBConfigured = true;

const mockCreateServiceAccountClient = jest.fn();
const mockDeleteServiceAccountClient = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockCreateServiceAccountDoc = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
  get isMongoDBConfigured() {
    return mockIsMongoDBConfigured;
  },
}));

jest.mock("@/lib/rbac/keycloak-admin", () => ({
  createServiceAccountClient: (...args: unknown[]) =>
    mockCreateServiceAccountClient(...args),
  deleteServiceAccountClient: (...args: unknown[]) =>
    mockDeleteServiceAccountClient(...args),
}));

const mockDeleteExactOpenFgaTuples = jest.fn();
jest.mock("@/lib/rbac/openfga", () => ({
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
}));

jest.mock("@/lib/service-accounts", () => ({
  createServiceAccountDoc: (...args: unknown[]) =>
    mockCreateServiceAccountDoc(...args),
}));

jest.mock("@/lib/auth-config", () => ({
  isBootstrapAdmin: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/rbac/organization", () => ({
  organizationObjectId: jest.fn().mockReturnValue("organization:caipe"),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const ANON_DOC = {
  sa_sub: "anon-sub-uuid",
  client_id: "caipe-sa-unlinked-abc123",
  client_uuid: "kc-uuid-anon",
  name: "unlinked",
  owning_team_id: "super-admins",
  created_by: "unlinked-bootstrap",
  created_at: new Date("2026-06-08T00:00:00Z"),
  status: "active" as const,
  revoked_at: null,
  scopes_snapshot: [],
  is_platform_unlinked: true,
};

const KC_CLIENT = {
  clientUuid: "kc-uuid-anon",
  clientId: "caipe-sa-unlinked-abc123",
  clientSecret: "secret-shown-once",
  saSub: "anon-sub-uuid",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFindOne(returnValue: unknown) {
  return jest.fn().mockResolvedValue(returnValue);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ensureUnlinkedServiceAccount", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockIsMongoDBConfigured = true;

    mockCreateServiceAccountClient.mockResolvedValue(KC_CLIENT);
    mockDeleteServiceAccountClient.mockResolvedValue(undefined);
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 2, deletes: 0 });
    mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, deletes: 2 });
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: false });
    mockCreateServiceAccountDoc.mockResolvedValue({ ...ANON_DOC });
  });

  it("returns noop when is_platform_unlinked SA already exists", async () => {
    // Primary findOne (by is_platform_unlinked flag) returns the doc.
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(ANON_DOC),
    });

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("noop");
    expect(result.sa_sub).toBe("anon-sub-uuid");
    expect(result.client_id).toBe("caipe-sa-unlinked-abc123");
    expect(result.warnings).toHaveLength(0);

    // Must NOT provision anything.
    expect(mockCreateServiceAccountClient).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockCreateServiceAccountDoc).not.toHaveBeenCalled();
  });

  it("returns noop on partial doc (fallback idempotency guard)", async () => {
    // Primary findOne (by is_platform_unlinked flag) returns null.
    // Fallback findOne (by name+team+status) returns a partial doc without the flag.
    const partialDoc = { ...ANON_DOC, is_platform_unlinked: undefined };
    const mockFindOne = jest.fn()
      .mockResolvedValueOnce(null)          // primary: { is_platform_unlinked: true }
      .mockResolvedValueOnce(partialDoc);   // fallback: { name, owning_team_id, status }
    mockGetCollection.mockResolvedValue({ findOne: mockFindOne });

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("noop");
    expect(result.sa_sub).toBe("anon-sub-uuid");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("partial doc detected")]),
    );
    expect(mockCreateServiceAccountClient).not.toHaveBeenCalled();
  });

  it("provisions full SA (Keycloak → OpenFGA → Mongo) when absent", async () => {
    // Both primary and fallback findOne return null → no existing doc.
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("created");
    expect(result.sa_sub).toBe("anon-sub-uuid");
    expect(result.client_id).toBe("caipe-sa-unlinked-abc123");
    expect(result.warnings).toHaveLength(0);

    // Keycloak client was created with the name "unlinked".
    expect(mockCreateServiceAccountClient).toHaveBeenCalledWith("unlinked");

    // OpenFGA ownership + gateway baseline tuples.
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: expect.arrayContaining([
        expect.objectContaining({ relation: "owner_team", object: "service_account:anon-sub-uuid" }),
        expect.objectContaining({ relation: "caller", object: "mcp_gateway:list" }),
      ]),
      deletes: [],
    });
    expect(mockWriteOpenFgaTuples.mock.calls[0][0].writes).toHaveLength(2);

    // [TS-B2] is_platform_unlinked must be passed at insert time (atomic).
    expect(mockCreateServiceAccountDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        sa_sub: "anon-sub-uuid",
        client_id: "caipe-sa-unlinked-abc123",
        name: "unlinked",
        owning_team_id: "super-admins",
        scopes_snapshot: [],
        is_platform_unlinked: true,
      }),
    );
  });

  it("returns skipped when MongoDB is not configured", async () => {
    mockIsMongoDBConfigured = false;

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("MongoDB not configured")]),
    );
    expect(mockCreateServiceAccountClient).not.toHaveBeenCalled();
  });

  it("returns skipped and includes a warning when Keycloak fails", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });
    mockCreateServiceAccountClient.mockRejectedValue(new Error("Keycloak unavailable"));

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Keycloak client creation failed"),
      ]),
    );
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockCreateServiceAccountDoc).not.toHaveBeenCalled();
  });

  it("compensates (deletes Keycloak client) and returns skipped when OpenFGA fails", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });
    mockWriteOpenFgaTuples.mockRejectedValue(new Error("pdp unavailable"));

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("OpenFGA tuple write failed"),
      ]),
    );
    // Compensation: Keycloak client must be deleted.
    expect(mockDeleteServiceAccountClient).toHaveBeenCalledWith("kc-uuid-anon");
    // Mongo must NOT have been written.
    expect(mockCreateServiceAccountDoc).not.toHaveBeenCalled();
  });

  it("returns skipped with a warning when Mongo insert fails", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });
    mockCreateServiceAccountDoc.mockRejectedValue(new Error("mongo timeout"));

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Mongo insert failed")]),
    );
  });

  it("SEC-4: on Mongo dup-key (11000), compensates KC + OpenFGA and returns noop", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });
    const dupKeyError = Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    mockCreateServiceAccountDoc.mockRejectedValue(dupKeyError);

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    // Should return noop, not skipped — idempotent duplicate
    expect(result.status).toBe("noop");
    // Compensation: OpenFGA tuples deleted
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ relation: "owner_team" }),
        expect.objectContaining({ relation: "caller", object: "mcp_gateway:list" }),
      ]),
    );
    // Compensation: Keycloak client deleted
    expect(mockDeleteServiceAccountClient).toHaveBeenCalledWith("kc-uuid-anon");
  });

  it("SEC-4: on Mongo dup-key with KC compensation failure — warns but still returns noop", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });
    const dupKeyError = Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
    mockCreateServiceAccountDoc.mockRejectedValue(dupKeyError);
    mockDeleteServiceAccountClient.mockRejectedValue(new Error("KC unavailable"));

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(result.status).toBe("noop");
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("dup-key Keycloak compensation failed")]),
    );
  });

  it("does NOT write any scope tuples (zero scopes at creation)", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    await ensureUnlinkedServiceAccount({ actor: "test" });

    const writtenTuples = mockWriteOpenFgaTuples.mock.calls[0]?.[0]?.writes ?? [];
    // Only 2 tuples: owner_team + gateway baseline — no scope tuples.
    expect(writtenTuples).toHaveLength(2);
  });

  it("uses the super-admins slug as owning_team_id", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });

    const { ensureUnlinkedServiceAccount } = await import("../unlinked-service-account");
    await ensureUnlinkedServiceAccount({ actor: "test" });

    expect(mockCreateServiceAccountDoc).toHaveBeenCalledWith(
      expect.objectContaining({ owning_team_id: "super-admins" }),
    );
    const ownerTuple = mockWriteOpenFgaTuples.mock.calls[0][0].writes.find(
      (t: { relation: string }) => t.relation === "owner_team",
    );
    expect(ownerTuple?.user).toBe("team:super-admins#member");
  });
});

describe("getUnlinkedServiceAccount", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockIsMongoDBConfigured = true;
  });

  it("returns null when MongoDB is not configured", async () => {
    mockIsMongoDBConfigured = false;

    const { getUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await getUnlinkedServiceAccount();

    expect(result).toBeNull();
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("queries with { is_platform_unlinked: true, status: active } and returns the doc", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(ANON_DOC),
    });

    const { getUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await getUnlinkedServiceAccount();

    expect(result).toEqual(ANON_DOC);
    const collectionMock = await mockGetCollection.mock.results[0]?.value;
    expect(collectionMock?.findOne).toHaveBeenCalledWith({
      is_platform_unlinked: true,
      status: "active",
    });
  });

  it("returns null when no matching doc exists", async () => {
    mockGetCollection.mockResolvedValue({
      findOne: makeFindOne(null),
    });

    const { getUnlinkedServiceAccount } = await import("../unlinked-service-account");
    const result = await getUnlinkedServiceAccount();

    expect(result).toBeNull();
  });
});
