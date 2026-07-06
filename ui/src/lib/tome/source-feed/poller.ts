// Source-activity feed poller.
//
// A background loop (modeled on rbac/idp-sync-scheduler) that, per project with
// connected GitHub sources, resolves the project OWNER's forwarded credentials
// (no request session exists here — same off-request trick the ingest queue
// uses via resolveCredentialsForSub), fetches curated activity deltas since the
// last cursor, and emits them into the project's Mycelium room as `event`
// messages (kind `source_event`, with a TTL). The Talk "Feed" view is then a
// server-side `?kind=source_event` filter over the room.
//
// Opt-in: only runs when TOME_SOURCE_FEED_ENABLED=true. Replica-safe (each
// project's poll is claimed atomically per interval). Failures on one project
// never abort the others.

import { getCollection } from "@/lib/mongodb";
import type { ProjectDocument } from "@/types/projects";

import { resolveCredentialsForSub } from "../agent-proxy";
import { isMyceliumConfigured, postEvent } from "../mycelium";
import { claimProjectPoll, getCursor, setCursor } from "./cursor";
import { fetchGithubActivity, provenanceFor } from "./github";
import type { SourceEvent } from "./types";

const TICK_INTERVAL_MS = Number(process.env.TOME_SOURCE_FEED_TICK_MS) || 60 * 1000;
const POLL_INTERVAL_MS =
  (Number(process.env.TOME_SOURCE_FEED_INTERVAL_MINUTES) || 5) * 60 * 1000;
const EVENT_TTL_SECONDS =
  Number(process.env.TOME_SOURCE_FEED_TTL_SECONDS) || 14 * 24 * 60 * 60;
const MAX_EVENTS_PER_REPO = Number(process.env.TOME_SOURCE_FEED_MAX_PER_REPO) || 15;

const SENDER_HANDLE = "github";

function isEnabled(): boolean {
  return process.env.TOME_SOURCE_FEED_ENABLED === "true";
}

/** Resolve an OIDC sub from an email via the `users` map (populated on every
 * authenticated request). Returns "" if unmapped (the principal has never
 * logged in) — the poll then no-ops for that project. */
async function subForEmail(email: string | undefined): Promise<string> {
  const e = email?.trim().toLowerCase();
  if (!e) return "";
  const users = await getCollection<{
    email?: string;
    keycloak_sub?: string;
    metadata?: { keycloak_sub?: string };
  }>("users");
  const user = await users.findOne({ email: e });
  return user?.keycloak_sub || user?.metadata?.keycloak_sub || "";
}

/** Poll one project's GitHub repos and emit new events. Returns the count
 * emitted. Best-effort: a repo that errors is logged and skipped. */
async function pollProject(project: ProjectDocument & { _id: string }): Promise<number> {
  if (project.sources_feed_enabled === false) return 0; // per-project opt-out
  const repos = project.sources?.repos ?? [];
  if (repos.length === 0) return 0;

  // The feed runs as the explicitly-assigned data steward — no implicit
  // fallback. No steward = the feed is inactive until one is assigned (set at
  // onboarding, changeable in Settings). Explicit is easier to reason about
  // than "blank silently means the owner".
  const steward = project.data_steward;
  if (!steward) {
    console.log(`[SourceFeed] ${project.slug}: no data steward assigned; skipping`);
    return 0;
  }
  const sub = await subForEmail(steward);
  if (!sub) {
    console.log(`[SourceFeed] ${project.slug}: steward (${steward}) has no mapped sub; skipping`);
    return 0;
  }
  const creds = await resolveCredentialsForSub(sub);
  const token = creds["github"]?.access_token;
  if (!token) {
    console.log(`[SourceFeed] ${project.slug}: steward (${steward}) has no GitHub token; skipping`);
    return 0;
  }

  let emitted = 0;
  let newestTs: string | null = null;
  for (const repo of repos) {
    let events: SourceEvent[];
    try {
      const sinceIso = await getCursor(project._id, "github", repo);
      events = await fetchGithubActivity({
        repo,
        token,
        sinceIso,
        max: MAX_EVENTS_PER_REPO,
      });
    } catch (err) {
      console.warn(
        `[SourceFeed] ${project.slug}: fetch ${repo} failed: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      continue;
    }
    if (events.length === 0) continue;

    // Emit oldest-first so the newest event lands as the most recent message.
    const ordered = [...events].reverse();
    let repoNewest: string | null = null;
    for (const ev of ordered) {
      try {
        await postEvent(project.slug, {
          sender_handle: SENDER_HANDLE,
          content: ev.title,
          kind: "source_event",
          ttl_seconds: EVENT_TTL_SECONDS,
          payload: {
            source: ev.source,
            artifact: ev.artifact,
            event: ev.event,
            repo: ev.repo,
            ref: ev.ref,
            url: ev.url,
            actor: ev.actor,
            ts: ev.ts,
          },
          provenance: provenanceFor(ev),
        });
        emitted += 1;
        repoNewest = ev.ts; // ordered oldest→newest, so last wins
      } catch (err) {
        console.warn(
          `[SourceFeed] ${project.slug}: post event failed for ${ev.ref}: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
    if (repoNewest) {
      await setCursor(project._id, "github", repo, repoNewest);
      if (!newestTs || new Date(repoNewest) > new Date(newestTs)) newestTs = repoNewest;
    }
  }

  // Freshness signal (#40): stamp the newest activity time on the project.
  if (newestTs) {
    const projects = await getCollection<ProjectDocument>("projects");
    await projects.updateOne(
      { slug: project.slug },
      { $set: { last_source_event_at: new Date(newestTs) } },
    );
  }
  return emitted;
}

/** One scheduler pass: poll every project with GitHub sources that's due. */
export async function tickSourceFeed(now: Date): Promise<void> {
  if (!isMyceliumConfigured()) return; // nowhere to emit events

  let projects: (ProjectDocument & { _id: string })[];
  try {
    const col = await getCollection<ProjectDocument>("projects");
    const docs = await col
      .find({
        "sources.repos.0": { $exists: true },
        type: { $ne: "bhag" },
        sources_feed_enabled: { $ne: false }, // honor per-project opt-out
      })
      .toArray();
    projects = docs.map((p) => ({ ...p, _id: String(p._id) }));
  } catch (err) {
    console.error(
      "[SourceFeed] failed to load projects: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  for (const project of projects) {
    try {
      if (!(await claimProjectPoll(project._id, now, POLL_INTERVAL_MS))) continue;
      const n = await pollProject(project);
      if (n > 0) console.log(`[SourceFeed] ${project.slug}: emitted ${n} event(s)`);
    } catch (err) {
      console.error(
        `[SourceFeed] error polling ${project.slug}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the source-feed poller. Idempotent; no-op unless opt-in via
 * TOME_SOURCE_FEED_ENABLED. */
export function startSourceFeedPoller(): void {
  if (timer) return;
  if (!isEnabled()) {
    console.log("[SourceFeed] disabled (set TOME_SOURCE_FEED_ENABLED=true to enable)");
    return;
  }
  console.log(
    `[SourceFeed] poller started (tick ${TICK_INTERVAL_MS}ms, poll every ${POLL_INTERVAL_MS / 60000}min)`,
  );

  let running = false;
  const runTick = async () => {
    if (running) return;
    running = true;
    try {
      await tickSourceFeed(new Date());
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the poller (tests / clean shutdown). */
export function stopSourceFeedPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
