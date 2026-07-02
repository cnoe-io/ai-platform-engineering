/**
 * @jest-environment node
 */

import {
  assignPodOwner,
  getPodOwnerMigrationState,
  isPodOwnerMigrationEnabled,
  type PodOwnerMigrationCollections,
} from "../pod-owner-migration";

function chain<T>(docs: T[]) {
  return {
    sort: jest.fn(() => chain(docs)),
    project: jest.fn(() => chain(docs)),
    limit: jest.fn(() => chain(docs)),
    toArray: jest.fn(async () => docs),
  };
}

function getByPath(doc: Record<string, any>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, doc);
}

function matches(doc: Record<string, any>, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = getByPath(doc, key);
    if (expected && typeof expected === "object" && "$regex" in expected) {
      return new RegExp(expected.$regex, expected.$options || "").test(String(actual || ""));
    }
    return actual === expected;
  });
}

function collection(docs: Record<string, any>[]) {
  return {
    find: jest.fn(() => chain(docs)),
    findOne: jest.fn(async (query: Record<string, any>) => docs.find((doc) => matches(doc, query)) || null),
    updateOne: jest.fn(async (query: Record<string, any>, update: Record<string, any>) => {
      const doc = docs.find((candidate) => matches(candidate, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(doc, update.$set);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function collections(seed: Partial<Record<keyof PodOwnerMigrationCollections, Record<string, any>[]>>) {
  return {
    pods: collection(seed.pods || []),
    users: collection(seed.users || []),
    schedules: collection(seed.schedules || []),
    conversations: collection(seed.conversations || []),
  } as unknown as PodOwnerMigrationCollections;
}

describe("pod owner migration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.POD_OWNER_MIGRATION_ENABLED;
    delete process.env.NEXT_PUBLIC_POD_OWNER_MIGRATION_ENABLED;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults the temporary feature flag on and supports common false values", () => {
    expect(isPodOwnerMigrationEnabled()).toBe(true);

    for (const value of ["false", "0", "off", "no"]) {
      process.env.POD_OWNER_MIGRATION_ENABLED = value;
      expect(isPodOwnerMigrationEnabled()).toBe(false);
    }
  });

  it("summarizes owner status and recommends known single-owner signals", async () => {
    const state = await getPodOwnerMigrationState(
      collections({
        users: [
          { email: "alice@example.com", name: "Alice", metadata: { role: "admin" } },
          { email: "bob@example.com", name: "Bob" },
          { email: "sunny@example.com", name: "Sunny" },
        ],
        pods: [
          { _id: "owned", name: "Owned Pod", owner_user_id: "alice@example.com" },
          { _id: "pgm", name: "PGM Pod", pgm_email: "bob@example.com" },
          { _id: "missing", name: "Missing Pod" },
        ],
        schedules: [
          { schedule_id: "sched-1", pod_id: "missing", owner_user_id: "sunny@example.com" },
        ],
      }),
    );

    expect(state.summary).toEqual({
      total: 3,
      with_owner: 1,
      pgm_only: 1,
      without_owner: 2,
      unowned: 1,
      with_recommendation: 2,
    });

    expect(state.pods.find((pod) => pod.pod_id === "owned")?.status).toBe("owned");
    expect(state.pods.find((pod) => pod.pod_id === "pgm")?.status).toBe("pgm_only");
    expect(state.pods.find((pod) => pod.pod_id === "missing")?.recommended_owner_user_id)
      .toBe("sunny@example.com");
  });

  it("does not recommend when multiple owners are plausible", async () => {
    const state = await getPodOwnerMigrationState(
      collections({
        users: [
          { email: "alice@example.com", name: "Alice" },
          { email: "bob@example.com", name: "Bob" },
        ],
        pods: [{ _id: "ambiguous", name: "Ambiguous Pod" }],
        schedules: [
          { schedule_id: "sched-a", pod_id: "ambiguous", owner_user_id: "alice@example.com" },
          { schedule_id: "sched-b", pod_id: "ambiguous", owner_user_id: "bob@example.com" },
        ],
      }),
    );

    const pod = state.pods.find((item) => item.pod_id === "ambiguous");
    expect(pod?.candidates.map((candidate) => candidate.owner_user_id).sort())
      .toEqual(["alice@example.com", "bob@example.com"]);
    expect(pod?.recommended_owner_user_id).toBeNull();
  });

  it("assigns owner_user_id only to an existing user and records migration metadata", async () => {
    const cols = collections({
      users: [{ email: "Sunny@Example.COM", name: "Sunny" }],
      pods: [{ _id: "legacy-pod", name: "Legacy Pod" }],
    });

    const updated = await assignPodOwner(cols, {
      pod_id: "legacy-pod",
      owner_user_id: "sunny@example.com",
      migrated_by: "admin@example.com",
    });

    expect(updated.owner_user_id).toBe("sunny@example.com");
    const rawPod = await cols.pods.findOne({ _id: "legacy-pod" });
    expect(rawPod?.owner_user_id).toBe("sunny@example.com");
    expect(rawPod?.updated_by_user_id).toBe("admin@example.com");
    expect(rawPod?.owner_migration).toEqual(
      expect.objectContaining({
        migrated_by: "admin@example.com",
        owner_user_id: "sunny@example.com",
      }),
    );
  });
});
