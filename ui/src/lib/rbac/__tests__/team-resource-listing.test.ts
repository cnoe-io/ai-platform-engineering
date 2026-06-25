/**
 * @jest-environment node
 *
 * Team resource listing — OpenFGA-derived owned+shared resource ids surfaced in
 * the admin Teams & Users views. Covers prefix stripping, the relation map,
 * batch coalescing/caching, admin-grant separation, and empty/invalid slugs.
 */

const mockListOpenFgaObjects = jest.fn();

jest.mock("../openfga", () => ({
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
  // Run mapWithConcurrency synchronously-ish for deterministic tests.
  mapWithConcurrency: async (
    items: unknown[],
    _limit: number,
    fn: (item: unknown, i: number) => Promise<unknown>,
  ) => Promise.all(items.map((item, i) => fn(item, i))),
  openFgaReadConcurrency: () => 8,
}));

import {
  TeamResourceListingCache,
  listTeamResourceIds,
  listTeamResourceIdsBatch,
} from "../team-resource-listing";

type ListArgs = { user: string; relation: string; type: string };

function routeByType(
  map: Record<string, Record<string, string[]>>,
): void {
  // map[type][user] -> object refs (already type-prefixed)
  mockListOpenFgaObjects.mockImplementation(async ({ user, type }: ListArgs) => ({
    objects: map[type]?.[user] ?? [],
  }));
}

beforeEach(() => {
  mockListOpenFgaObjects.mockReset();
});

describe("listTeamResourceIds", () => {
  it("strips the type prefix and maps each kind to its relation", async () => {
    routeByType({
      agent: { "team:platform#member": ["agent:a1", "agent:a2"] },
      skill: { "team:platform#member": ["skill:s1"] },
      task: { "team:platform#member": ["task:w1", "task:w2"] },
    });

    const ids = await listTeamResourceIds("platform");

    expect(ids.agents).toEqual(["a1", "a2"]);
    expect(ids.skills).toEqual(["s1"]);
    expect(ids.workflows).toEqual(["w1", "w2"]);
    // member relation is `user` for all three kinds
    for (const type of ["agent", "skill", "task"]) {
      expect(mockListOpenFgaObjects).toHaveBeenCalledWith(
        expect.objectContaining({ type, relation: "user", user: "team:platform#member" }),
      );
    }
  });

  it("separates agent manage grants via team admins", async () => {
    mockListOpenFgaObjects.mockImplementation(async ({ user, type }: ListArgs) => {
      if (type === "agent" && user === "team:platform#member") {
        return { objects: ["agent:a1", "agent:a2"] };
      }
      if (type === "agent" && user === "team:platform#admin") {
        return { objects: ["agent:a1"] };
      }
      return { objects: [] };
    });

    const ids = await listTeamResourceIds("platform");

    expect(ids.agents).toEqual(["a1", "a2"]);
    expect(ids.agentAdmins).toEqual(["a1"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledWith(
      expect.objectContaining({ user: "team:platform#admin", relation: "manager", type: "agent" }),
    );
  });

  it("ignores objects whose ref lacks the expected type prefix", async () => {
    routeByType({
      agent: { "team:platform#member": ["agent:a1", "skill:bogus", "", "agent:"] },
    });
    const ids = await listTeamResourceIds("platform", new TeamResourceListingCache(), ["agents"]);
    expect(ids.agents).toEqual(["a1"]);
  });

  it("returns empty for blank slug without calling OpenFGA", async () => {
    const ids = await listTeamResourceIds("   ");
    expect(ids.agents).toEqual([]);
    expect(mockListOpenFgaObjects).not.toHaveBeenCalled();
  });

  it("propagates OpenFGA errors (no silent empty)", async () => {
    mockListOpenFgaObjects.mockRejectedValue(new Error("FGA down"));
    await expect(listTeamResourceIds("platform")).rejects.toThrow("FGA down");
  });
});

describe("TeamResourceListingCache coalescing", () => {
  it("memoizes duplicate (slug, type, relation) lookups", async () => {
    routeByType({ skill: { "team:platform#member": ["skill:s1"] } });
    const cache = new TeamResourceListingCache();
    const [a, b] = await Promise.all([
      cache.listTeamResourceObjectIds({ teamSlug: "platform", type: "skill", relation: "user" }),
      cache.listTeamResourceObjectIds({ teamSlug: "platform", type: "skill", relation: "user" }),
    ]);
    expect(a).toEqual(["s1"]);
    expect(b).toEqual(["s1"]);
    expect(mockListOpenFgaObjects).toHaveBeenCalledTimes(1);
  });
});

describe("listTeamResourceIdsBatch", () => {
  it("dedupes slugs and returns a map per team", async () => {
    routeByType({
      agent: {
        "team:platform#member": ["agent:a1"],
        "team:payments#member": ["agent:a2"],
      },
    });
    const result = await listTeamResourceIdsBatch(
      ["platform", "payments", "platform", "  "],
      ["agents"],
    );
    expect(result.size).toBe(2);
    expect(result.get("platform")?.agents).toEqual(["a1"]);
    expect(result.get("payments")?.agents).toEqual(["a2"]);
  });
});
