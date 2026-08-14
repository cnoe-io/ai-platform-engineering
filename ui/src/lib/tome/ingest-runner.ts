/**
 * Ingest run lifecycle (CAIPE half of TTT's `pipeline/runner.py`).
 *
 * Pre-creates a Report (version = prior+1; greenfield = no prior), creates an
 * IngestRun, deterministically seeds the stable pages on greenfield, then
 * streams the agent's `/ingest` SSE in the background — appending each event
 * as a marked log line to the run — and finalizes (summary, status). The
 * agent persists pages via the internal `/pages` callback, tagged with the
 * report id. The browser polls the run for the live log.
 *
 * Server-only. Runs the stream as a detached task (caipe-ui is a long-lived
 * Node process), tracked in a module Set so it isn't GC'd.
 */

import { randomUUID } from "crypto";

import { ObjectId } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import { getPageStore } from "./page-store";
import { getTomeIngestRunsCollection, getTomeReportsCollection } from "./mongo-collections";
import {
  buildIngestRequest,
  resolveCredentialsForSub,
  sessionSub,
} from "./agent-proxy";
import { reconcileGitHubSourcesForIngest } from "./github-source-reconciliation";
import {
  dispatchLine,
  formatIngestEvent,
  infoLine,
  type IngestEvent,
} from "./ingest-format";
import { parseFrontmatter } from "./schema";
import { getStableSeedTemplates } from "./page-templates-store";
import { injectCharterIntro, missingPageTemplates } from "./seed";
import { auditTome } from "./audit";
import { isMyceliumConfigured, postEvent } from "./mycelium";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";
import type { IngestDispatch, IngestRun, Report } from "@/types/tome";
import {
  isTomeAdminSubject,
  listReadableTomeProjects,
} from "./access";

/** Load a project by its stable id (string or ObjectId), normalizing `_id` to string. */
async function loadProjectById(
  projectId: string,
): Promise<(ProjectDocument & { _id: string }) | null> {
  const projects = await getCollection<ProjectDocument>("projects");
  const _id = (ObjectId.isValid(projectId)
    ? new ObjectId(projectId)
    : projectId) as unknown as string;
  const p = await projects.findOne({ _id });
  if (!p) return null;
  return { ...p, _id: String(p._id) } as ProjectDocument & { _id: string };
}

import { resolveBhagChildren, resolveAreaChildren } from "./bhag";
export { resolveBhagChildren, resolveAreaChildren };

const inflight = new Set<Promise<void>>();

// One AbortController per in-flight run, keyed by runId — lets `cancelRun`
// actually tear down the agent's SSE stream instead of just flipping the DB
// status while the background fetch (and the agent's real work) keeps going.
const runAbortControllers = new Map<string, AbortController>();

/**
 * Abort the in-flight agent stream for a run, if one is running in this
 * process. No-op if the run isn't tracked here (e.g. already finished, or
 * running in a different caipe-ui replica) — the DB status flip in the
 * DELETE route is still the source of truth for "is this run active."
 */
export function cancelRun(runId: string): void {
  runAbortControllers.get(runId)?.abort();
}

/**
 * Flip a project's `locked` flag. Locked while an ingest is in flight so human
 * page edits (UI editor / PUT) are refused with 409 and can't race the agent's
 * rewrite. Best-effort — a failed flag flip must not fail/hang the ingest.
 */
async function setProjectLocked(projectId: string, locked: boolean): Promise<void> {
  try {
    const projects = await getCollection<ProjectDocument>("projects");
    const _id = (ObjectId.isValid(projectId)
      ? new ObjectId(projectId)
      : projectId) as unknown as string;
    await projects.updateOne({ _id }, { $set: { locked, updated_at: new Date() } });
  } catch (e) {
    console.warn(`setProjectLocked(${projectId}, ${locked}) failed`, e);
  }
}

/**
 * True if an ingest is currently running OR a prior run's draft is still
 * awaiting review for this project — either way, a new run can't start
 * (the wiki is locked and there's no defined merge of two pending drafts).
 */
export async function isIngestRunning(projectId: string): Promise<boolean> {
  const runs = await getTomeIngestRunsCollection();
  const active = await runs.findOne({
    project_id: projectId,
    status: { $in: ["queued", "running", "awaiting_review"] },
  });
  return Boolean(active);
}

/**
 * Create the Report + IngestRun rows for a run. Shared by the immediate path
 * (status "running") and the queue (status "queued"). Returns ids + whether
 * this is the project's greenfield (first) run.
 */
async function createRunRecord(
  project: ProjectDocument & { _id: string },
  opts: {
    status: "running" | "queued";
    sub: string;
    dispatch: IngestDispatch;
    cascadeId?: string;
    cascadeRole?: "child" | "parent";
    blockedByCascadeIds?: string[];
    triggeredBy?: "manual" | "auto";
  },
): Promise<{ runId: string; reportId: string; isGreenfield: boolean }> {
  const projectId = project._id;
  const reports = await getTomeReportsCollection();
  const runs = await getTomeIngestRunsCollection();

  const prior = await reports
    .find({ project_id: projectId })
    .sort({ version: -1 })
    .limit(1)
    .next();
  const isGreenfield = !prior;
  const version = prior ? prior.version + 1 : 1;

  const now = new Date();
  const reportId = randomUUID();
  const report: Report & { greenfield: boolean } = {
    _id: reportId,
    project_id: projectId,
    version,
    summary: "",
    greenfield: isGreenfield,
    created_at: now,
  };
  await reports.insertOne(report);

  const runId = randomUUID();
  const run: IngestRun = {
    _id: runId,
    project_id: projectId,
    report_id: reportId,
    status: opts.status,
    greenfield: isGreenfield,
    log: [],
    started_at: now,
    triggered_by_sub: opts.sub || undefined,
    triggered_by: opts.triggeredBy ?? "manual",
    dispatch: opts.dispatch,
    cascade_id: opts.cascadeId,
    cascade_role: opts.cascadeRole,
    blocked_by_cascade_ids: opts.blockedByCascadeIds,
    queued_at: opts.status === "queued" ? now : undefined,
  };
  await runs.insertOne(run);

  return { runId, reportId, isGreenfield };
}

/**
 * Seed the stable pages from their founding templates on a greenfield run, so
 * the pages exist (with their `## section` scaffold) for humans to fill in.
 * charter ← project.description. Whether the AGENT then drafts content over
 * these is the separate, opt-in `seedStablePages` flag passed to the agent.
 */
async function seedGreenfieldStablePages(
  project: ProjectDocument & { _id: string },
  reportId: string,
  runId: string,
): Promise<void> {
  const templates: Record<string, string> = await getStableSeedTemplates();
  const store = await getPageStore();
  const existing = await store.listPages(project._id);
  // A wiki can be seeded or edited before its first ingest report exists. A
  // report-based "greenfield" signal must never overwrite those live pages.
  const seeds = missingPageTemplates(templates, existing);
  const desc = (project.description ?? "").trim();
  if (desc && seeds["charter.md"]) {
    seeds["charter.md"] = injectCharterIntro(seeds["charter.md"], desc);
  }
  if (Object.keys(seeds).length === 0) {
    await appendLog(
      runId,
      infoLine("preserved existing stable pages; no founding templates were written"),
    );
    return;
  }
  await store.writePages(project._id, seeds, {
    message: "seed stable pages (founding templates)",
    author: "tome-ingest",
    reportId,
  });
  await appendLog(
    runId,
    infoLine(
      `seeded ${Object.keys(seeds).length} stable page(s): ${Object.keys(seeds).sort().join(", ")}`,
    ),
  );
}

/**
 * Prepare a created run for dispatch: seed greenfield pages, log the dispatch
 * line, re-resolve the triggering user's credentials, resolve BHAG children,
 * and build the agent request. Runs for both the immediate and the queued path
 * (it reads everything it needs off the run row + project, so the session can
 * be long gone). Throws if the run or project can't be loaded.
 */
async function prepareRun(
  runId: string,
): Promise<{ projectId: string; reportId: string; req: unknown; endpoint: string }> {
  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId });
  if (!run) throw new Error(`run ${runId} not found`);
  const projectId = run.project_id;
  const reportId = run.report_id ?? randomUUID();
  let project = await loadProjectById(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const dispatch: IngestDispatch = run.dispatch ?? { endpoint: "/ingest" };
  const isGreenfield = run.greenfield;

  if (isGreenfield) {
    await seedGreenfieldStablePages(project, reportId, runId);
  }
  await appendLog(runId, dispatchLine(isGreenfield, run.triggered_by));

  // The original request session is gone by now; re-resolve from the stored sub.
  const credentials = await resolveCredentialsForSub(run.triggered_by_sub ?? "");
  const githubReconciliation = await reconcileGitHubSourcesForIngest(
    project,
    credentials,
  );
  project = githubReconciliation.project;
  for (const rename of githubReconciliation.canonicalized) {
    await appendLog(
      runId,
      infoLine(`GitHub source renamed: ${rename.from} → ${rename.to}`),
    );
  }
  if (githubReconciliation.tombstonedPaths.length > 0) {
    await appendLog(
      runId,
      infoLine(
        `tombstoned ${githubReconciliation.tombstonedPaths.length} obsolete GitHub source page(s); revision history preserved`,
      ),
    );
  }

  const meetings = dispatch.webexMeetings ?? [];
  const connectorData: Record<string, unknown> =
    meetings.length > 0 ? { webex: { meetings } } : {};

  // BHAGs and Areas carry their child projects so the agent can read their wikis:
  // synthesis builds from them, compaction uses them as ground truth.
  const endpoint = dispatch.endpoint || "/ingest";
  const isBhag = project.type === "bhag";
  const isArea = project.type === "area";
  const childProjects = isBhag
    ? await resolveBhagChildren(project.name)
    : isArea
      ? await resolveAreaChildren(project.name)
      : [];
  const actorSub = run.triggered_by_sub ?? "";
  const actorIsAdmin = actorSub ? await isTomeAdminSubject(actorSub) : false;
  const readableProjects = await listReadableTomeProjects(actorSub || null, {
    isAdmin: actorIsAdmin,
  });
  const readableSlugs = new Set(readableProjects.map((candidate) => candidate.slug));
  const blockedChildren = childProjects.filter(
    (child) => !readableSlugs.has(child.slug),
  );
  if (blockedChildren.length > 0) {
    throw new Error(
      `OpenFGA denied synthesis source access to: ${blockedChildren
        .map((child) => child.slug)
        .join(", ")}`,
    );
  }
  if (isBhag || isArea) {
    const kind = isBhag ? "BHAG" : "Area";
    const verb = endpoint === "/synthesize" ? "synthesis" : "compaction";
    await appendLog(
      runId,
      infoLine(
        childProjects.length
          ? `${kind} ${verb} with ${childProjects.length} child project(s): ${childProjects.map((c) => c.slug).join(", ")}`
          : `${kind} ${verb}: no projects are tagged to this ${isBhag ? "goal" : "area"} yet`,
      ),
    );
  }

  const req = buildIngestRequest(project, {
    runId,
    reportId,
    seed: dispatch.seed?.trim() || null,
    isGreenfield,
    mode: dispatch.mode,
    connectorData,
    credentials,
    seedStablePages: isGreenfield && dispatch.seedStablePages === true,
    childProjects,
    readableProjects: readableProjects.map((candidate) => ({
      project_id: String(candidate._id),
      slug: candidate.slug,
      name: candidate.title || candidate.name,
    })),
    triggeredBy: run.triggered_by,
  });

  return { projectId, reportId, req, endpoint };
}

/** Mark a run failed (used when prep fails before the stream starts). */
async function failRun(runId: string, e: unknown): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  const msg = String((e as Error)?.message ?? e);
  await appendLog(runId, `[--:--:--] ✗ ${msg}`);
  await runs.updateOne(
    { _id: runId },
    { $set: { status: "failed", error: msg, finished_at: new Date() } },
  );
  await auditRunLifecycle(runId, "tome.ingest.failed", { error: msg, phase: "prepare" });
  const run = await runs.findOne({ _id: runId });
  if (run) await setProjectLocked(run.project_id, false);
}

/**
 * Kick an ingest run immediately. Returns the new run id; the agent stream is
 * driven in the background. Throws if a run is already in progress.
 */
export async function startIngestRun(
  ctx: TomeProjectContext,
  opts: {
    seed?: string | null;
    mode?: "full" | "quick";
    webexMeetings?: { id: string; title: string; start: string }[];
    seedStablePages?: boolean;
    agentEndpoint?: string;
    /** Bypass draft review: pages this run writes go straight to "live". */
    skipReview?: boolean;
    /** "auto" = fired by the CRON scheduler, not a human clicking "Run ingest". */
    triggeredBy?: "manual" | "auto";
  },
): Promise<{ runId: string }> {
  const projectId = ctx.projectId;
  if (await isIngestRunning(projectId)) {
    throw new IngestInProgressError();
  }

  const { runId } = await createRunRecord(ctx.project, {
    status: "running",
    sub: sessionSub(ctx.session),
    triggeredBy: opts.triggeredBy,
    dispatch: {
      endpoint: opts.agentEndpoint ?? "/ingest",
      seed: opts.seed ?? null,
      mode: opts.mode,
      seedStablePages: opts.seedStablePages,
      webexMeetings: opts.webexMeetings,
      skipReview: opts.skipReview,
      triggeredBy: opts.triggeredBy,
    },
  });

  // Prepare synchronously (seed greenfield pages before returning, as before),
  // then drive the agent stream in the background.
  let prep: Awaited<ReturnType<typeof prepareRun>>;
  try {
    prep = await prepareRun(runId);
  } catch (e) {
    await failRun(runId, e);
    throw e;
  }
  const task = driveIngest(prep.projectId, runId, prep.reportId, prep.req, prep.endpoint).finally(
    () => inflight.delete(task),
  );
  inflight.add(task);

  return { runId };
}

/** Enqueue a run for the worker to start later (status "queued"). */
export async function enqueueRun(
  project: ProjectDocument & { _id: string },
  opts: {
    sub: string;
    dispatch: IngestDispatch;
    cascadeId?: string;
    cascadeRole?: "child" | "parent";
    blockedByCascadeIds?: string[];
  },
): Promise<string> {
  const { runId } = await createRunRecord(project, { status: "queued", ...opts });
  return runId;
}

/**
 * Enqueue a BHAG cascade: a queued re-ingest for each skip-level child
 * project, a nested sub-cascade for each child Area (its own leaf projects
 * ingest, then the Area itself synthesizes), and finally the BHAG's own
 * synthesize — which waits for BOTH its direct (skip-level) children AND
 * every Area's entire sub-cascade to fully drain, not just the Area's own
 * run. Without recursing into Areas, a project that only tags an Area (never
 * the BHAG directly) would never get ingested before the BHAG "synthesizes"
 * an empty rollup.
 */
export async function enqueueBhagCascade(
  ctx: TomeProjectContext,
  opts: {
    seed?: string | null;
    seedStablePages?: boolean;
    webexMeetings?: { id: string; title: string; start: string }[];
  },
): Promise<{ cascadeId: string; parentRunId: string; childCount: number }> {
  const sub = sessionSub(ctx.session);
  const cascadeId = randomUUID();
  const children = await resolveBhagChildren(ctx.project.name);
  const areaSubCascadeIds: string[] = [];

  for (const child of children) {
    const childProject = await loadProjectById(child.project_id);
    if (!childProject) continue;

    if (child.type === "area") {
      // Recurse: this Area's own leaf projects ingest under a fresh
      // sub-cascade, then the Area synthesizes once they're all terminal.
      const areaCascadeId = randomUUID();
      areaSubCascadeIds.push(areaCascadeId);
      const areaChildren = await resolveAreaChildren(childProject.name);
      for (const leaf of areaChildren) {
        const leafProject = await loadProjectById(leaf.project_id);
        if (!leafProject) continue;
        await enqueueRun(leafProject, {
          sub,
          dispatch: { endpoint: "/ingest", seed: null },
          cascadeId: areaCascadeId,
          cascadeRole: "child",
        });
      }
      await enqueueRun(childProject, {
        sub,
        dispatch: { endpoint: "/synthesize", seed: null },
        cascadeId: areaCascadeId,
        cascadeRole: "parent",
      });
    } else {
      await enqueueRun(childProject, {
        sub,
        dispatch: { endpoint: "/ingest", seed: null },
        cascadeId,
        cascadeRole: "child",
      });
    }
  }

  const parentRunId = await enqueueRun(ctx.project, {
    sub,
    dispatch: {
      endpoint: "/synthesize",
      seed: opts.seed ?? null,
      seedStablePages: opts.seedStablePages,
      webexMeetings: opts.webexMeetings,
    },
    cascadeId,
    cascadeRole: "parent",
    blockedByCascadeIds: areaSubCascadeIds.length ? areaSubCascadeIds : undefined,
  });

  return { cascadeId, parentRunId, childCount: children.length };
}

/**
 * Start a previously-queued run (called by the queue worker after it has
 * atomically flipped the run to "running"). Drives in the background.
 */
export function dispatchQueuedRun(runId: string): void {
  const task = (async () => {
    let prep: Awaited<ReturnType<typeof prepareRun>>;
    try {
      prep = await prepareRun(runId);
    } catch (e) {
      await failRun(runId, e);
      return;
    }
    await driveIngest(prep.projectId, runId, prep.reportId, prep.req, prep.endpoint);
  })().finally(() => inflight.delete(task));
  inflight.add(task);
}

/**
 * Fail runs stuck in "running" past `maxAgeMs` (a worker restart orphaned the
 * in-process stream). Clears each project's lock so the wiki isn't left
 * read-only. Returns the number reaped.
 */
export async function reapStaleRuns(maxAgeMs: number): Promise<number> {
  const runs = await getTomeIngestRunsCollection();
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await runs.find({ status: "running", started_at: { $lt: cutoff } }).toArray();
  for (const r of stale) {
    await runs.updateOne(
      { _id: r._id },
      { $set: { status: "failed", error: "stale (worker restart or timeout)", finished_at: new Date() } },
    );
    await auditRunLifecycle(r._id, "tome.ingest.failed", { error: "stale", phase: "reap" });
    await setProjectLocked(r.project_id, false);
  }
  return stale.length;
}

async function appendLog(runId: string, line: string): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  await runs.updateOne({ _id: runId }, { $push: { log: line } });
}

/**
 * Emit a run-lifecycle audit event (`started`/`finished`/`failed`). The run
 * carries the triggering `sub`; the project gives the slug for the resource
 * ref. Never throws — auditing must not affect the run. The `endpoint` in
 * metadata distinguishes ingest vs synthesize vs compact (they share this
 * lifecycle). Also mirrors the transition into the project's Feed as an
 * `ingest_event`, same mechanism the source-activity feed uses, so ingest
 * state shows up alongside GitHub/Confluence/Webex activity. */
async function auditRunLifecycle(
  runId: string,
  action:
    | "tome.ingest.started"
    | "tome.ingest.finished"
    | "tome.ingest.failed"
    | "tome.ingest.awaiting_review",
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const runs = await getTomeIngestRunsCollection();
    const run = await runs.findOne({ _id: runId });
    if (!run) return;
    const project = await loadProjectById(run.project_id);
    const sub = run.triggered_by_sub;
    auditTome({
      action,
      actor: sub ? { type: "user", id: sub } : { type: "service", id: "tome-system" },
      projectSlug: project?.slug ?? run.project_id,
      outcome: action === "tome.ingest.failed" ? "error" : "success",
      metadata: {
        run_id: runId,
        report_id: run.report_id ?? undefined,
        endpoint: run.dispatch?.endpoint ?? "/ingest",
        greenfield: run.greenfield,
        triggered_by: run.triggered_by ?? "manual",
        cascade_id: run.cascade_id ?? undefined,
        cascade_role: run.cascade_role ?? undefined,
        ...extra,
      },
    });

    if (project?.slug && isMyceliumConfigured()) {
      const mode = run.dispatch?.endpoint === "/synthesize" ? "bhag_rollup" : "ingest";
      const label =
        mode === "bhag_rollup"
          ? "Synthesize"
          : run.triggered_by === "auto"
            ? "Scheduled auto-ingest"
            : "Ingest";
      const status =
        action === "tome.ingest.started"
          ? "running"
          : action === "tome.ingest.awaiting_review"
            ? "awaiting_review"
            : action === "tome.ingest.finished"
              ? "succeeded"
              : "failed";
      const reviewOutcome = extra?.review_outcome as string | undefined;
      const content =
        status === "running"
          ? `${label} started`
          : status === "awaiting_review"
            ? `${label} completed — awaiting review`
            : status === "succeeded"
              ? reviewOutcome === "approved"
                ? `${label} draft approved`
                : reviewOutcome === "auto_promoted"
                  ? `${label} draft auto-promoted (no reviewer in time)`
                  : `${label} completed`
              : reviewOutcome === "rejected"
                ? `${label} draft rejected`
                : `${label} failed: ${String(extra?.error ?? "unknown error")}`;
      await postEvent(project.slug, {
        sender_handle: "tome",
        content,
        kind: "ingest_event",
        payload: { run_id: runId, mode, status, triggered_by: run.triggered_by ?? "manual" },
        // Same id across started/succeeded/failed so the Feed collapses them
        // into one row instead of three, showing the latest status.
        correlation_id: runId,
        ttl_seconds: 60 * 60 * 24 * 7, // a week — ephemeral like source events
      });
    }
  } catch (e) {
    console.warn(`auditRunLifecycle(${runId}, ${action}) failed`, e);
  }
}

/** Store the latest cumulative token usage so the run header can show it live. */
async function setRunUsage(
  runId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const usage = {
    output: Number(data.output ?? 0),
    input: Number(data.input ?? 0),
  };
  const runs = await getTomeIngestRunsCollection();
  await runs.updateOne({ _id: runId }, { $set: { usage } });
}

/** Store the latest exact context-window occupancy so the run header can show
 * it live. Skips the write if the agent's snapshot was missing a percentage
 * (a get_context_usage() hiccup) rather than persisting a bogus 0%. */
async function setRunContextUsage(
  runId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (typeof data.percentage !== "number") return;
  const context_usage = {
    percentage: data.percentage,
    total_tokens: Number(data.total_tokens ?? 0),
    max_tokens: Number(data.max_tokens ?? 0),
    model: String(data.model ?? ""),
  };
  const runs = await getTomeIngestRunsCollection();
  await runs.updateOne({ _id: runId }, { $set: { context_usage } });
}

/** Persist the agent's terminal accounting rather than leaving it only in an
 * unstructured log line. Missing cost is intentionally left absent: old runs
 * and some model providers cannot supply a reliable value. */
async function setRunCompletionAccounting(
  runId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (typeof data.cost_usd === "number" && Number.isFinite(data.cost_usd) && data.cost_usd >= 0) {
    update.cost_usd = data.cost_usd;
  }
  if (typeof data.turns === "number" && Number.isFinite(data.turns) && data.turns >= 0) {
    update.turns = data.turns;
  }
  if (typeof data.model === "string" && data.model.trim()) {
    update.model = data.model.trim();
  }
  if (
    data.model_provenance &&
    typeof data.model_provenance === "object" &&
    typeof (data.model_provenance as Record<string, unknown>).model === "string" &&
    typeof (data.model_provenance as Record<string, unknown>).source === "string"
  ) {
    update.model_provenance = data.model_provenance;
  }
  if (Object.keys(update).length === 0) return;
  const runs = await getTomeIngestRunsCollection();
  await runs.updateOne({ _id: runId }, { $set: update });
}

async function driveIngest(
  projectId: string,
  runId: string,
  reportId: string,
  req: unknown,
  agentEndpoint: string = "/ingest",
): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  const reports = await getTomeReportsCollection();
  const agentUrl = process.env.TOME_AGENT_URL;
  const abortController = new AbortController();
  runAbortControllers.set(runId, abortController);
  let cancelled = false;
  try {
    // Lock the project for the run's duration — humans can't edit pages (409)
    // while the agent rewrites. Cleared in the finally below.
    await setProjectLocked(projectId, true);
    await auditRunLifecycle(runId, "tome.ingest.started");
    if (!agentUrl) throw new Error("TOME_AGENT_URL not configured");
    const path = agentEndpoint.startsWith("/") ? agentEndpoint : `/${agentEndpoint}`;
    const res = await fetch(`${agentUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: abortController.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`agent /ingest failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    for await (const ev of parseSse(res.body)) {
      // Usage snapshots update the run header in place (see IngestRunView),
      // not the log — a per-turn token line floods the tail.
      if (ev.type === "usage") {
        await setRunUsage(runId, ev.data);
      } else if (ev.type === "context_usage") {
        await setRunContextUsage(runId, ev.data);
      } else if (ev.type === "done") {
        await setRunCompletionAccounting(runId, ev.data);
        await appendLog(runId, formatIngestEvent(ev));
      } else {
        await appendLog(runId, formatIngestEvent(ev));
      }
    }

    // Finalize: summary from overview.md's first content line. Read with
    // includeDrafts so a draft-review run's own overview.md still produces a
    // summary before anything is promoted.
    const store = await getPageStore();
    const run = await runs.findOne({ _id: runId });
    const skipReview = run?.dispatch?.skipReview === true;
    const pages = await store.listPages(projectId, { includeDrafts: true });
    const summary = summaryFromOverview(pages);
    await reports.updateOne({ _id: reportId }, { $set: { summary } });

    if (skipReview) {
      await runs.updateOne(
        { _id: runId },
        { $set: { status: "succeeded", finished_at: new Date() } },
      );
      await auditRunLifecycle(runId, "tome.ingest.finished");
    } else {
      const reviewDeadline = new Date(Date.now() + reviewTimeoutMs());
      await runs.updateOne(
        { _id: runId },
        { $set: { status: "awaiting_review", review_deadline: reviewDeadline } },
      );
      await auditRunLifecycle(runId, "tome.ingest.awaiting_review");
    }
  } catch (e) {
    cancelled = abortController.signal.aborted;
    // A user-initiated cancel already set status=failed + error="Stopped by
    // user" in the DELETE route — don't clobber that with the generic
    // AbortError message this fetch throws once the signal fires.
    if (!cancelled) {
      await appendLog(runId, `[--:--:--] ✗ ${String((e as Error)?.message ?? e)}`);
      await runs.updateOne(
        { _id: runId },
        {
          $set: {
            status: "failed",
            error: String((e as Error)?.message ?? e),
            finished_at: new Date(),
          },
        },
      );
      await auditRunLifecycle(runId, "tome.ingest.failed", {
        error: String((e as Error)?.message ?? e),
      });
    } else {
      await appendLog(runId, "[--:--:--] ✗ Stopped by user");
    }
  } finally {
    runAbortControllers.delete(runId);
    // Unlock on success/failure/crash — but keep the wiki read-only while a
    // draft run awaits review; approve/reject/auto-promote clears it.
    const finalRun = await runs.findOne({ _id: runId });
    if (finalRun?.status !== "awaiting_review") {
      await setProjectLocked(projectId, false);
    }
  }
}

/** Milliseconds a draft run waits for review before auto-promoting. Default 24h. */
function reviewTimeoutMs(): number {
  const raw = process.env.TOME_DRAFT_REVIEW_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24 * 60 * 60 * 1000;
}

/**
 * Approve a draft run: promote its pages to "live", flip the run to
 * "succeeded", unlock the project, audit + Feed the outcome. Throws if the
 * run isn't awaiting review.
 */
export async function approveDraftRun(runId: string, reviewedBy: string): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "awaiting_review") {
    throw new Error(`run ${runId} is not awaiting review (status: ${run.status})`);
  }
  const store = await getPageStore();
  if (run.report_id) await store.promoteDraftReport(run.project_id, run.report_id);
  await runs.updateOne(
    { _id: runId },
    {
      $set: {
        status: "succeeded",
        review_outcome: "approved",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        finished_at: new Date(),
      },
    },
  );
  await setProjectLocked(run.project_id, false);
  await auditRunLifecycle(runId, "tome.ingest.finished", { review_outcome: "approved" });
}

/**
 * Reject a draft run: tombstone its draft pages (prior live content, if any,
 * stays current), flip the run to "failed", unlock, audit + Feed. Throws if
 * the run isn't awaiting review.
 */
export async function rejectDraftRun(runId: string, reviewedBy: string): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status !== "awaiting_review") {
    throw new Error(`run ${runId} is not awaiting review (status: ${run.status})`);
  }
  const store = await getPageStore();
  if (run.report_id) await store.rejectDraftReport(run.project_id, run.report_id);
  await runs.updateOne(
    { _id: runId },
    {
      $set: {
        status: "failed",
        error: "draft rejected by reviewer",
        review_outcome: "rejected",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        finished_at: new Date(),
      },
    },
  );
  await setProjectLocked(run.project_id, false);
  await auditRunLifecycle(runId, "tome.ingest.failed", {
    error: "draft rejected by reviewer",
    review_outcome: "rejected",
  });
}

/**
 * Auto-promote any run still `awaiting_review` past its `review_deadline` —
 * same effect as `approveDraftRun`, but reviewer-less (a reviewer never
 * showed up). Run alongside `reapStaleRuns` on the same periodic sweep.
 * Returns the number promoted.
 */
export async function promoteOverdueRuns(): Promise<number> {
  const runs = await getTomeIngestRunsCollection();
  const overdue = await runs
    .find({ status: "awaiting_review", review_deadline: { $lt: new Date() } })
    .toArray();
  for (const run of overdue) {
    try {
      const store = await getPageStore();
      if (run.report_id) await store.promoteDraftReport(run.project_id, run.report_id);
      await runs.updateOne(
        { _id: run._id },
        {
          $set: {
            status: "succeeded",
            review_outcome: "auto_promoted",
            finished_at: new Date(),
          },
        },
      );
      await setProjectLocked(run.project_id, false);
      await auditRunLifecycle(run._id!, "tome.ingest.finished", {
        review_outcome: "auto_promoted",
      });
    } catch (e) {
      console.warn(`promoteOverdueRuns: failed to promote run ${run._id}`, e);
    }
  }
  return overdue.length;
}

/** Parse an SSE byte stream into typed ingest events (`event:`/`data:` frames). */
async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<IngestEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev = frameToEvent(frame);
      if (ev) yield ev;
    }
  }
  const tail = frameToEvent(buf);
  if (tail) yield tail;
}

function frameToEvent(frame: string): IngestEvent | null {
  let type = "log";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { type: type as IngestEvent["type"], data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

function summaryFromOverview(pages: Record<string, string>): string {
  const md = pages["overview.md"];
  if (!md) return "";
  const [, body] = parseFrontmatter(md);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("_(")) continue;
    return line.slice(0, 200);
  }
  return "";
}

export class IngestInProgressError extends Error {
  constructor() {
    super("An ingest is already in progress for this project.");
    this.name = "IngestInProgressError";
  }
}
