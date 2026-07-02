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
import {
  dispatchLine,
  formatIngestEvent,
  infoLine,
  type IngestEvent,
} from "./ingest-format";
import { parseFrontmatter, stableSeedTemplates } from "./schema";
import { injectCharterIntro } from "./seed";
import { auditTome } from "./audit";
import type { TomeProjectContext } from "./tome-api";
import type { ProjectDocument } from "@/types/projects";
import type { IngestDispatch, IngestRun, Report } from "@/types/tome";

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

import { resolveBhagChildren } from "./bhag";
export { resolveBhagChildren };

const inflight = new Set<Promise<void>>();

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

/** True if an ingest is currently running for this project. */
export async function isIngestRunning(projectId: string): Promise<boolean> {
  const runs = await getTomeIngestRunsCollection();
  const active = await runs.findOne({
    project_id: projectId,
    status: { $in: ["queued", "running"] },
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
    dispatch: opts.dispatch,
    cascade_id: opts.cascadeId,
    cascade_role: opts.cascadeRole,
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
  const seeds: Record<string, string> = stableSeedTemplates();
  const desc = (project.description ?? "").trim();
  if (desc && seeds["charter.md"]) {
    seeds["charter.md"] = injectCharterIntro(seeds["charter.md"], desc);
  }
  const store = await getPageStore();
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
  const project = await loadProjectById(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const dispatch: IngestDispatch = run.dispatch ?? { endpoint: "/ingest" };
  const isGreenfield = run.greenfield;

  if (isGreenfield) {
    await seedGreenfieldStablePages(project, reportId, runId);
  }
  await appendLog(runId, dispatchLine(isGreenfield));

  // The original request session is gone by now; re-resolve from the stored sub.
  const credentials = await resolveCredentialsForSub(run.triggered_by_sub ?? "");

  const meetings = dispatch.webexMeetings ?? [];
  const connectorData: Record<string, unknown> =
    meetings.length > 0 ? { webex: { meetings } } : {};

  // A BHAG carries its child projects so the agent can read their wikis: synthesis
  // builds from them, compaction uses them as ground truth when tightening pages
  // and checking references.
  const endpoint = dispatch.endpoint || "/ingest";
  const isBhag = project.type === "bhag";
  const childProjects = isBhag ? await resolveBhagChildren(project.name) : [];
  if (isBhag) {
    const verb = endpoint === "/synthesize" ? "synthesis" : "compaction";
    await appendLog(
      runId,
      infoLine(
        childProjects.length
          ? `BHAG ${verb} with ${childProjects.length} child project(s): ${childProjects.map((c) => c.slug).join(", ")}`
          : `BHAG ${verb}: no projects are tagged to this goal yet`,
      ),
    );
  }

  const req = buildIngestRequest(project, {
    runId,
    reportId,
    seed: dispatch.seed?.trim() || null,
    isGreenfield,
    connectorData,
    credentials,
    seedStablePages: isGreenfield && dispatch.seedStablePages === true,
    childProjects,
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
    webexMeetings?: { id: string; title: string; start: string }[];
    seedStablePages?: boolean;
    agentEndpoint?: string;
  },
): Promise<{ runId: string }> {
  const projectId = ctx.projectId;
  if (await isIngestRunning(projectId)) {
    throw new IngestInProgressError();
  }

  const { runId } = await createRunRecord(ctx.project, {
    status: "running",
    sub: sessionSub(ctx.session),
    dispatch: {
      endpoint: opts.agentEndpoint ?? "/ingest",
      seed: opts.seed ?? null,
      seedStablePages: opts.seedStablePages,
      webexMeetings: opts.webexMeetings,
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
  },
): Promise<string> {
  const { runId } = await createRunRecord(project, { status: "queued", ...opts });
  return runId;
}

/**
 * Enqueue a BHAG cascade: a queued re-ingest for each tagged child project, then
 * a queued synthesize for the BHAG itself. The worker drains them at a bounded
 * concurrency and only starts the synthesize once every child is terminal.
 */
export async function enqueueBhagCascade(
  ctx: TomeProjectContext,
  opts: { seed?: string | null; seedStablePages?: boolean },
): Promise<{ cascadeId: string; parentRunId: string; childCount: number }> {
  const sub = sessionSub(ctx.session);
  const cascadeId = randomUUID();
  const children = await resolveBhagChildren(ctx.project.name);

  for (const child of children) {
    const childProject = await loadProjectById(child.project_id);
    if (!childProject) continue;
    await enqueueRun(childProject, {
      sub,
      dispatch: { endpoint: "/ingest", seed: null },
      cascadeId,
      cascadeRole: "child",
    });
  }

  const parentRunId = await enqueueRun(ctx.project, {
    sub,
    dispatch: {
      endpoint: "/synthesize",
      seed: opts.seed ?? null,
      seedStablePages: opts.seedStablePages,
    },
    cascadeId,
    cascadeRole: "parent",
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
 * lifecycle). */
async function auditRunLifecycle(
  runId: string,
  action: "tome.ingest.started" | "tome.ingest.finished" | "tome.ingest.failed",
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
        cascade_id: run.cascade_id ?? undefined,
        cascade_role: run.cascade_role ?? undefined,
        ...extra,
      },
    });
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
      } else {
        await appendLog(runId, formatIngestEvent(ev));
      }
    }

    // Finalize: summary from overview.md's first content line.
    const store = await getPageStore();
    const pages = await store.listPages(projectId);
    const summary = summaryFromOverview(pages);
    await reports.updateOne({ _id: reportId }, { $set: { summary } });
    await runs.updateOne(
      { _id: runId },
      { $set: { status: "succeeded", finished_at: new Date() } },
    );
    await auditRunLifecycle(runId, "tome.ingest.finished");
  } catch (e) {
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
  } finally {
    // Always unlock — success, failure, or agent crash — so a stuck flag never
    // leaves the wiki read-only.
    await setProjectLocked(projectId, false);
  }
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
