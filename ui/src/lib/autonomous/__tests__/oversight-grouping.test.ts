import { groupTasksByTeam } from "@/lib/autonomous/oversight-grouping";
import type { AutonomousTask } from "@/components/autonomous/types";

function task(id: string, owner: string, extra: Partial<AutonomousTask> = {}): AutonomousTask {
  return {
    id, name: id, agent: null, dynamic_agent_id: "agent-x", prompt: "p",
    trigger: { type: "cron", schedule: "0 9 * * *" } as never,
    enabled: true, owner_id: owner, ...extra,
  } as AutonomousTask;
}

const teams = [
  { slug: "eng", name: "Eng" },
  { slug: "ops", name: "Ops" },
];
const members = new Map<string, { user_subject?: string | null; user_email?: string | null }[]>([
  ["eng", [{ user_email: "a@x" }, { user_email: "b@x" }]],
  ["ops", [{ user_email: "b@x" }]], // b is in both teams (Q5-A)
]);

it("places a task under every team its owner belongs to", () => {
  const r = groupTasksByTeam(teams, members, [task("t1", "b@x")]);
  expect(r.teams.find((t) => t.slug === "eng")!.counts.total).toBe(1);
  expect(r.teams.find((t) => t.slug === "ops")!.counts.total).toBe(1);
  expect(r.no_team.counts.total).toBe(0);
  // Org-wide totals count the shared task once, even though it shows on 2 teams.
  expect(r.totals).toEqual({ total: 1, paused: 0, ack_failed: 0 });
});

it("buckets tasks whose owner is in no team under no_team", () => {
  const r = groupTasksByTeam(teams, members, [task("t1", "ghost@x")]);
  expect(r.no_team.counts.total).toBe(1);
  expect(r.no_team.members[0].email).toBe("ghost@x");
});

it("matches owner email case-insensitively", () => {
  const r = groupTasksByTeam(teams, members, [task("t1", "A@X")]);
  expect(r.teams.find((t) => t.slug === "eng")!.members.map((m) => m.email)).toEqual(["a@x"]);
});

it("counts paused (enabled=false) and ack_failed", () => {
  const r = groupTasksByTeam(teams, members, [
    task("t1", "a@x", { enabled: false }),
    task("t2", "a@x", { last_ack: { ack_status: "failed" } as never }),
  ]);
  const eng = r.teams.find((t) => t.slug === "eng")!;
  expect(eng.counts).toEqual({ total: 2, paused: 1, ack_failed: 1 });
});

it("groups a team's tasks by person", () => {
  const r = groupTasksByTeam(teams, members, [task("t1", "a@x"), task("t2", "b@x")]);
  const eng = r.teams.find((t) => t.slug === "eng")!;
  expect(eng.members.map((m) => m.email).sort()).toEqual(["a@x", "b@x"]);
});

it("prefers owner_sub (UUID) over email when matching to a team", () => {
  const uuidMembers = new Map<string, { user_subject?: string | null; user_email?: string | null }[]>([
    ["eng", [{ user_subject: "sub-1", user_email: "old@x" }]],
  ]);
  // Task's email no longer matches (person changed email), but the sub does.
  const r = groupTasksByTeam(
    [{ slug: "eng", name: "Eng" }],
    uuidMembers,
    [task("t1", "new@x", { owner_sub: "sub-1" })],
  );
  expect(r.teams[0].counts.total).toBe(1);
  expect(r.no_team.counts.total).toBe(0);
});

it("falls back to email when the task has no owner_sub", () => {
  const uuidMembers = new Map<string, { user_subject?: string | null; user_email?: string | null }[]>([
    ["eng", [{ user_subject: "sub-1", user_email: "a@x" }]],
  ]);
  const r = groupTasksByTeam([{ slug: "eng", name: "Eng" }], uuidMembers, [task("t1", "a@x")]);
  expect(r.teams[0].counts.total).toBe(1);
});
