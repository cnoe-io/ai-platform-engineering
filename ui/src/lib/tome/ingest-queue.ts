// Background worker that drains queued ingest/synthesize runs at a bounded
// concurrency. Without it, runs enqueued by a BHAG cascade (status "queued")
// would never start. Mirrors the IdP sync scheduler: an in-process timer
// booted from instrumentation.ts, replica-safe via an atomic per-run claim
// (a status:queued -> running updateOne only one writer can win).

import { getTomeIngestRunsCollection } from "./mongo-collections";
import { dispatchQueuedRun, reapStaleRuns } from "./ingest-runner";

// Max runs executing at once across all projects. Keeps N children from
// saturating the single agent container (LLM + provider rate limits).
const CONCURRENCY = Math.max(1, Number(process.env.TOME_INGEST_CONCURRENCY) || 3);
// How often the worker looks for startable runs.
const TICK_MS = Math.max(1000, Number(process.env.TOME_INGEST_QUEUE_TICK_MS) || 5000);
// A "running" run older than this is treated as orphaned (worker restart) and failed.
const STALE_MS = Math.max(60_000, Number(process.env.TOME_INGEST_STALE_MS) || 30 * 60 * 1000);

/**
 * One worker pass: reap stale runs, then start as many startable queued runs as
 * the concurrency budget allows. A run is startable when its project has no run
 * already running (per-project = 1) and, for a cascade parent, all its children
 * are terminal.
 */
export async function tickIngestQueue(): Promise<void> {
  const runs = await getTomeIngestRunsCollection();

  await reapStaleRuns(STALE_MS);

  const runningRuns = await runs.find({ status: "running" }).project({ project_id: 1 }).toArray();
  let budget = CONCURRENCY - runningRuns.length;
  if (budget <= 0) return;

  const runningProjects = new Set(runningRuns.map((r) => r.project_id));

  const queued = await runs.find({ status: "queued" }).sort({ queued_at: 1, started_at: 1 }).limit(100).toArray();

  for (const run of queued) {
    if (budget <= 0) break;
    // Per-project serialization: never two runs for the same project at once.
    if (runningProjects.has(run.project_id)) continue;

    // Cascade parent waits until every child is terminal (succeeded or failed).
    if (run.cascade_role === "parent" && run.cascade_id) {
      const pendingChildren = await runs.countDocuments({
        cascade_id: run.cascade_id,
        cascade_role: "child",
        status: { $in: ["queued", "running"] },
      });
      if (pendingChildren > 0) continue;
    }

    // Atomic claim: only the writer that flips queued -> running proceeds.
    const claim = await runs.updateOne(
      { _id: run._id, status: "queued" },
      { $set: { status: "running", started_at: new Date() } },
    );
    if (claim.modifiedCount !== 1) continue;

    runningProjects.add(run.project_id);
    budget--;
    dispatchQueuedRun(String(run._id));
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the queue worker loop. Idempotent: a second call is a no-op so a
 * hot-reload or double instrumentation invocation can't stack timers.
 */
export function startIngestQueue(): void {
  if (timer) return;
  console.log(
    `[ingest-queue] worker started (tick ${TICK_MS}ms, concurrency ${CONCURRENCY})`,
  );

  let running = false;
  const runTick = async () => {
    if (running) return; // skip if the previous tick is still going
    running = true;
    try {
      await tickIngestQueue();
    } catch (err) {
      console.error("[ingest-queue] tick error:", err);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => void runTick(), TICK_MS);
  timer.unref?.();
}

/** Stop the worker loop (tests / clean shutdown). */
export function stopIngestQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
