/**
 * @jest-environment node
 */
/**
 * #43 dual-store migration: legacy `tool:<server>_*` → `tool:<server>/*` in BOTH
 * OpenFGA tuples AND Mongo team.resources.tools[]. Key property (team-lead): a
 * team-resources PUT immediately after migration must compute a NO-OP diff.
 */

import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import {
  applyTeamToolWildcardSlashMigration,
  computeTeamToolWildcardRewrites,
  isLegacyUnderscoreWildcard,
  planTeamToolWildcardSlashMigration,
  toSlashWildcard,
} from "../team-tool-wildcard-slash";

// Mirror of the route's diff() (ui/src/app/api/admin/teams/[id]/resources/route.ts).
function diff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((x) => !prevSet.has(x)),
    removed: prev.filter((x) => !nextSet.has(x)),
  };
}

describe("helpers", () => {
  it("detects + rewrites only underscore WILDCARDS, not plain underscore ids", () => {
    expect(isLegacyUnderscoreWildcard("knowledge-base_*")).toBe(true);
    expect(isLegacyUnderscoreWildcard("jira_*")).toBe(true);
    expect(isLegacyUnderscoreWildcard("jira_search")).toBe(false); // real tool id, not a wildcard
    expect(isLegacyUnderscoreWildcard("jira/*")).toBe(false); // already slash
    expect(toSlashWildcard("knowledge-base_*")).toBe("knowledge-base/*");
    expect(toSlashWildcard("jira_search")).toBe("jira_search"); // untouched
  });
});

describe("computeTeamToolWildcardRewrites", () => {
  it("rewrites both stores; leaves non-wildcard + already-slash entries alone", () => {
    const teams = [
      {
        _id: "team-sre",
        slug: "team-sre",
        resources: { tools: ["knowledge-base_*", "jira_search", "argocd/*"] },
      },
      { _id: "team-empty", slug: "team-empty", resources: { tools: [] } },
    ];
    const toolTuples: OpenFgaTupleKey[] = [
      { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" },
      { user: "team:team-sre#member", relation: "caller", object: "tool:argocd/*" }, // already slash
      { user: "team:team-sre#member", relation: "user", object: "agent:x" }, // not a tool
    ];

    const r = computeTeamToolWildcardRewrites({ teams, toolTuples });

    // OpenFGA: only the underscore-wildcard tuple is rewritten.
    expect(r.tupleDeletes).toEqual([
      { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" },
    ]);
    expect(r.tupleWrites).toEqual([
      { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base/*" },
    ]);

    // Mongo: team-sre's array gets the one entry rewritten; others preserved + order kept.
    expect(r.mongoUpdates).toEqual([
      { teamId: "team-sre", tools: ["knowledge-base/*", "jira_search", "argocd/*"] },
    ]);
  });

  it("emits no updates when nothing is legacy", () => {
    const r = computeTeamToolWildcardRewrites({
      teams: [{ _id: "t", resources: { tools: ["jira/*", "jira_search"] } }],
      toolTuples: [{ user: "team:t#member", relation: "caller", object: "tool:jira/*" }],
    });
    expect(r.tupleWrites).toEqual([]);
    expect(r.tupleDeletes).toEqual([]);
    expect(r.mongoUpdates).toEqual([]);
  });
});

describe("apply", () => {
  it("writes new tuples + deletes old + updates Mongo, and reports counts", async () => {
    const teams = [
      { _id: "team-sre", resources: { tools: ["knowledge-base_*"] } },
    ];
    const toolTuples: OpenFgaTupleKey[] = [
      { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" },
    ];
    // Returns ACTUAL applied counts (#57) — apply reports these, not planned lengths.
    const writeTuples = jest.fn().mockResolvedValue({ writes: 1, deletes: 1 });
    const updateOne = jest.fn().mockResolvedValue({});

    const result = await applyTeamToolWildcardSlashMigration({
      teams,
      toolTuples,
      actor: "admin@example.com",
      now: "2026-06-08T00:00:00.000Z",
      writeTuples,
      teamsCollection: { updateOne },
    });

    expect(writeTuples).toHaveBeenCalledWith({
      writes: [{ user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base/*" }],
      deletes: [{ user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" }],
    });
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "team-sre" });
    expect((update as { $set: Record<string, unknown> }).$set["resources.tools"]).toEqual([
      "knowledge-base/*",
    ]);
    expect(result.applied_counts).toEqual({
      teams_updated: 1,
      tuple_writes_applied: 1,
      tuple_deletes_applied: 1,
    });
  });

  it("reports the ACTUAL writer counts, not the planned diff lengths (#57)", async () => {
    // Plan computes 1 write + 1 delete, but the writer reports different actuals
    // (e.g. a no-op filtered write). applied_counts must reflect the WRITER.
    const teams = [{ _id: "team-sre", resources: { tools: ["knowledge-base_*"] } }];
    const toolTuples: OpenFgaTupleKey[] = [
      { user: "team:team-sre#member", relation: "caller", object: "tool:knowledge-base_*" },
    ];
    const writeTuples = jest.fn().mockResolvedValue({ writes: 0, deletes: 1 });

    const result = await applyTeamToolWildcardSlashMigration({
      teams,
      toolTuples,
      actor: "admin@example.com",
      now: "2026-06-08T00:00:00.000Z",
      writeTuples,
      teamsCollection: { updateOne: jest.fn().mockResolvedValue({}) },
    });

    // Planned was 1 write; writer said 0 → report 0 (not the planned 1).
    expect(result.applied_counts.tuple_writes_applied).toBe(0);
    expect(result.applied_counts.tuple_deletes_applied).toBe(1);
  });

  it("CRITICAL: a team-resources PUT immediately after migration is a NO-OP diff", () => {
    // Pre-migration Mongo state.
    const original = ["knowledge-base_*", "jira_search"];
    // Migration rewrites the Mongo array.
    const r = computeTeamToolWildcardRewrites({
      teams: [{ _id: "t", resources: { tools: original } }],
      toolTuples: [],
    });
    const migrated = r.mongoUpdates[0].tools; // what's now persisted

    // The route's picker now OFFERS slash form; a PUT re-submitting the same
    // logical selection sends the slash forms. prevTools (migrated Mongo) vs
    // nextTools (slash offer) must diff to nothing.
    const nextSubmitted = ["knowledge-base/*", "jira_search"];
    const d = diff(migrated, nextSubmitted);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("plan reports correct counts + confirmation", () => {
    const plan = planTeamToolWildcardSlashMigration({
      teams: [{ _id: "t", resources: { tools: ["jira_*"] } }],
      toolTuples: [{ user: "team:t#member", relation: "caller", object: "tool:jira_*" }],
    });
    expect(plan.counts.teams_to_update).toBe(1);
    expect(plan.counts.tuple_rewrites).toBe(1);
    expect(plan.tuple_writes_planned).toBe(1);
    expect(plan.confirmation).toBe("MIGRATE team tool wildcards TO slash");
  });
});
