import { summarizeOversight } from "@/lib/autonomous/oversight-view";
import type { OversightCounts, OversightResult } from "@/lib/autonomous/oversight-grouping";
import type { AutonomousTask } from "@/components/autonomous/types";

function task(id: string, extra: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id,
    name: id,
    agent: null,
    dynamic_agent_id: "agent-x",
    prompt: "p",
    trigger: { type: "cron", schedule: "0 9 * * *" } as never,
    enabled: true,
    owner_id: "o@x",
    ...extra,
  } as AutonomousTask;
}

function team(
  slug: string,
  name: string,
  counts: OversightCounts,
  tasks: AutonomousTask[] = [],
) {
  return { slug, name, counts, members: tasks.length ? [{ email: "o@x", tasks }] : [] };
}

const emptyNoTeam = { counts: { total: 0, paused: 0, ack_failed: 0 }, members: [] };

it("buckets teams into attention / healthy / quiet by health", () => {
  const data: OversightResult = {
    teams: [
      team("eng", "Eng", { total: 3, paused: 1, ack_failed: 1 }),
      team("ops", "Ops", { total: 2, paused: 1, ack_failed: 0 }),
      team("plat", "Platform", { total: 4, paused: 0, ack_failed: 0 }),
      team("design", "Design", { total: 0, paused: 0, ack_failed: 0 }),
    ],
    no_team: emptyNoTeam,
    totals: { total: 9, paused: 2, ack_failed: 1 },
  };
  const s = summarizeOversight(data);
  expect(s.attention.map((c) => c.slug)).toEqual(["eng", "ops"]); // failed-first
  expect(s.healthy.map((c) => c.slug)).toEqual(["plat"]);
  expect(s.quiet.map((c) => c.slug)).toEqual(["design"]);
});

it("passes through the grouping helper's distinct totals and adds a team count", () => {
  const data: OversightResult = {
    teams: [
      team("eng", "Eng", { total: 2, paused: 1, ack_failed: 0 }),
      team("ops", "Ops", { total: 2, paused: 1, ack_failed: 0 }),
    ],
    no_team: emptyNoTeam,
    // Distinct org totals (owner on both teams counted once) — the grouping
    // helper computes this from the flat list; the view just surfaces it.
    totals: { total: 2, paused: 1, ack_failed: 0 },
  };
  expect(summarizeOversight(data).totals).toEqual({ teams: 2, tasks: 2, paused: 1, failed: 0 });
});

it("derives the soonest next run across enabled tasks only", () => {
  const tasks = [
    task("t1", { next_run: "2026-07-06T12:00:00Z" }),
    task("t2", { next_run: "2026-07-06T09:00:00Z", enabled: false }), // paused: ignored
    task("t3", { next_run: "2026-07-06T10:00:00Z" }),
  ];
  const data: OversightResult = {
    teams: [team("eng", "Eng", { total: 3, paused: 1, ack_failed: 0 }, tasks)],
    no_team: emptyNoTeam,
    totals: { total: 3, paused: 1, ack_failed: 0 },
  };
  const card = summarizeOversight(data).attention[0];
  expect(card.nextRunIso).toBe("2026-07-06T10:00:00Z");
  expect(card.active).toBe(2);
  expect(card.people).toBe(1);
});

it("includes the no-team bucket as a pseudo-team only when it has tasks", () => {
  const withOrphans: OversightResult = {
    teams: [team("eng", "Eng", { total: 1, paused: 0, ack_failed: 0 }, [task("t1")])],
    no_team: {
      counts: { total: 1, paused: 0, ack_failed: 1 },
      members: [{ email: "x@x", tasks: [task("t9", { last_ack: { ack_status: "failed" } as never })] }],
    },
    totals: { total: 2, paused: 0, ack_failed: 1 },
  };
  const s = summarizeOversight(withOrphans);
  expect(s.attention.map((c) => c.name)).toContain("No team");
  expect(s.attention.find((c) => c.name === "No team")!.slug).toBeNull();

  const noOrphans: OversightResult = { ...withOrphans, no_team: emptyNoTeam, totals: { total: 1, paused: 0, ack_failed: 0 } };
  const s2 = summarizeOversight(noOrphans);
  expect(s2.attention.some((c) => c.name === "No team")).toBe(false);
  expect(s2.quiet.some((c) => c.name === "No team")).toBe(false);
});
