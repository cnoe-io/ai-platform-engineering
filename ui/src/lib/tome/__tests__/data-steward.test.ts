import {
  dataStewardTuple,
  getTomeProjectPermissions,
  reconcileDataSteward,
  resolveDataSteward,
  resolveStoredDataSteward,
  tomeDataObject,
} from "@/lib/tome/data-steward";
import type { ProjectDocument } from "@/types/projects";

const mockGetCollection = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockIsTomeAdmin = jest.fn();
const mockCanReadTomeProject = jest.fn();

jest.mock("mongodb", () => ({
  ObjectId: class MockObjectId {
    static isValid(): boolean {
      return false;
    }
  },
}));

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class MockApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code: string,
    ) {
      super(message);
    }
  },
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

jest.mock("@/lib/tome/access", () => ({
  canReadTomeProject: (...args: unknown[]) => mockCanReadTomeProject(...args),
  tomeDataObject: (p: ProjectDocument) =>
    `document:tome/${p.type === "bhag" || p.type === "area" ? p.type : "project"}/${String(p._id)}`,
}));

jest.mock("@/lib/rbac/tome-admin", () => ({
  isTomeAdmin: (...args: unknown[]) => mockIsTomeAdmin(...args),
}));

function project(
  type: ProjectDocument["type"] = "project",
  dataSteward?: ProjectDocument["data_steward"],
): ProjectDocument {
  return {
    _id: "project-id",
    type,
    slug: "example",
    name: "Example",
    title: "Example",
    description: "",
    team_id: "team-id",
    team_slug: "primary",
    team_name: "Primary",
    owner_id: "owner@example.com",
    member_ids: [],
    domain: "default",
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    data_steward: dataSteward,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe("Tome data-steward authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTomeAdmin.mockResolvedValue(false);
    mockCanReadTomeProject.mockResolvedValue(true);
    mockWriteOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 1, deletes: 0 });
    mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: { user: string; relation: string; object: string } }) =>
        Promise.resolve({ tuples: [{ key: tuple }] }),
    );
  });

  it.each([
    ["project", "document:tome/project/project-id"],
    ["area", "document:tome/area/project-id"],
    ["bhag", "document:tome/bhag/project-id"],
  ] as const)("scopes %s steward grants to its own object", (type, expected) => {
    expect(tomeDataObject(project(type))).toBe(expected);
  });

  it("normalizes a signed-in user into a direct writer tuple", async () => {
    mockGetCollection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        email: "user@example.com",
        name: "Example User",
        keycloak_sub: "user-sub",
        metadata: {},
      }),
    });

    const steward = await resolveDataSteward({ type: "user", email: "USER@example.com" });

    expect(steward).toEqual({
      type: "user",
      id: "user-sub",
      name: "Example User",
      email: "user@example.com",
    });
    expect(dataStewardTuple(project(), steward!)).toEqual({
      user: "user:user-sub",
      relation: "writer",
      object: "document:tome/project/project-id",
    });
  });

  it("normalizes a team into a member-userset writer tuple", async () => {
    mockGetCollection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        _id: "team-id",
        slug: "primary",
        name: "Primary Team",
      }),
    });

    const steward = await resolveDataSteward({ type: "team", team_id: "primary" });

    expect(steward).toEqual({ type: "team", id: "primary", name: "Primary Team" });
    expect(dataStewardTuple(project("area"), steward!)).toEqual({
      user: "team:primary#member",
      relation: "writer",
      object: "document:tome/area/project-id",
    });
  });

  it("checks the caller's OpenFGA can_write decision", async () => {
    mockCheckOpenFgaTuple.mockResolvedValue({ allowed: true });

    await expect(
      getTomeProjectPermissions({
        project: project("bhag"),
        user: { email: "user@example.com" },
        session: { sub: "user-sub", user: { email: "user@example.com" } },
      }),
    ).resolves.toEqual({ canRead: true, canEdit: true, canManageSteward: false });

    expect(mockCheckOpenFgaTuple).toHaveBeenCalledWith({
      user: "user:user-sub",
      relation: "can_write",
      object: "document:tome/bhag/project-id",
    });
  });

  it("lets Tome admins edit without a per-entity writer tuple", async () => {
    mockIsTomeAdmin.mockResolvedValue(true);

    await expect(
      getTomeProjectPermissions({
        project: project(),
        user: { email: "admin@example.com" },
        session: { sub: "admin-sub" },
      }),
    ).resolves.toEqual({ canRead: true, canEdit: true, canManageSteward: true });
    expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
  });

  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects %s before any administrator or OpenFGA decision",
    async (principalType) => {
      await expect(
        getTomeProjectPermissions({
          project: project(),
          user: { email: "catalog-user@example.test" },
          session: { sub: "catalog-user", principalType },
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
      });
      expect(mockIsTomeAdmin).not.toHaveBeenCalled();
      expect(mockCanReadTomeProject).not.toHaveBeenCalled();
      expect(mockCheckOpenFgaTuple).not.toHaveBeenCalled();
    },
  );

  it("repairs a stored team steward tuple before checking again", async () => {
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });
    const stored = { type: "team" as const, id: "primary", name: "Primary Team" };

    await expect(
      getTomeProjectPermissions({
        project: project("area", stored),
        user: { email: "member@example.com" },
        session: { sub: "member-sub" },
      }),
    ).resolves.toEqual({ canRead: true, canEdit: true, canManageSteward: false });

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "team:primary#member",
          relation: "writer",
          object: "document:tome/area/project-id",
        },
      ],
      deletes: [],
    });
  });

  it("replaces the previous steward tuple when an admin reassigns it", async () => {
    const previous = {
      type: "user" as const,
      id: "old-sub",
      name: "Old User",
      email: "old@example.com",
    };
    const next = { type: "team" as const, id: "primary", name: "Primary Team" };
    mockGetCollection.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        email: "old@example.com",
        name: "Canonical Old User",
        keycloak_sub: "old-sub",
        metadata: {},
      }),
    });

    await reconcileDataSteward(project("project", previous), next);

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "team:primary#member",
          relation: "writer",
          object: "document:tome/project/project-id",
        },
      ],
      deletes: [],
    });
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      {
        user: "user:old-sub",
        relation: "writer",
        object: "document:tome/project/project-id",
      },
    ]);
  });

  it("rejects caller-supplied resolved steward identities", async () => {
    await expect(
      resolveDataSteward({
        type: "user",
        id: "forged-sub",
        name: "Forged User",
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_DATA_STEWARD" });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("refreshes stored steward metadata from the trusted user record", async () => {
    const findOne = jest.fn().mockResolvedValue({
      email: "canonical@example.com",
      name: "Canonical User",
      keycloak_sub: "canonical-sub",
      metadata: {},
    });
    mockGetCollection.mockReturnValue({
      findOne,
    });

    await expect(
      resolveStoredDataSteward({
        type: "user",
        id: "stale-sub",
        name: "Untrusted Name",
        email: "stale@example.com",
      }),
    ).resolves.toEqual({
      type: "user",
      id: "canonical-sub",
      name: "Canonical User",
      email: "canonical@example.com",
    });
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({
      $or: [
        { keycloak_sub: "stale-sub" },
        { "metadata.keycloak_sub": "stale-sub" },
      ],
    });
  });

  it("fails closed when OpenFGA is unavailable", async () => {
    mockCheckOpenFgaTuple.mockRejectedValue(new Error("unavailable"));

    await expect(
      getTomeProjectPermissions({
        project: project(),
        user: { email: "user@example.com" },
        session: { sub: "user-sub" },
      }),
    ).resolves.toEqual({ canRead: false, canEdit: false, canManageSteward: false });
  });
});
