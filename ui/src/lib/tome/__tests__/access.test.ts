import {
  canReadTomeProject,
  ensureTomeReadAccessCatalog,
  invalidateTomeReadAccessCatalogCache,
  listReadableTomeProjects,
  migrateLegacyTomeAuthorization,
  removeTomeReadAccess,
  reconcileTomeReadAccess,
  resetTomeReadAccessCatalogCacheForTests,
  resolveTomeParentsFromCatalog,
  tomeDataObject,
} from "@/lib/tome/access";
import type { ProjectDocument } from "@/types/projects";

const mockGetCollection = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
const mockListOpenFgaObjects = jest.fn();
const mockReadOpenFgaTuples = jest.fn();
const mockWriteOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();

jest.mock("mongodb", () => ({
  ObjectId: class MockObjectId {
    static isValid(): boolean {
      return false;
    }
  },
}));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock("@/lib/rbac/openfga", () => ({
  batchCheckOpenFgaTuples: jest.fn(),
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) =>
    mockDeleteExactOpenFgaTuples(...args),
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  writeOpenFgaTuples: (...args: unknown[]) => mockWriteOpenFgaTuples(...args),
}));

function project(
  slug: string,
  type: ProjectDocument["type"],
  name: string,
  teamSlug: string,
  labels: ProjectDocument["labels"] = {},
): ProjectDocument {
  return {
    _id: `${slug}-id`,
    tome_authorization_version: 2,
    type,
    slug,
    name,
    title: name,
    description: "",
    team_id: `${teamSlug}-id`,
    team_slug: teamSlug,
    team_name: `${teamSlug} team`,
    owner_id: "owner@example.test",
    member_ids: [],
    domain: "default",
    labels,
    tags: [],
    status: "active",
    catalog: {} as ProjectDocument["catalog"],
    components: [],
    onboarding: {},
    integrations: {},
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const bhag = project("goal", "bhag", "Example Goal", "strategy");
const area = project(
  "platform",
  "area",
  "Platform",
  "platform-team",
  { initiatives: ["goal"] },
);
const child = project(
  "service",
  "project",
  "Service",
  "service-team",
  { areas: ["platform"] },
);

describe("Tome read authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTomeReadAccessCatalogCacheForTests();
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [],
      continuationToken: undefined,
    });
    mockWriteOpenFgaTuples.mockResolvedValue({
      enabled: true,
      writes: 1,
      deletes: 0,
    });
    mockDeleteExactOpenFgaTuples.mockResolvedValue({
      enabled: true,
      writes: 0,
      deletes: 1,
    });
    mockGetCollection.mockReturnValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([bhag, area, child]),
      }),
    });
  });

  it("uses a distinct OpenFGA document object at every hierarchy level", () => {
    expect(tomeDataObject(bhag)).toBe("document:tome/bhag/goal-id");
    expect(tomeDataObject(area)).toBe("document:tome/area/platform-id");
    expect(tomeDataObject(child)).toBe("document:tome/project/service-id");
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["whitespace", "project id"],
    ["colon", "project:id"],
    ["hash", "project#id"],
    ["overlong", "x".repeat(257)],
  ])("rejects a %s immutable id before building an OpenFGA object", (_case, id) => {
    expect(() => tomeDataObject({ ...child, _id: id as string })).toThrow(
      "has no immutable project id",
    );
  });

  it("keeps equal slugs isolated by immutable id", () => {
    expect(tomeDataObject(child)).not.toBe(
      tomeDataObject({ ...child, _id: "other-service-id" }),
    );
  });

  it("resolves downward-only BHAG and Area parents", () => {
    expect(resolveTomeParentsFromCatalog(bhag, [bhag, area, child])).toEqual([]);
    expect(resolveTomeParentsFromCatalog(area, [bhag, area, child])).toEqual([bhag]);
    expect(resolveTomeParentsFromCatalog(child, [bhag, area, child])).toEqual([area]);
  });

  it("writes the shared-team reader and structural parent tuples", async () => {
    await reconcileTomeReadAccess(child, [bhag, area, child]);

    expect(mockWriteOpenFgaTuples).toHaveBeenNthCalledWith(1, {
      writes: [
        {
          user: "team:service-team#member",
          relation: "reader",
          object: "document:tome/project/service-id",
        },
      ],
      deletes: [],
    });
    expect(mockWriteOpenFgaTuples).toHaveBeenNthCalledWith(2, {
      writes: [
        {
          user: "document:tome/area/platform-id",
          relation: "parent",
          object: "document:tome/project/service-id",
        },
      ],
      deletes: [],
    });
  });

  it("preserves direct team access while the deployed model lacks document#parent", async () => {
    const longObject = `document:tome/project/example-${"x".repeat(220)}`;
    const detailsMessage =
      `Invalid tuple '${longObject}#parent@document:tome/bhag/example-goal'. ` +
      "Reason: relation 'document#parent' not found";
    const truncatedMessage =
      `OpenFGA tuple write failed: 400 ${JSON.stringify({
        code: "validation_error",
        message: detailsMessage,
      }).slice(0, 200)}`;
    const staleModelError = Object.assign(
      new Error(truncatedMessage),
      {
        name: "OpenFgaWriteError",
        status: 400,
        details: {
          code: "validation_error",
          message: detailsMessage,
        },
      },
    );
    expect(staleModelError.message).not.toContain("not found");
    mockWriteOpenFgaTuples
      .mockResolvedValueOnce({ enabled: true, writes: 1, deletes: 0 })
      .mockRejectedValueOnce(staleModelError);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      reconcileTomeReadAccess(child, [bhag, area, child]),
    ).resolves.toBeUndefined();

    expect(mockWriteOpenFgaTuples).toHaveBeenNthCalledWith(1, {
      writes: [
        {
          user: "team:service-team#member",
          relation: "reader",
          object: "document:tome/project/service-id",
        },
      ],
      deletes: [],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rerunning openfga-init"),
    );
    warn.mockRestore();
  });

  it("does not hide a structured validation failure for another relation", async () => {
    const validationError = Object.assign(
      new Error("OpenFGA tuple write failed: 400 validation_error"),
      {
        name: "OpenFgaWriteError",
        status: 400,
        details: {
          code: "validation_error",
          message: "Reason: relation 'document#owner' not found",
        },
      },
    );
    mockWriteOpenFgaTuples
      .mockResolvedValueOnce({ enabled: true, writes: 1, deletes: 0 })
      .mockRejectedValueOnce(validationError);

    await expect(
      reconcileTomeReadAccess(child, [bhag, area, child]),
    ).rejects.toBe(validationError);
  });

  it("does not hide unrelated parent tuple write failures", async () => {
    const writeError = Object.assign(
      new Error("OpenFGA tuple write failed: 500 unavailable"),
      { name: "OpenFgaWriteError", status: 500 },
    );
    mockWriteOpenFgaTuples
      .mockResolvedValueOnce({ enabled: true, writes: 1, deletes: 0 })
      .mockRejectedValueOnce(writeError);

    await expect(
      reconcileTomeReadAccess(child, [bhag, area, child]),
    ).rejects.toThrow("500 unavailable");
  });

  it("removes stale managed team and parent grants", async () => {
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: { object?: string; relation?: string } }) => {
        if (
          tuple.object === "document:tome/project/service-id" &&
          tuple.relation === "reader"
        ) {
          return Promise.resolve({
        tuples: [
          {
            key: {
              user: "team:old-team#member",
              relation: "reader",
              object: "document:tome/project/service-id",
            },
          },
        ],
          });
        }
        if (
          tuple.object === "document:tome/project/service-id" &&
          tuple.relation === "parent"
        ) {
          return Promise.resolve({
        tuples: [
          {
            key: {
              user: "document:tome/bhag/old-goal",
              relation: "parent",
              object: "document:tome/project/service-id",
            },
          },
        ],
          });
        }
        return Promise.resolve({ tuples: [], continuationToken: undefined });
      },
    );

    await reconcileTomeReadAccess(child, [bhag, area, child]);

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      {
        user: "team:old-team#member",
        relation: "reader",
        object: "document:tome/project/service-id",
      },
      {
        user: "document:tome/bhag/old-goal",
        relation: "parent",
        object: "document:tome/project/service-id",
      },
    ]);
  });

  it("removes inbound parent edges when deleting a Tome entity", async () => {
    // readAllTuples({ user, relation }) has no object at all — OpenFGA
    // rejects that outright, so the caller adds a type-only `object:
    // "document:"` filter (every Tome object is a document:...). The mock
    // asserts that widened filter shape.
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: { object?: string; user?: string; relation?: string } }) => {
        if (
          tuple.user === "document:tome/area/platform-id" &&
          tuple.relation === "parent" &&
          tuple.object === "document:"
        ) {
          return Promise.resolve({
            tuples: [
              {
                key: {
                  user: "document:tome/area/platform-id",
                  relation: "parent",
                  object: "document:tome/project/service-id",
                },
              },
            ],
          });
        }
        return Promise.resolve({ tuples: [], continuationToken: undefined });
      },
    );

    await removeTomeReadAccess(area);

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      {
        user: "document:tome/area/platform-id",
        relation: "parent",
        object: "document:tome/project/service-id",
      },
    ]);
  });

  it("migrates legacy slug tuples before using immutable-id objects", async () => {
    const legacyObject = "document:tome/project/service";
    const legacyChild = {
      ...child,
      tome_authorization_version: undefined,
      data_steward: {
        type: "user" as const,
        id: "canonical-sub",
        name: "Canonical Steward",
        email: "steward@example.test",
      },
    };
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockImplementation((name: string) =>
      name === "users"
        ? {
            findOne: jest.fn().mockResolvedValue({
              email: "steward@example.test",
              name: "Canonical Steward",
              keycloak_sub: "canonical-sub",
              metadata: {},
            }),
          }
        : { updateOne },
    );
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: { object?: string; user?: string } }) => {
        if (tuple.object === legacyObject) {
          return Promise.resolve({
            tuples: [
              {
                key: {
                  user: "user:forged-sub",
                  relation: "writer",
                  object: legacyObject,
                },
              },
            ],
          });
        }
        // readAllTuples({ user: legacyObject }) has no object at all — the
        // caller widens it to a type-only `object: "document:"` filter
        // (see readAllTuples's fix for the `user`-only OpenFGA /read 400).
        if (tuple.user === legacyObject && tuple.object === "document:") {
          return Promise.resolve({
            tuples: [
              {
                key: {
                  user: legacyObject,
                  relation: "parent",
                  object: "document:tome/project/child-id",
                },
              },
            ],
          });
        }
        return Promise.resolve({ tuples: [] });
      },
    );

    await migrateLegacyTomeAuthorization(legacyChild, [bhag, area, legacyChild]);

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "user:canonical-sub",
          relation: "writer",
          object: "document:tome/project/service-id",
        },
      ],
      deletes: [],
    });
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      {
        user: "user:forged-sub",
        relation: "writer",
        object: legacyObject,
      },
      {
        user: legacyObject,
        relation: "parent",
        object: "document:tome/project/child-id",
      },
    ]);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "service-id" },
      { $set: { tome_authorization_version: 2 } },
    );
  });

  it("does not touch OpenFGA or Mongo after migration is marked complete", async () => {
    await migrateLegacyTomeAuthorization(child, [bhag, area, child]);

    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("reads every legacy tuple page before deleting the old authorization object", async () => {
    const legacyChild = {
      ...child,
      tome_authorization_version: undefined,
      data_steward: undefined,
    };
    const legacyObject = "document:tome/project/service";
    const first = {
      user: "team:old-team#member",
      relation: "reader",
      object: legacyObject,
    };
    const second = {
      user: "user:old-writer",
      relation: "writer",
      object: legacyObject,
    };
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetCollection.mockImplementation((name: string) =>
      name === "users"
        ? { findOne: jest.fn().mockResolvedValue(null) }
        : { updateOne },
    );
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple, continuationToken }: {
        tuple: { object?: string; user?: string };
        continuationToken?: string;
      }) => {
        if (tuple.object === legacyObject && !continuationToken) {
          return Promise.resolve({
            tuples: [{ key: first }],
            continuationToken: "next-page",
          });
        }
        if (tuple.object === legacyObject && continuationToken === "next-page") {
          return Promise.resolve({ tuples: [{ key: second }] });
        }
        return Promise.resolve({ tuples: [] });
      },
    );

    await migrateLegacyTomeAuthorization(legacyChild, [legacyChild]);

    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
      tuple: { object: legacyObject },
      pageSize: 100,
      continuationToken: "next-page",
    });
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([first, second]);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy tuples and the migration marker when trusted writes fail", async () => {
    const legacyChild = {
      ...child,
      tome_authorization_version: undefined,
      data_steward: {
        type: "user" as const,
        id: "canonical-sub",
        name: "Canonical Steward",
        email: "steward@example.test",
      },
    };
    const updateOne = jest.fn();
    mockGetCollection.mockImplementation((name: string) =>
      name === "users"
        ? {
            findOne: jest.fn().mockResolvedValue({
              email: "steward@example.test",
              name: "Canonical Steward",
              keycloak_sub: "canonical-sub",
              metadata: {},
            }),
          }
        : { updateOne },
    );
    mockWriteOpenFgaTuples.mockResolvedValue({
      enabled: false,
      writes: 0,
      deletes: 0,
    });

    await expect(
      migrateLegacyTomeAuthorization(legacyChild, [legacyChild]),
    ).rejects.toThrow("OpenFGA is not configured");
    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does not mark migration complete when deleting legacy tuples fails", async () => {
    const legacyChild = {
      ...child,
      tome_authorization_version: undefined,
      data_steward: undefined,
    };
    const updateOne = jest.fn();
    mockGetCollection.mockImplementation((name: string) =>
      name === "users"
        ? { findOne: jest.fn().mockResolvedValue(null) }
        : { updateOne },
    );
    mockReadOpenFgaTuples.mockImplementation(
      ({ tuple }: { tuple: { object?: string } }) =>
        Promise.resolve({
          tuples: tuple.object
            ? [{
                key: {
                  user: "user:forged-sub",
                  relation: "writer",
                  object: "document:tome/project/service",
                },
              }]
            : [],
        }),
    );
    mockDeleteExactOpenFgaTuples.mockRejectedValue(new Error("delete unavailable"));

    await expect(
      migrateLegacyTomeAuthorization(legacyChild, [legacyChild]),
    ).rejects.toThrow("delete unavailable");
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("refuses to migrate an authorization object shared by duplicate records", async () => {
    const legacyChild = { ...child, tome_authorization_version: undefined };
    const duplicate = { ...legacyChild, _id: "other-id", team_id: "other-team-id" };
    await expect(
      migrateLegacyTomeAuthorization(legacyChild, [legacyChild, duplicate]),
    ).rejects.toThrow("2 project records share it");
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("skips only ambiguous legacy rows while reconciling an unrelated catalog row", async () => {
    const legacyChild = { ...child, tome_authorization_version: undefined };
    const duplicate = { ...legacyChild, _id: "other-id", team_id: "other-team-id" };
    const unrelated = project(
      "unrelated",
      "project",
      "Unrelated Project",
      "unrelated-team",
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetCollection.mockReturnValue({
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([legacyChild, duplicate, unrelated]),
      }),
    });

    await expect(ensureTomeReadAccessCatalog()).resolves.toEqual([
      legacyChild,
      duplicate,
      unrelated,
    ]);

    expect(error).toHaveBeenCalledTimes(2);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [{
        user: "team:unrelated-team#member",
        relation: "reader",
        object: "document:tome/project/unrelated-id",
      }],
      deletes: [],
    });
    error.mockRestore();
  });

  it("filters discovery from OpenFGA can_read objects", async () => {
    mockListOpenFgaObjects.mockResolvedValue({
      objects: ["document:tome/area/platform-id", "document:tome/project/service-id"],
    });

    await expect(
      listReadableTomeProjects("viewer-sub"),
    ).resolves.toEqual([area, child]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledWith({
      user: "user:viewer-sub",
      relation: "can_read",
      type: "document",
    });
  });

  it("reloads the catalog after a Tome entity mutation invalidates the cache", async () => {
    const newProject = project(
      "new-service",
      "project",
      "New Service",
      "service-team",
    );
    const toArray = jest
      .fn()
      .mockResolvedValueOnce([bhag, area, child])
      .mockResolvedValueOnce([bhag, area, child, newProject]);
    mockGetCollection.mockReturnValue({
      find: jest.fn().mockReturnValue({ toArray }),
    });
    mockListOpenFgaObjects.mockResolvedValue({
      objects: [
        "document:tome/project/service-id",
        "document:tome/project/new-service-id",
      ],
    });

    await expect(listReadableTomeProjects("viewer-sub")).resolves.toEqual([
      child,
    ]);

    invalidateTomeReadAccessCatalogCache();

    await expect(listReadableTomeProjects("viewer-sub")).resolves.toEqual([
      child,
      newProject,
    ]);
    expect(toArray).toHaveBeenCalledTimes(2);
  });

  it("preserves the Tome admin catalog override without an OpenFGA list call", async () => {
    await expect(
      listReadableTomeProjects("admin-sub", { isAdmin: true }),
    ).resolves.toEqual([bhag, area, child]);
    expect(mockListOpenFgaObjects).not.toHaveBeenCalled();
    expect(mockWriteOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("repairs the entity projection once before denying read", async () => {
    mockCheckOpenFgaTuple
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });

    await expect(canReadTomeProject("viewer-sub", child)).resolves.toBe(true);
    expect(mockWriteOpenFgaTuples).toHaveBeenCalled();
  });

  it("fails closed when OpenFGA cannot decide", async () => {
    mockCheckOpenFgaTuple.mockRejectedValue(new Error("unavailable"));
    await expect(canReadTomeProject("viewer-sub", child)).resolves.toBe(false);
  });
});
