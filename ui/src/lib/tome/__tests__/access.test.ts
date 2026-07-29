import {
  canReadTomeProject,
  listReadableTomeProjects,
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
  { initiatives: ["Example Goal"] },
);
const child = project(
  "service",
  "project",
  "Service",
  "service-team",
  { areas: ["Platform"] },
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
    expect(tomeDataObject(bhag)).toBe("document:tome/bhag/goal");
    expect(tomeDataObject(area)).toBe("document:tome/area/platform");
    expect(tomeDataObject(child)).toBe("document:tome/project/service");
  });

  it("resolves downward-only BHAG and Area parents", () => {
    expect(resolveTomeParentsFromCatalog(bhag, [bhag, area, child])).toEqual([]);
    expect(resolveTomeParentsFromCatalog(area, [bhag, area, child])).toEqual([bhag]);
    expect(resolveTomeParentsFromCatalog(child, [bhag, area, child])).toEqual([area]);
  });

  it("writes the shared-team reader and structural parent tuples", async () => {
    await reconcileTomeReadAccess(child, [bhag, area, child]);

    expect(mockWriteOpenFgaTuples).toHaveBeenCalledWith({
      writes: [
        {
          user: "team:service-team#member",
          relation: "reader",
          object: "document:tome/project/service",
        },
        {
          user: "document:tome/area/platform",
          relation: "parent",
          object: "document:tome/project/service",
        },
      ],
      deletes: [],
    });
  });

  it("removes stale managed team and parent grants", async () => {
    mockReadOpenFgaTuples
      .mockResolvedValueOnce({
        tuples: [
          {
            key: {
              user: "team:old-team#member",
              relation: "reader",
              object: "document:tome/project/service",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        tuples: [
          {
            key: {
              user: "document:tome/bhag/old-goal",
              relation: "parent",
              object: "document:tome/project/service",
            },
          },
        ],
      });

    await reconcileTomeReadAccess(child, [bhag, area, child]);

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      {
        user: "team:old-team#member",
        relation: "reader",
        object: "document:tome/project/service",
      },
      {
        user: "document:tome/bhag/old-goal",
        relation: "parent",
        object: "document:tome/project/service",
      },
    ]);
  });

  it("filters discovery from OpenFGA can_read objects", async () => {
    mockListOpenFgaObjects.mockResolvedValue({
      objects: ["document:tome/area/platform", "document:tome/project/service"],
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
