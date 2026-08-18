import type { AutonomousTask } from "@/components/autonomous/types";

export interface OversightCounts {
  total: number;
  paused: number;
  ack_failed: number;
}
export interface OversightPerson {
  email: string;
  tasks: AutonomousTask[];
}
export interface OversightTeamGroup {
  slug: string;
  name: string;
  counts: OversightCounts;
  members: OversightPerson[];
}
export interface OversightResult {
  teams: OversightTeamGroup[];
  no_team: { counts: OversightCounts; members: OversightPerson[] };
  /**
   * Org-wide counts over the *distinct* task list (a task whose owner is on two
   * teams is counted once). Computed from the flat `tasks` input — which is
   * distinct by construction — so consumers never re-dedup per-team counts.
   */
  totals: OversightCounts;
}

function isPaused(t: AutonomousTask): boolean {
  return t.enabled === false;
}
function isAckFailed(t: AutonomousTask): boolean {
  return t.last_ack?.ack_status === "failed";
}
function countsOf(tasks: AutonomousTask[]): OversightCounts {
  return {
    total: tasks.length,
    paused: tasks.filter(isPaused).length,
    ack_failed: tasks.filter(isAckFailed).length,
  };
}

/** Group tasks by owner email into OversightPerson[] (only owners with tasks). */
function peopleOf(tasks: AutonomousTask[]): OversightPerson[] {
  const byEmail = new Map<string, AutonomousTask[]>();
  for (const t of tasks) {
    const email = (t.owner_id ?? "").toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(t);
  }
  return [...byEmail.entries()]
    .map(([email, ts]) => ({ email, tasks: ts }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Join teams × memberships × tasks (spec 2026-07-06). A task appears under
 * EVERY team its owner is a member of (Q5-A); owners in no team fall into
 * `no_team`. Matching prefers the owner's Keycloak subject (`owner_sub` ↔
 * `user_subject`, stable across email changes) and falls back to a
 * case-insensitive email match (`owner_id` ↔ `user_email`).
 */
export function groupTasksByTeam(
  teams: { slug: string; name: string }[],
  membersBySlug: Map<string, { user_subject?: string | null; user_email?: string | null }[]>,
  tasks: AutonomousTask[],
): OversightResult {
  // subject/email -> set of team slugs that subject/email is a member of
  const slugsBySubject = new Map<string, Set<string>>();
  const slugsByEmail = new Map<string, Set<string>>();
  const addTo = (index: Map<string, Set<string>>, key: string, slug: string) => {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(slug);
  };
  for (const [slug, members] of membersBySlug) {
    for (const m of members) {
      const sub = (m.user_subject ?? "").trim();
      if (sub) addTo(slugsBySubject, sub, slug);
      const email = (m.user_email ?? "").toLowerCase();
      if (email) addTo(slugsByEmail, email, slug);
    }
  }

  const slugsForTask = (task: AutonomousTask): Set<string> | undefined => {
    const sub = (task.owner_sub ?? "").trim();
    if (sub && slugsBySubject.has(sub)) return slugsBySubject.get(sub);
    const email = (task.owner_id ?? "").toLowerCase();
    if (email && slugsByEmail.has(email)) return slugsByEmail.get(email);
    return undefined;
  };

  const tasksBySlug = new Map<string, AutonomousTask[]>();
  for (const t of teams) tasksBySlug.set(t.slug, []);
  const orphanTasks: AutonomousTask[] = [];

  for (const task of tasks) {
    const slugs = slugsForTask(task);
    if (!slugs || slugs.size === 0) {
      orphanTasks.push(task);
      continue;
    }
    for (const slug of slugs) {
      if (tasksBySlug.has(slug)) tasksBySlug.get(slug)!.push(task);
    }
  }

  const teamGroups: OversightTeamGroup[] = teams.map((t) => {
    const ts = tasksBySlug.get(t.slug) ?? [];
    return { slug: t.slug, name: t.name, counts: countsOf(ts), members: peopleOf(ts) };
  });

  return {
    teams: teamGroups,
    no_team: { counts: countsOf(orphanTasks), members: peopleOf(orphanTasks) },
    // `tasks` is the flat admin list — each task once — so this is already the
    // distinct org-wide total without any per-team dedup.
    totals: countsOf(tasks),
  };
}
