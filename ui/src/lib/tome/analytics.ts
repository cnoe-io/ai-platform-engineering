/**
 * Tome consumption + engagement analytics.
 *
 * Two distinct surfaces, deliberately kept separate:
 *  - "Consumption" (ingestion activity + wiki size) is cross-project and
 *    powers the org-wide TOME Admin analytics tab (`getOrgTomeConsumption`).
 *  - "Engagement" (who's chatting) is per-project only — it stays inside
 *    each project's own Tome page (`getProjectEngagement`), never rolled up
 *    org-wide, so no cross-project user activity list needs to exist.
 *
 * Wiki size is measured from `tome_page_revisions.markdown` (the `mongo`
 * PageStore backend inlines bodies there — see lib/tome/page-store.ts). If a
 * future `s3` backend externalizes bodies via `body_ref`, this undercounts;
 * revisit then.
 *
 * Server-only.
 */

import { getServerOnlyConfig } from "@/lib/config";
import { getCollection } from "@/lib/mongodb";
import { getTomeChatMessagesCollection } from "@/lib/tome/mongo-collections";
import type { Document } from "mongodb";
import type { ProjectDocument } from "@/types/projects";
import type { ActiveIngestRun } from "@/types/tome";

export interface ProjectEngagement {
  /** Distinct chatters (by user_id, i.e. email) for this project, all-time. */
  distinctChatters: number;
  totalSessions: number;
  totalMessages: number;
  lastMessageAt: Date | null;
}

export interface ProjectConsumption {
  pageCount: number;
  /** Approximate wiki content size, in bytes (current, non-deleted pages). */
  wikiSizeBytes: number;
  lastIngestedAt: Date | null;
  activeIngest: ActiveIngestRun | null;
  ingestRunsSucceeded: number;
  /** Cumulative token usage across succeeded ingest runs. */
  tokenUsage: { input: number; output: number };
}

const EMPTY_ENGAGEMENT: ProjectEngagement = {
  distinctChatters: 0,
  totalSessions: 0,
  totalMessages: 0,
  lastMessageAt: null,
};

const EMPTY_CONSUMPTION: ProjectConsumption = {
  pageCount: 0,
  wikiSizeBytes: 0,
  lastIngestedAt: null,
  activeIngest: null,
  ingestRunsSucceeded: 0,
  tokenUsage: { input: 0, output: 0 },
};

/** Chat engagement for a single project — meant to render on that project's own Tome page. */
export async function getProjectEngagement(
  projectId: string,
): Promise<ProjectEngagement> {
  try {
    const [sessions, messages] = await Promise.all([
      getCollection("tome_chat_sessions"),
      getCollection("tome_chat_messages"),
    ]);
    const [distinctChatters, totalSessions, totalMessages, lastMessage] =
      await Promise.all([
        sessions.distinct("user_id", { project_id: projectId }),
        sessions.countDocuments({ project_id: projectId }),
        messages.countDocuments({ project_id: projectId }),
        messages
          .find({ project_id: projectId })
          .sort({ created_at: -1 })
          .limit(1)
          .next(),
      ]);
    return {
      distinctChatters: distinctChatters.filter(Boolean).length,
      totalSessions,
      totalMessages,
      lastMessageAt: (lastMessage as { created_at?: Date } | null)?.created_at ?? null,
    };
  } catch {
    // Tome collections not present (e.g. Mongo not configured, or feature
    // never used on this project) — analytics are best-effort, not fatal.
    return { ...EMPTY_ENGAGEMENT };
  }
}

/** Ingestion + wiki-size consumption for a single project. */
export async function getProjectConsumption(
  projectId: string,
): Promise<ProjectConsumption> {
  const rows = await getOrgTomeConsumption([projectId]);
  return rows.byProjectId.get(projectId) ?? { ...EMPTY_CONSUMPTION };
}

export interface OrgConsumptionRow extends ProjectConsumption {
  projectId: string;
  slug: string;
  title: string;
  teamName?: string;
}

export interface OrgConsumptionResult {
  rows: OrgConsumptionRow[];
  byProjectId: Map<string, ProjectConsumption>;
  totals: {
    projectCount: number;
    activeIngestCount: number;
    totalPages: number;
    totalWikiSizeBytes: number;
    totalTokens: number;
  };
}

/**
 * Select the latest revision for every page before removing tombstones.
 *
 * Filtering deleted revisions first would resurrect the previous live revision
 * and over-count every deleted page.
 */
export function buildCurrentPageSizePipeline(projectIds: string[]): Document[] {
  return [
    { $match: { project_id: { $in: projectIds } } },
    { $sort: { project_id: 1, path: 1, created_at: -1 } },
    {
      $group: {
        _id: { project_id: "$project_id", path: "$path" },
        deleted: { $first: "$deleted" },
        bytes: { $first: { $strLenBytes: { $ifNull: ["$markdown", ""] } } },
      },
    },
    { $match: { deleted: { $ne: true } } },
    {
      $group: {
        _id: "$_id.project_id",
        pageCount: { $sum: 1 },
        wikiSizeBytes: { $sum: "$bytes" },
      },
    },
  ];
}

/** Headline totals must describe exactly the current projects shown in the table. */
export function summarizeOrgConsumptionRows(
  rows: OrgConsumptionRow[],
): OrgConsumptionResult["totals"] {
  return rows.reduce<OrgConsumptionResult["totals"]>(
    (totals, row) => {
      totals.projectCount += 1;
      if (row.activeIngest) totals.activeIngestCount += 1;
      totals.totalPages += row.pageCount;
      totals.totalWikiSizeBytes += row.wikiSizeBytes;
      totals.totalTokens += row.tokenUsage.input + row.tokenUsage.output;
      return totals;
    },
    {
      projectCount: 0,
      activeIngestCount: 0,
      totalPages: 0,
      totalWikiSizeBytes: 0,
      totalTokens: 0,
    },
  );
}

/**
 * Cross-project consumption rollup. Pass `projectIds` to scope to a known
 * set (e.g. one project for `getProjectConsumption`); omit it to cover every
 * project that has ANY Tome activity (pages or ingest runs) — the org-wide
 * admin view.
 */
export async function getOrgTomeConsumption(
  projectIds?: string[],
): Promise<OrgConsumptionResult> {
  const empty: OrgConsumptionResult = {
    rows: [],
    byProjectId: new Map(),
    totals: { projectCount: 0, activeIngestCount: 0, totalPages: 0, totalWikiSizeBytes: 0, totalTokens: 0 },
  };

  let pageRevisions, ingestRuns;
  try {
    [pageRevisions, ingestRuns] = await Promise.all([
      getCollection("tome_page_revisions"),
      getCollection("tome_ingest_runs"),
    ]);
  } catch {
    return empty;
  }

  // Discover the project set when not explicitly scoped: any project with a
  // page revision or an ingest run has "Tome activity" worth showing.
  let scopedIds = projectIds ?? null;
  if (!scopedIds) {
    const [fromPages, fromRuns] = await Promise.all([
      pageRevisions.distinct("project_id", {}),
      ingestRuns.distinct("project_id", {}),
    ]);
    scopedIds = [...new Set([...fromPages, ...fromRuns])] as string[];
  }
  if (scopedIds.length === 0) return empty;

  const idFilter = { project_id: { $in: scopedIds } };

  const [sizeRows, lastIngestRows, activeRuns] = await Promise.all([
    // Latest revision per (project, path), excluding paths whose latest
    // revision is a tombstone; sum the remaining current content.
    pageRevisions
      .aggregate(buildCurrentPageSizePipeline(scopedIds))
      .toArray(),
    ingestRuns
      .aggregate([
        { $match: { ...idFilter, status: "succeeded" } },
        {
          $group: {
            _id: "$project_id",
            lastIngestedAt: { $max: "$finished_at" },
            ingestRunsSucceeded: { $sum: 1 },
            inputTokens: { $sum: { $ifNull: ["$usage.input", 0] } },
            outputTokens: { $sum: { $ifNull: ["$usage.output", 0] } },
          },
        },
      ])
      .toArray(),
    ingestRuns
      .find({ ...idFilter, status: { $in: ["queued", "running"] } })
      .project({ project_id: 1, status: 1, dispatch: 1, started_at: 1, queued_at: 1 })
      .toArray(),
  ]);

  const sizeMap = new Map<string, { pageCount: number; wikiSizeBytes: number }>();
  for (const r of sizeRows) {
    sizeMap.set(String(r._id), { pageCount: r.pageCount as number, wikiSizeBytes: r.wikiSizeBytes as number });
  }
  const ingestMap = new Map<
    string,
    { lastIngestedAt: Date; ingestRunsSucceeded: number; inputTokens: number; outputTokens: number }
  >();
  for (const r of lastIngestRows) {
    ingestMap.set(String(r._id), {
      lastIngestedAt: r.lastIngestedAt as Date,
      ingestRunsSucceeded: r.ingestRunsSucceeded as number,
      inputTokens: r.inputTokens as number,
      outputTokens: r.outputTokens as number,
    });
  }
  const activeMap = new Map<string, ActiveIngestRun>();
  for (const run of activeRuns) {
    const pid = String(run.project_id);
    if (activeMap.has(pid)) continue; // one badge per project is enough
    activeMap.set(pid, {
      status: run.status as "queued" | "running",
      mode: run.dispatch?.endpoint === "/synthesize" ? "bhag_rollup" : "ingest",
      started_at: run.started_at ?? null,
      queued_at: run.queued_at ?? null,
      project_slug: "",
      project_title: "",
    });
  }

  // Resolve project metadata (title/slug/team) for the ids we're reporting on.
  const projects = await getCollection<ProjectDocument>("projects");
  const { ObjectId } = await import("mongodb");
  const objectIds = scopedIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const projectDocs = await projects
    .find({ _id: { $in: objectIds as unknown as string[] } })
    .project({ slug: 1, title: 1, name: 1, team_name: 1 })
    .toArray();
  const projectMeta = new Map(
    projectDocs.map((p) => [
      String(p._id),
      { slug: p.slug ?? "", title: p.title || p.name || String(p._id), teamName: p.team_name },
    ]),
  );

  const byProjectId = new Map<string, ProjectConsumption>();
  const rows: OrgConsumptionRow[] = [];

  for (const pid of scopedIds) {
    const size = sizeMap.get(pid) ?? { pageCount: 0, wikiSizeBytes: 0 };
    const ingest = ingestMap.get(pid);
    const active = activeMap.get(pid) ?? null;
    const meta = projectMeta.get(pid);

    const consumption: ProjectConsumption = {
      pageCount: size.pageCount,
      wikiSizeBytes: size.wikiSizeBytes,
      lastIngestedAt: ingest?.lastIngestedAt ?? null,
      activeIngest: active
        ? { ...active, project_slug: meta?.slug ?? "", project_title: meta?.title ?? pid }
        : null,
      ingestRunsSucceeded: ingest?.ingestRunsSucceeded ?? 0,
      tokenUsage: { input: ingest?.inputTokens ?? 0, output: ingest?.outputTokens ?? 0 },
    };
    byProjectId.set(pid, consumption);

    if (meta) {
      rows.push({ ...consumption, projectId: pid, slug: meta.slug, title: meta.title, teamName: meta.teamName });
    }
  }

  rows.sort((a, b) => a.title.localeCompare(b.title));

  return {
    rows,
    byProjectId,
    totals: summarizeOrgConsumptionRows(rows),
  };
}

// ---------------------------------------------------------------------------
// TOME KPIs — org-wide Adoption / Freshness / Performance (per the "TOME
// KPIs" slide). Deliberately separate from getOrgTomeConsumption: these are
// scalar rollups (no per-user rosters), so they don't reopen the "who's
// chatting" privacy question that keeps engagement per-project.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TomeAdoption {
  /** Distinct users with a chat message in the trailing 24h. */
  dau: number;
  /** Distinct users with a chat message in the trailing `windowDays`. */
  mau: number;
  /** dau / mau, or null when mau is 0 (nothing to divide by). */
  ratio: number | null;
  windowDays: number;
}

/**
 * "Adoption" KPI: users engaging with TOME daily, as a fraction of monthly
 * actives (target from the KPI deck: >80%). DAU/MAU are rolling windows
 * ending now (trailing 24h / trailing `windowDays`), not calendar-day
 * buckets — avoids "since local midnight" timezone ambiguity and stays
 * stable as a point-in-time snapshot no matter when it's checked.
 */
export async function getTomeAdoption(windowDays = 30): Promise<TomeAdoption> {
  const empty: TomeAdoption = { dau: 0, mau: 0, ratio: null, windowDays };
  try {
    const messages = await getTomeChatMessagesCollection();
    const cutoffMonthly = new Date(Date.now() - windowDays * DAY_MS);

    // Chat messages don't carry user_id directly (only the session does), so
    // group to per-session activity first, then join to resolve the user.
    const rows = await messages
      .aggregate<{ _id: string | null; lastActivity: Date }>([
        { $match: { role: "user", created_at: { $gte: cutoffMonthly } } },
        { $group: { _id: "$session_id", lastAt: { $max: "$created_at" } } },
        {
          $lookup: {
            from: "tome_chat_sessions",
            localField: "_id",
            foreignField: "_id",
            as: "session",
          },
        },
        { $unwind: "$session" },
        { $group: { _id: "$session.user_id", lastActivity: { $max: "$lastAt" } } },
      ])
      .toArray();

    const cutoffDaily = new Date(Date.now() - DAY_MS);
    const active = rows.filter((r) => Boolean(r._id));
    const mau = active.length;
    const dau = active.filter((r) => r.lastActivity >= cutoffDaily).length;
    return { dau, mau, ratio: mau > 0 ? dau / mau : null, windowDays };
  } catch {
    return empty;
  }
}

export interface TomeFreshness {
  /** Thumbs-up count on TOME chat responses in the window. */
  positive: number;
  /** Thumbs-down count on TOME chat responses in the window. */
  negative: number;
  total: number;
  /** positive / total, or null when total is 0. */
  satisfactionRate: number | null;
  windowDays: number;
}

/**
 * "Freshness" KPI proxy: the deck names this the "12-Midnight Test" scored
 * 👍/👎/🚩 and marks the exact rubric "(ask team)" — i.e. not yet finalized.
 * Until that's nailed down, this reuses the 👍/👎 feedback already collected
 * on every TOME chat response (see MessageActions/FeedbackButton) as an
 * automatable stand-in: satisfactionRate = 👍 / (👍+👎). 🚩 isn't tracked as
 * a distinct signal yet — dislikes with "Report a Problem" overlap with 👎
 * here, not counted separately.
 *
 * Feedback rows don't carry a Tome-specific flag, so scoping to TOME is done
 * by joining `feedback.conversation_id` against `tome_chat_sessions._id`
 * (ChatPanel passes the durable Tome session id as `conversationId` — see
 * ui/src/components/tome/ChatPanel.tsx `MessageRow` call site).
 */
export async function getTomeFreshness(windowDays = 30): Promise<TomeFreshness> {
  const empty: TomeFreshness = { positive: 0, negative: 0, total: 0, satisfactionRate: null, windowDays };
  try {
    const feedback = await getCollection<{
      rating?: string;
      conversation_id?: string | null;
      created_at?: Date;
    }>("feedback");
    const cutoff = new Date(Date.now() - windowDays * DAY_MS);

    const rows = await feedback
      .aggregate<{ _id: string; count: number }>([
        { $match: { created_at: { $gte: cutoff }, conversation_id: { $ne: null } } },
        {
          $lookup: {
            from: "tome_chat_sessions",
            localField: "conversation_id",
            foreignField: "_id",
            as: "tomeSession",
          },
        },
        { $match: { "tomeSession.0": { $exists: true } } },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ])
      .toArray();

    const positive = rows.find((r) => r._id === "positive")?.count ?? 0;
    const negative = rows.find((r) => r._id === "negative")?.count ?? 0;
    const total = positive + negative;
    return { positive, negative, total, satisfactionRate: total > 0 ? positive / total : null, windowDays };
  } catch {
    return empty;
  }
}

export interface TomePerformance {
  /** p95 end-to-end chat run duration in seconds, or null if unavailable. */
  p95Seconds: number | null;
  /** Whether PROMETHEUS_URL is configured on this UI instance. */
  configured: boolean;
  status: PrometheusMeasurementStatus;
  /** KPI target from the deck. */
  targetSeconds: number;
}

export type PrometheusMeasurementStatus =
  | "measured"
  | "collecting"
  | "not_configured"
  | "no_data"
  | "query_failed";

const PROMETHEUS_QUERY_TIMEOUT_MS = 5_000;

/**
 * "Performance" KPI: p95 time for a TOME query to return a result (target
 * <10s). Sourced from tome-agent's own `tome_agent_run_duration_seconds`
 * histogram (`kind="chat"` — the full SSE-streamed chat turn, start to
 * finish; see ai_platform_engineering/agents/tome/tome_agent/metrics.py),
 * not re-measured here, so there's exactly one place that times a chat run.
 */
export async function getTomeQueryLatencyP95(): Promise<TomePerformance> {
  const targetSeconds = 10;
  const { prometheusUrl } = getServerOnlyConfig();
  if (!prometheusUrl) {
    return { p95Seconds: null, configured: false, status: "not_configured", targetSeconds };
  }

  const query =
    'histogram_quantile(0.95, sum(rate(tome_agent_run_duration_seconds_bucket{kind="chat"}[1h])) by (le))';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMETHEUS_QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${prometheusUrl}/api/v1/query?${new URLSearchParams({ query })}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { p95Seconds: null, configured: true, status: "query_failed", targetSeconds };
    }
    const body = await res.json();
    const raw = body?.data?.result?.[0]?.value?.[1];
    const n = typeof raw === "string" ? parseFloat(raw) : null;
    if (n === null || Number.isNaN(n)) {
      return { p95Seconds: null, configured: true, status: "no_data", targetSeconds };
    }
    return { p95Seconds: n, configured: true, status: "measured", targetSeconds };
  } catch {
    return { p95Seconds: null, configured: true, status: "query_failed", targetSeconds };
  } finally {
    clearTimeout(timeout);
  }
}

/** Runs a single Prometheus instant query, returning its scalar value or null
 *  (not configured, HTTP error, timeout, or non-numeric result). */
interface PromInstantQueryResult {
  value: number | null;
  failed: boolean;
}

async function promInstantQuery(
  prometheusUrl: string,
  query: string,
): Promise<PromInstantQueryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMETHEUS_QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${prometheusUrl}/api/v1/query?${new URLSearchParams({ query })}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { value: null, failed: true };
    const body = await res.json();
    const raw = body?.data?.result?.[0]?.value?.[1];
    const n = typeof raw === "string" ? parseFloat(raw) : null;
    return {
      value: n !== null && !Number.isNaN(n) ? n : null,
      failed: false,
    };
  } catch {
    return { value: null, failed: true };
  } finally {
    clearTimeout(timeout);
  }
}

export interface TomeUptime {
  /** % of Prometheus scrapes where tome-agent responded, over the trailing window. */
  uptimePct: number | null;
  /** Current tome-agent process uptime in seconds — resets to ~0 on every
   *  restart/deploy, so a low value here doesn't necessarily mean an outage. */
  processUptimeSeconds: number | null;
  /** Percentage of the requested availability window covered by scrape data. */
  coveragePct: number | null;
  configured: boolean;
  status: PrometheusMeasurementStatus;
  windowHours: number;
  /** KPI target — conventional "three nines" availability. */
  targetPct: number;
}

/**
 * "Uptime" KPI: how reliably tome-agent has been reachable, derived from
 * Prometheus's built-in `up{job="tome-agent"}` (1 when a scrape succeeds, 0
 * when it doesn't — see deploy/prometheus/prometheus.yml / the tome-agent
 * ServiceMonitor). `max(up)` treats the service as available while any
 * replica is reachable; the subquery then computes that service-level
 * availability over the window. Process uptime is a secondary signal (a
 * still-100% availability rate with near-zero process uptime means a replica
 * restarted, not that the service was unavailable).
 */
export async function getTomeUptime(windowHours = 24): Promise<TomeUptime> {
  const targetPct = 99.9;
  const { prometheusUrl } = getServerOnlyConfig();
  if (!prometheusUrl) {
    return {
      uptimePct: null,
      processUptimeSeconds: null,
      coveragePct: null,
      configured: false,
      status: "not_configured",
      windowHours,
      targetPct,
    };
  }

  const [uptimeResult, processUptimeResult, coverageResult] = await Promise.all([
    promInstantQuery(
      prometheusUrl,
      `avg_over_time(max(up{job="tome-agent"})[${windowHours}h:30s]) * 100`,
    ),
    promInstantQuery(prometheusUrl, "min(tome_agent_uptime_seconds)"),
    promInstantQuery(
      prometheusUrl,
      `count_over_time(max(up{job="tome-agent"})[${windowHours}h:30s]) / (${windowHours} * 60 * 2) * 100`,
    ),
  ]);
  const status: PrometheusMeasurementStatus =
    uptimeResult.failed || coverageResult.failed
      ? "query_failed"
      : uptimeResult.value === null
        ? "no_data"
      : coverageResult.value === null || coverageResult.value < 99
        ? "collecting"
        : "measured";
  return {
    uptimePct: status === "measured" ? uptimeResult.value : null,
    processUptimeSeconds: processUptimeResult.value,
    coveragePct: coverageResult.value,
    configured: true,
    status,
    windowHours,
    targetPct,
  };
}

// ---------------------------------------------------------------------------
// Historical trends — daily series backing the "Trends" charts under the KPI
// cards. Kept separate from the point-in-time KPI getters above so a slow or
// failing trend query never blocks the scalar KPIs (and vice versa); the API
// route fetches all of them in parallel with Promise.all.
// ---------------------------------------------------------------------------

export interface DailyPoint {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  value: number;
}

/** Ascending list of UTC calendar-day strings, `days` of them, ending today. */
function buildDailyBuckets(days: number): string[] {
  const buckets: string[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    buckets.push(new Date(now - i * DAY_MS).toISOString().slice(0, 10));
  }
  return buckets;
}

/**
 * Daily active-users trend backing the Adoption KPI card. Same session→user
 * join as `getTomeAdoption`, just bucketed by day instead of collapsed to a
 * single trailing-24h/trailing-window snapshot.
 */
export async function getTomeAdoptionTrend(days = 30): Promise<DailyPoint[]> {
  const buckets = buildDailyBuckets(days);
  try {
    const messages = await getTomeChatMessagesCollection();
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const rows = await messages
      .aggregate<{ _id: string; activeUsers: number }>([
        { $match: { role: "user", created_at: { $gte: cutoff } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
              session_id: "$session_id",
            },
          },
        },
        {
          $lookup: {
            from: "tome_chat_sessions",
            localField: "_id.session_id",
            foreignField: "_id",
            as: "session",
          },
        },
        { $unwind: "$session" },
        { $group: { _id: { day: "$_id.day", user_id: "$session.user_id" } } },
        { $group: { _id: "$_id.day", activeUsers: { $sum: 1 } } },
      ])
      .toArray();

    const byDay = new Map(rows.map((r) => [r._id, r.activeUsers]));
    return buckets.map((date) => ({ date, value: byDay.get(date) ?? 0 }));
  } catch {
    return buckets.map((date) => ({ date, value: 0 }));
  }
}

export interface FreshnessDailyPoint {
  date: string;
  positive: number;
  negative: number;
  satisfactionRate: number | null;
}

/** Daily 👍/👎 trend backing the Freshness KPI card. Same join as `getTomeFreshness`. */
export async function getTomeFreshnessTrend(days = 30): Promise<FreshnessDailyPoint[]> {
  const buckets = buildDailyBuckets(days);
  const empty = () => buckets.map((date) => ({ date, positive: 0, negative: 0, satisfactionRate: null }));
  try {
    const feedback = await getCollection<{
      rating?: string;
      conversation_id?: string | null;
      created_at?: Date;
    }>("feedback");
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const rows = await feedback
      .aggregate<{ _id: { day: string; rating: string }; count: number }>([
        { $match: { created_at: { $gte: cutoff }, conversation_id: { $ne: null } } },
        {
          $lookup: {
            from: "tome_chat_sessions",
            localField: "conversation_id",
            foreignField: "_id",
            as: "tomeSession",
          },
        },
        { $match: { "tomeSession.0": { $exists: true } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
              rating: "$rating",
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const byDay = new Map<string, { positive: number; negative: number }>();
    for (const r of rows) {
      const bucket = byDay.get(r._id.day) ?? { positive: 0, negative: 0 };
      if (r._id.rating === "positive") bucket.positive += r.count;
      else if (r._id.rating === "negative") bucket.negative += r.count;
      byDay.set(r._id.day, bucket);
    }

    return buckets.map((date) => {
      const b = byDay.get(date) ?? { positive: 0, negative: 0 };
      const total = b.positive + b.negative;
      return { date, positive: b.positive, negative: b.negative, satisfactionRate: total > 0 ? b.positive / total : null };
    });
  } catch {
    return empty();
  }
}

export interface IngestActivityDailyPoint {
  date: string;
  runs: number;
  tokens: number;
}

/** Daily succeeded-ingest-run trend backing the Consumption section. */
export async function getTomeIngestActivityTrend(days = 30): Promise<IngestActivityDailyPoint[]> {
  const buckets = buildDailyBuckets(days);
  try {
    const ingestRuns = await getCollection("tome_ingest_runs");
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const rows = await ingestRuns
      .aggregate<{ _id: string; runs: number; tokens: number }>([
        { $match: { status: "succeeded", finished_at: { $gte: cutoff } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$finished_at" } },
            runs: { $sum: 1 },
            tokens: {
              $sum: { $add: [{ $ifNull: ["$usage.input", 0] }, { $ifNull: ["$usage.output", 0] }] },
            },
          },
        },
      ])
      .toArray();

    const byDay = new Map(rows.map((r) => [r._id, { runs: r.runs, tokens: r.tokens }]));
    return buckets.map((date) => {
      const b = byDay.get(date);
      return { date, runs: b?.runs ?? 0, tokens: b?.tokens ?? 0 };
    });
  } catch {
    return buckets.map((date) => ({ date, runs: 0, tokens: 0 }));
  }
}

export interface PerformanceDailyPoint {
  /** ISO timestamp (Prometheus sample time, not bucketed to a calendar day —
   *  range-query step may be sub-daily; see `getTomeQueryLatencyTrend`). */
  date: string;
  p95Seconds: number | null;
}

export interface TomePerformanceTrend {
  points: PerformanceDailyPoint[];
  configured: boolean;
}

/**
 * p95 latency trend backing the Performance KPI card, via Prometheus
 * `query_range` over the same histogram as `getTomeQueryLatencyP95`. Step
 * widens as the window grows so the point count stays chart-friendly; note
 * this only shows data as far back as Prometheus's retention allows (the
 * local dev Prometheus in docker-compose.dev.yaml retains 6h).
 */
export async function getTomeQueryLatencyTrend(days = 7): Promise<TomePerformanceTrend> {
  const { prometheusUrl } = getServerOnlyConfig();
  if (!prometheusUrl) {
    return { points: [], configured: false };
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 24 * 60 * 60;
  const step = days <= 2 ? "1h" : days <= 14 ? "6h" : "1d";
  const query =
    'histogram_quantile(0.95, sum(rate(tome_agent_run_duration_seconds_bucket{kind="chat"}[1h])) by (le))';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMETHEUS_QUERY_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ query, start: String(start), end: String(end), step });
    const res = await fetch(`${prometheusUrl}/api/v1/query_range?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { points: [], configured: true };
    const body = await res.json();
    const values: [number, string][] = body?.data?.result?.[0]?.values ?? [];
    const points = values.map(([ts, raw]) => {
      const n = parseFloat(raw);
      return { date: new Date(ts * 1000).toISOString(), p95Seconds: Number.isNaN(n) ? null : n };
    });
    return { points, configured: true };
  } catch {
    return { points: [], configured: true };
  } finally {
    clearTimeout(timeout);
  }
}

export interface UptimeDailyPoint {
  /** ISO timestamp (Prometheus sample time — see `getTomeQueryLatencyTrend`). */
  date: string;
  uptimePct: number | null;
}

export interface TomeUptimeTrend {
  points: UptimeDailyPoint[];
  configured: boolean;
}

/**
 * Service-availability trend backing the Uptime KPI card. Each point averages
 * whether any Tome replica was reachable during the bucket, rather than
 * averaging replicas and treating one failed replica as a total outage.
 */
export async function getTomeUptimeTrend(days = 7): Promise<TomeUptimeTrend> {
  const { prometheusUrl } = getServerOnlyConfig();
  if (!prometheusUrl) {
    return { points: [], configured: false };
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 24 * 60 * 60;
  const step = days <= 2 ? "1h" : days <= 14 ? "6h" : "1d";
  const query = `avg_over_time(max(up{job="tome-agent"})[${step}:30s]) * 100`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROMETHEUS_QUERY_TIMEOUT_MS);
  try {
    const params = new URLSearchParams({ query, start: String(start), end: String(end), step });
    const res = await fetch(`${prometheusUrl}/api/v1/query_range?${params}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { points: [], configured: true };
    const body = await res.json();
    const values: [number, string][] = body?.data?.result?.[0]?.values ?? [];
    const points = values.map(([ts, raw]) => {
      const n = parseFloat(raw);
      return { date: new Date(ts * 1000).toISOString(), uptimePct: Number.isNaN(n) ? null : n };
    });
    return { points, configured: true };
  } catch {
    return { points: [], configured: true };
  } finally {
    clearTimeout(timeout);
  }
}
