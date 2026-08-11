/**
 * @jest-environment node
 */

import { resolveUniqueTomeProjectBySlug } from "@/lib/tome/project-resolver";

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

function collectionWith(matches: unknown[]) {
  const toArray = jest.fn().mockResolvedValue(matches);
  const limit = jest.fn().mockReturnValue({ toArray });
  const find = jest.fn().mockReturnValue({ limit });
  return {
    find,
    limit,
    toArray,
  };
}

describe("unique Tome project slug resolution", () => {
  it("returns the sole matching record", async () => {
    const project = { _id: "project-id", slug: "example" };
    const collection = collectionWith([project]);
    mockGetCollection.mockResolvedValue(collection);
    await expect(resolveUniqueTomeProjectBySlug("example")).resolves.toBe(project);
    expect(collection.find).toHaveBeenCalledWith({ slug: "example" });
    expect(collection.limit).toHaveBeenCalledWith(2);
  });

  it("returns null when the slug does not exist", async () => {
    mockGetCollection.mockResolvedValue(collectionWith([]));

    await expect(resolveUniqueTomeProjectBySlug("missing")).resolves.toBeNull();
  });

  it("fails closed when legacy records share a slug", async () => {
    mockGetCollection.mockResolvedValue(
      collectionWith([
        { _id: "first-id", slug: "example" },
        { _id: "second-id", slug: "example" },
      ]),
    );
    await expect(resolveUniqueTomeProjectBySlug("example")).rejects.toMatchObject({
      statusCode: 409,
      code: "PROJECT_SLUG_AMBIGUOUS",
    });
  });
});
