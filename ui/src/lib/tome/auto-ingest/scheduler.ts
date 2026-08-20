// CRON-scheduled auto-ingest (GH #437). Modeled on rbac/idp-sync-scheduler: a
// once-a-minute tick that checks each opted-in project's cron schedule and
// fires an ingest run through the same path as the manual "Run ingest"
// button, using the project's explicitly-configured fallback credential
// owner (never the steward implicitly — a steward can be a team, which has
// no single OAuth grant to execute as; see AutoIngestConfig).
//
// Failures never fail silently: every fire attempt (skipped or actually
// failed) writes a `lastRun` status on the project, so Settings/the ingest
// pane can surface it, instead of only a server log line.

import { getCollection } from "@/lib/mongodb";
import type { AutoIngestConfig, ProjectDocument } from "@/types/projects";

import { cronMatches } from "../../rbac/cron";
import { resolveCredentialsForSub } from "../agent-proxy";
import { auditTome } from "../audit";
import { isIngestRunning, startIngestRun } from "../ingest-runner";
import {
  AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS,
  refreshAutoIngestCredentialHealth,
} from "./credential-health";
import { claimAutoIngestCredentialRefresh, claimAutoIngestFire } from "./cursor";

const TICK_INTERVAL_MS = Number(process.env.TOME_AUTO_INGEST_TICK_MS) || 60 * 1000;

function isEnabled(): boolean {
  return process.env.TOME_AUTO_INGEST_ENABLED === "true";
}

/** UTC minute key, e.g. "2026-08-13T02:00", used to dedupe fires per minute. */
function utcMinuteKey(now: Date): string {
  return now.toISOString().slice(0, 16);
}

function credentialRefreshWindowKey(now: Date): string {
  return String(Math.floor(now.getTime() / AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS));
}

async function recordLastRun(
  projectId: string,
  lastRun: NonNullable<AutoIngestConfig["lastRun"]>,
): Promise<void> {
  const projects = await getCollection<ProjectDocument>("projects");
  await projects.updateOne({ _id: projectId }, { $set: { "autoIngest.lastRun": lastRun } });
}

/**
 * Evaluate and (if due) fire one project's auto-ingest schedule. Never
 * throws — every failure mode is caught, logged, and recorded on
 * `autoIngest.lastRun` so it's visible in the UI rather than only a log line.
 */
async function maybeFireForProject(
  project: ProjectDocument & { _id: string },
  now: Date,
): Promise<void> {
  const config = project.autoIngest;
  if (!config?.enabled) return;
  if (!cronMatches(config.cron, now)) return;

  const owner = config.credentialOwner;
  if (!owner) {
    console.log(
      `[AutoIngest] ${project.slug}: no confirmed credential owner; skipping this fire`,
    );
    await recordLastRun(project._id, {
      at: now.toISOString(),
      status: "skipped_no_credential",
      reason: "No fallback credential owner is configured for this schedule.",
    });
    return;
  }

  if (!(await claimAutoIngestFire(project._id, utcMinuteKey(now)))) return; // another replica claimed it

  if (await isIngestRunning(project._id)) {
    console.log(`[AutoIngest] ${project.slug}: due but a run is already in progress; skipping`);
    await recordLastRun(project._id, {
      at: now.toISOString(),
      status: "skipped_no_credential",
      reason: "A run was already in progress at the scheduled time.",
    });
    return;
  }

  const credentials = await resolveCredentialsForSub(owner.subject);
  const hasAnyCredential = Object.keys(credentials).length > 0;
  if (!hasAnyCredential) {
    console.log(
      `[AutoIngest] ${project.slug}: credential owner (${owner.email}) has no connected credentials; skipping`,
    );
    await recordLastRun(project._id, {
      at: now.toISOString(),
      status: "failed",
      reason: `${owner.name || owner.email} has no connected credentials — reconfirm the fallback owner in Settings.`,
    });
    return;
  }

  try {
    const { runId } = await startIngestRun(
      {
        project,
        projectId: project._id,
        user: { email: owner.email },
        session: { sub: owner.subject },
        canRead: true,
        canEdit: true,
        canManageSteward: false,
      },
      { triggeredBy: "auto" },
    );
    console.log(`[AutoIngest] ${project.slug}: fired run ${runId} (${utcMinuteKey(now)} UTC)`);
    await recordLastRun(project._id, { at: now.toISOString(), status: "success", runId });
    auditTome({
      action: "tome.auto_ingest.fired",
      actor: { type: "service", id: owner.subject, email: owner.email },
      projectSlug: project.slug,
      metadata: { runId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AutoIngest] ${project.slug}: fire failed: ${msg}`);
    await recordLastRun(project._id, { at: now.toISOString(), status: "failed", reason: msg });
  }
}

/** One scheduler pass: evaluate every project with auto-ingest enabled. */
export async function tickAutoIngestScheduler(now: Date): Promise<void> {
  let projects: (ProjectDocument & { _id: string })[];
  try {
    const col = await getCollection<ProjectDocument>("projects");
    const docs = await col.find({ "autoIngest.enabled": true }).toArray();
    projects = docs.map((p) => ({ ...p, _id: String(p._id) }));
  } catch (err) {
    console.error(
      "[AutoIngest] scheduler: failed to load projects: " +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  try {
    if (await claimAutoIngestCredentialRefresh(credentialRefreshWindowKey(now))) {
      await refreshAutoIngestCredentialHealth(now, projects);
    }
  } catch (err) {
    console.error(
      "[AutoIngest] credential refresh failed: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  for (const project of projects) {
    try {
      await maybeFireForProject(project, now);
    } catch (err) {
      console.error(
        `[AutoIngest] scheduler: error evaluating ${project.slug}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the once-a-minute auto-ingest scheduler. Idempotent; no-op unless
 * opted in via TOME_AUTO_INGEST_ENABLED. */
export function startAutoIngestScheduler(): void {
  if (timer) return;
  if (!isEnabled()) {
    console.log("[AutoIngest] disabled (set TOME_AUTO_INGEST_ENABLED=true to enable)");
    return;
  }
  console.log(
    `[AutoIngest] scheduler started (tick every ${TICK_INTERVAL_MS}ms; credential refresh every ${AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS}ms)`,
  );

  let running = false;
  const runTick = async () => {
    if (running) return;
    running = true;
    try {
      await tickAutoIngestScheduler(new Date());
    } finally {
      running = false;
    }
  };
  void runTick();
  timer = setInterval(() => void runTick(), TICK_INTERVAL_MS);
  timer.unref?.();
}

/** Stop the scheduler (tests / clean shutdown). */
export function stopAutoIngestScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
