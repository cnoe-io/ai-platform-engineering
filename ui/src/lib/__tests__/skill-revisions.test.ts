/**
 * @jest-environment node
 */
// assisted-by cursor (composer-2-fast)
//
// Pins the skill-revisions data model and retention policy. The
// guarantees we care about are:
//
//   * `recordRevision` writes a new row, computes a monotonic
//     revision_number, and prunes anything past
//     MAX_REVISIONS_PER_SKILL.
//   * `pruneToRetention` keeps the newest N rows by revision_number
//     (NOT by clock time), so a clock skew can't strand an old row.
//   * `listRevisions` strips heavy content fields and projects a
//     compact summary for the timeline UI.
//   * `getRevision` returns the full snapshot for restore/diff.
//   * `snapshotsDiffer` correctly elides no-op writes.
//
// We mock `@/lib/mongodb` with an in-memory backing store so the
// tests can exercise the prune behavior end-to-end without standing
// up a real MongoDB. The mock implements just enough of the driver
// surface used by skill-revisions (find/sort/limit/project/toArray,
// insertOne, deleteMany, findOne).

interface RawDoc extends Record<string, unknown> {
  id: string;
  skill_id: string;
  revision_number: number;
  created_at: Date;
}

let store: RawDoc[] = [];

function buildCollection() {
  return {
    insertOne: jest.fn(async (doc: RawDoc) => {
      store.push({ ...doc });
      return { acknowledged: true, insertedId: doc.id };
    }),
    deleteMany: jest.fn(async (filter: Record<string, unknown>) => {
      const matches = (d: RawDoc) => {
        if (
          filter.skill_id !== undefined &&
          d.skill_id !== filter.skill_id
        ) {
          return false;
        }
        const idClause = filter.id as
          | { $nin?: string[] }
          | string
          | undefined;
        if (idClause && typeof idClause === "object" && "$nin" in idClause) {
          if (idClause.$nin?.includes(d.id)) return false;
        } else if (typeof idClause === "string") {
          if (d.id !== idClause) return false;
        }
        return true;
      };
      const before = store.length;
      store = store.filter((d) => !matches(d));
      return { deletedCount: before - store.length };
    }),
    findOne: jest.fn(
      async (
        filter: Record<string, unknown>,
        opts?: { projection?: Record<string, number> },
      ) => {
        void opts;
        const found = store.find(
          (d) =>
            (filter.skill_id === undefined ||
              d.skill_id === filter.skill_id) &&
            (filter.id === undefined || d.id === filter.id),
        );
        return found ?? null;
      },
    ),
    find: jest.fn((filter: Record<string, unknown>) => {
      let rows = store.filter(
        (d) =>
          filter.skill_id === undefined || d.skill_id === filter.skill_id,
      );
      const cursor = {
        sort: (spec: Record<string, 1 | -1>) => {
          const [[key, dir]] = Object.entries(spec);
          rows = [...rows].sort((a, b) => {
            const av = a[key as keyof RawDoc] as number;
            const bv = b[key as keyof RawDoc] as number;
            return dir === 1 ? av - bv : bv - av;
          });
          return cursor;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return cursor;
        },
        project: <T,>(_p: Record<string, number>): typeof cursor => {
          // We pass through the full row — every consumer in the
          // module under test only relies on the fields it requested
          // existing, not on absence of the others.
          return cursor as unknown as typeof cursor;
        },
        toArray: async () => rows.map((r) => ({ ...r })),
      };
      return cursor;
    }),
  };
}

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => buildCollection()),
}));

import {
  recordRevision,
  listRevisions,
  getRevision,
  pruneToRetention,
  snapshotsDiffer,
  MAX_REVISIONS_PER_SKILL,
  type SkillSnapshotInput,
} from "@/lib/skill-revisions";

const baseSnapshot = (over: Partial<SkillSnapshotInput> = {}): SkillSnapshotInput => ({
  name: "Test skill",
  description: "desc",
  category: "Custom",
  tasks: [],
  metadata: { tags: ["a"] },
  skill_content: "# Hi",
  ancillary_files: {},
  ...over,
});

describe("skill-revisions", () => {
  beforeEach(() => {
    store = [];
  });

  describe("recordRevision", () => {
    it("writes a row with monotonic revision_number starting at 1", async () => {
      const r1 = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "create",
        actor: "alice@example.com",
      });
      const r2 = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot({ skill_content: "# v2" }),
        trigger: "update",
        actor: "alice@example.com",
      });
      expect(r1?.revision_number).toBe(1);
      expect(r2?.revision_number).toBe(2);
      expect(r1?.id).not.toEqual(r2?.id);
    });

    it("scopes revision_number per skill_id (skill-b restarts at 1)", async () => {
      await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "create",
      });
      await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "update",
      });
      const rB = await recordRevision({
        skillId: "skill-b",
        snapshot: baseSnapshot(),
        trigger: "create",
      });
      expect(rB?.revision_number).toBe(1);
    });

    it("captures content fields but never administrative fields", async () => {
      const rev = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot({
          name: "Picked",
          skill_content: "# pick me",
          ancillary_files: { "scripts/run.sh": "echo hi" },
        }),
        trigger: "create",
      });
      expect(rev).not.toBeNull();
      // Snapshot fields are present.
      expect(rev?.name).toBe("Picked");
      expect(rev?.skill_content).toBe("# pick me");
      expect(rev?.ancillary_files).toEqual({ "scripts/run.sh": "echo hi" });
      // Administrative fields are NOT — pinning the leak guard.
      expect((rev as Record<string, unknown>).owner_id).toBeUndefined();
      expect((rev as Record<string, unknown>).is_system).toBeUndefined();
      expect((rev as Record<string, unknown>).visibility).toBeUndefined();
      expect((rev as Record<string, unknown>).shared_with_teams).toBeUndefined();
    });

    it("prunes to MAX_REVISIONS_PER_SKILL on every write", async () => {
      // Write 12 revisions (default cap is 10).
      for (let i = 0; i < MAX_REVISIONS_PER_SKILL + 2; i++) {
        await recordRevision({
          skillId: "skill-a",
          snapshot: baseSnapshot({ skill_content: `# v${i}` }),
          trigger: "update",
        });
      }
      const rows = store.filter((d) => d.skill_id === "skill-a");
      expect(rows.length).toBe(MAX_REVISIONS_PER_SKILL);
      // The newest rows must be the ones retained, by revision_number.
      const numbers = rows
        .map((r) => r.revision_number)
        .sort((a, b) => a - b);
      const min = numbers[0];
      const max = numbers[numbers.length - 1];
      expect(max).toBe(MAX_REVISIONS_PER_SKILL + 2);
      expect(min).toBe(3); // 1 and 2 should have been pruned
    });

    it("does not affect other skills' rows during prune", async () => {
      for (let i = 0; i < MAX_REVISIONS_PER_SKILL + 2; i++) {
        await recordRevision({
          skillId: "skill-a",
          snapshot: baseSnapshot(),
          trigger: "update",
        });
      }
      await recordRevision({
        skillId: "skill-b",
        snapshot: baseSnapshot(),
        trigger: "create",
      });
      const aCount = store.filter((d) => d.skill_id === "skill-a").length;
      const bCount = store.filter((d) => d.skill_id === "skill-b").length;
      expect(aCount).toBe(MAX_REVISIONS_PER_SKILL);
      expect(bCount).toBe(1);
    });

    it("records optional `note` and `restoredFrom` fields", async () => {
      const rev = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "restore",
        note: "Reverted to v3 after bad save",
        restoredFrom: "rev-source-id",
      });
      expect(rev?.note).toBe("Reverted to v3 after bad save");
      expect(rev?.restored_from).toBe("rev-source-id");
    });
  });

  describe("listRevisions", () => {
    it("returns rows newest-first and strips heavy content fields", async () => {
      const ancillary = { "a.sh": "x".repeat(2048) };
      await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot({
          skill_content: "# big".repeat(500),
          ancillary_files: ancillary,
        }),
        trigger: "create",
      });
      await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot({
          skill_content: "# bigger".repeat(500),
          ancillary_files: ancillary,
        }),
        trigger: "update",
      });

      const list = await listRevisions("skill-a");
      expect(list.length).toBe(2);
      // Newest first.
      expect(list[0].revision_number).toBe(2);
      expect(list[1].revision_number).toBe(1);
      // Heavy fields stripped.
      expect((list[0] as Record<string, unknown>).skill_content).toBeUndefined();
      expect((list[0] as Record<string, unknown>).ancillary_files).toBeUndefined();
      // Sizes computed for display.
      expect(list[0].skill_content_size).toBeGreaterThan(0);
      expect(list[0].ancillary_file_count).toBe(1);
      expect(list[0].ancillary_total_size).toBe(2048);
    });

    it("returns [] for unknown skill ids without throwing", async () => {
      const out = await listRevisions("unknown-skill");
      expect(out).toEqual([]);
    });
  });

  describe("getRevision", () => {
    it("returns the full snapshot including SKILL.md and ancillary", async () => {
      const created = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot({
          skill_content: "# full",
          ancillary_files: { "x.sh": "echo" },
        }),
        trigger: "create",
      });
      expect(created).not.toBeNull();
      const got = await getRevision("skill-a", created!.id);
      expect(got).not.toBeNull();
      expect(got?.skill_content).toBe("# full");
      expect(got?.ancillary_files).toEqual({ "x.sh": "echo" });
    });

    it("returns null when revision_id does not match the skill_id", async () => {
      const a = await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "create",
      });
      // Cross-skill lookup must fail closed — defends against an
      // attacker who guesses a revision id and tries to read history
      // for a skill they don't have access to (the route does the
      // visibility check, but the helper enforces the scoping).
      const wrong = await getRevision("skill-b", a!.id);
      expect(wrong).toBeNull();
    });
  });

  describe("pruneToRetention", () => {
    it("is a no-op when keep is 0", async () => {
      await recordRevision({
        skillId: "skill-a",
        snapshot: baseSnapshot(),
        trigger: "create",
      });
      const result = await pruneToRetention("skill-a", 0);
      expect(result.pruned).toBe(0);
      expect(store.length).toBe(1);
    });

    it("keeps the newest N by revision_number, not insertion order", async () => {
      for (let i = 0; i < 5; i++) {
        await recordRevision({
          skillId: "skill-a",
          snapshot: baseSnapshot(),
          trigger: "update",
        });
      }
      const { pruned } = await pruneToRetention("skill-a", 2);
      expect(pruned).toBe(3);
      const rows = store.filter((d) => d.skill_id === "skill-a");
      const numbers = rows.map((r) => r.revision_number).sort();
      expect(numbers).toEqual([4, 5]);
    });
  });

  describe("snapshotsDiffer", () => {
    it("returns true when prev is null/undefined (initial revision)", () => {
      expect(snapshotsDiffer(null, baseSnapshot())).toBe(true);
      expect(snapshotsDiffer(undefined, baseSnapshot())).toBe(true);
    });

    it("returns false when content fields are byte-identical", () => {
      const a = baseSnapshot();
      const b = baseSnapshot();
      expect(snapshotsDiffer(a, b)).toBe(false);
    });

    it("trips on SKILL.md content changes", () => {
      const a = baseSnapshot({ skill_content: "# v1" });
      const b = baseSnapshot({ skill_content: "# v2" });
      expect(snapshotsDiffer(a, b)).toBe(true);
    });

    it("trips on ancillary changes (added file)", () => {
      const a = baseSnapshot({ ancillary_files: {} });
      const b = baseSnapshot({ ancillary_files: { "x.sh": "echo" } });
      expect(snapshotsDiffer(a, b)).toBe(true);
    });

    it("does NOT trip on a scan_status-only refresh", () => {
      const a = baseSnapshot({ scan_status: "passed" });
      const b = baseSnapshot({ scan_status: "flagged" });
      // We deliberately don't burn a revision slot when the only
      // thing that changed is the scanner's verdict on identical
      // content (e.g. policy bumped, scanner re-ran). The route
      // layer can override by passing a content-bearing snapshot.
      expect(snapshotsDiffer(a, b)).toBe(false);
    });

    it("trips on metadata changes (tags)", () => {
      const a = baseSnapshot({ metadata: { tags: ["a"] } });
      const b = baseSnapshot({ metadata: { tags: ["a", "b"] } });
      expect(snapshotsDiffer(a, b)).toBe(true);
    });

    it("trips on tasks changes", () => {
      const a = baseSnapshot({ tasks: [] });
      const b = baseSnapshot({
        tasks: [{ display_text: "step", llm_prompt: "p", subagent: "github" }],
      });
      expect(snapshotsDiffer(a, b)).toBe(true);
    });
  });
});
