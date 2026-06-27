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

import { getPageStore } from "./page-store";
import { getTomeIngestRunsCollection, getTomeReportsCollection } from "./mongo-collections";
import { buildIngestRequest, resolveForwardedCredentials } from "./agent-proxy";
import {
  dispatchLine,
  formatIngestEvent,
  infoLine,
  type IngestEvent,
} from "./ingest-format";
import { parseFrontmatter, stableSeedTemplates } from "./schema";
import { injectCharterIntro } from "./seed";
import type { TomeProjectContext } from "./tome-api";
import type { IngestRun, Report } from "@/types/tome";

const inflight = new Set<Promise<void>>();

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
 * Kick an ingest run. Returns the new run id immediately; the agent stream is
 * driven in the background. Throws if a run is already in progress.
 */
export async function startIngestRun(
  ctx: TomeProjectContext,
  opts: {
    seed?: string | null;
    webexMeetings?: { id: string; title: string; start: string }[];
    /**
     * Greenfield only, opt-in (default false). When true the ingest agent is
     * authorized to write a best-effort DRAFT into the stable pages (charter /
     * objectives / roadmap). When false, stable pages stay human-owned and the
     * agent never touches them — they keep their empty founding templates.
     */
    seedStablePages?: boolean;
  },
): Promise<{ runId: string }> {
  const projectId = ctx.projectId;
  if (await isIngestRunning(projectId)) {
    throw new IngestInProgressError();
  }

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
    status: "running",
    greenfield: isGreenfield,
    log: [],
    started_at: now,
  };
  await runs.insertOne(run);

  // Greenfield: always seed the stable pages from their founding templates so
  // the pages exist (with their `## section` scaffold) for humans to fill in.
  // charter ← project.description. Whether the AGENT then drafts content over
  // these is the separate, opt-in `seedStablePages` flag passed to the agent.
  if (isGreenfield) {
    const seeds: Record<string, string> = stableSeedTemplates();
    const desc = (ctx.project.description ?? "").trim();
    if (desc && seeds["charter.md"]) {
      seeds["charter.md"] = injectCharterIntro(seeds["charter.md"], desc);
    }
    const store = await getPageStore();
    await store.writePages(projectId, seeds, {
      message: "seed stable pages (founding templates)",
      author: "tome-ingest",
      reportId,
    });
    await appendLog(runId, infoLine(`seeded ${Object.keys(seeds).length} stable page(s): ${Object.keys(seeds).sort().join(", ")}`));
  }

  await appendLog(runId, dispatchLine(isGreenfield));

  // Resolve the user's forwarded credentials NOW (synchronously) — by the time
  // driveIngest runs, the request session is gone. The agent routes these to
  // the per-connector MCPs. Never logged.
  const credentials = await resolveForwardedCredentials(ctx);

  const meetings = opts.webexMeetings ?? [];
  const connectorData: Record<string, unknown> =
    meetings.length > 0 ? { webex: { meetings } } : {};

  const req = buildIngestRequest(ctx, {
    runId,
    reportId,
    seed: opts.seed?.trim() || null,
    isGreenfield,
    connectorData,
    credentials,
    // Opt-in only, and only meaningful on greenfield.
    seedStablePages: isGreenfield && opts.seedStablePages === true,
  });

  const task = driveIngest(projectId, runId, reportId, req).finally(() =>
    inflight.delete(task),
  );
  inflight.add(task);

  return { runId };
}

async function appendLog(runId: string, line: string): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  await runs.updateOne({ _id: runId }, { $push: { log: line } });
}

async function driveIngest(
  projectId: string,
  runId: string,
  reportId: string,
  req: unknown,
): Promise<void> {
  const runs = await getTomeIngestRunsCollection();
  const reports = await getTomeReportsCollection();
  const agentUrl = process.env.TOME_AGENT_URL;
  try {
    if (!agentUrl) throw new Error("TOME_AGENT_URL not configured");
    const res = await fetch(`${agentUrl.replace(/\/$/, "")}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`agent /ingest failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    for await (const ev of parseSse(res.body)) {
      await appendLog(runId, formatIngestEvent(ev));
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
