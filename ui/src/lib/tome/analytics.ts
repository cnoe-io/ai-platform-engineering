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
// Leadership scorecard — aggregate-only completion of issue #180. These
// helpers deliberately receive plain project/activity values so the counting
// rules can be tested without MongoDB and the API never returns user data.
// ---------------------------------------------------------------------------

export type TomeFreshnessBucket = "fresh" | "aging" | "stale" | "never";

export interface TomeLeadershipProject {
  projectId: string;
  type?: ProjectDocument["type"];
  slug: string;
  name?: string;
  dataSteward?: string;
  sources?: ProjectDocument["sources"];
  initiatives?: string[];
  areas?: string[];
  createdAt?: Date | null;
  lastSourceEventAt?: Date | null;
  lastIngestedAt?: Date | null;
  lastChatAt?: Date | null;
}

export interface TomeLeadershipKpis {
  windowDays: number;
  coverage: { eligibleProjects: number; stewardedProjects: number; sourcedProjects: number };
  activity: { activeProjects: number; dormantProjects: number };
  engagement: { sessions: number; messages: number; repeatUsers: number };
  sourceHealth: Record<TomeFreshnessBucket, number>;
  bhag: { count: number; childProjects: number; fresh: number; aging: number; stale: number; never: number };
  hierarchy: {
    bhags: number;
    areas: number;
    projects: number;
    bhagAreaRelations: number;
    bhagProjectRelations: number;
    areaProjectRelations: number;
  };
  onboarding: { totalProjects: number; addedInWindow: number };
  wikiMaturity: { realWikis: number; greenfieldOnly: number; emptyShells: number };
  ingestReliability: { succeeded: number; failed: number; successRate: number | null };
  cost: { totalUsd: number; perActiveProjectUsd: number | null; measuredRuns: number; terminalRuns: number };
  projectEngagement: Array<{ projectId: string; slug: string; name: string; sessions: number; messages: number; repeatUsers: number }>;
  bhagBreakdown: Array<{ projectId: string; slug: string; name: string; directProjects: number; areas: number; areaProjects: number }>;
}

export interface TomeLeadershipDetails {
  maturityByProjectId?: Map<string, "real" | "greenfield" | "empty">;
  engagementByProjectId?: Map<string, { sessions: number; messages: number; repeatUsers: number }>;
  ingestReliability?: { succeeded: number; failed: number };
  cost?: { totalUsd: number; measuredRuns: number; terminalRuns: number };
}

const EMPTY_SOURCE_HEALTH: Record<TomeFreshnessBucket, number> = {
  fresh: 0,
  aging: 0,
  stale: 0,
  never: 0,
};

/** A direct-source project is covered when any supported connector is configured. */
export function hasConfiguredTomeSource(sources: ProjectDocument["sources"] | undefined): boolean {
  if (!sources) return false;
  return Boolean(
    sources.repos?.length ||
      sources.confluence_url?.trim() ||
      sources.confluence_spaces?.length ||
      sources.webex_rooms?.length ||
      sources.component_urls?.length,
  );
}

/** Fresh <= 7 days, aging <= 30 days, stale > 30 days, never when no signal exists. */
export function getTomeFreshnessBucket(
  timestamp: Date | null | undefined,
  now = new Date(),
): TomeFreshnessBucket {
  if (!timestamp) return "never";
  const ageMs = Math.max(0, now.getTime() - timestamp.getTime());
  if (ageMs <= 7 * DAY_MS) return "fresh";
  if (ageMs <= 30 * DAY_MS) return "aging";
  return "stale";
}

function latestTimestamp(...timestamps: Array<Date | null | undefined>): Date | null {
  const valid = timestamps.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
  return valid.length ? new Date(Math.max(...valid.map((value) => value.getTime()))) : null;
}

/** Existing hierarchy labels may contain either a stable slug or display name. */
function hierarchyLabelKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hierarchyKeys(project: TomeLeadershipProject): Set<string> {
  return new Set([project.slug, project.name].filter((value): value is string => Boolean(value?.trim())).map(hierarchyLabelKey));
}

function matchingHierarchyRelations(labels: string[] | undefined, parents: TomeLeadershipProject[]): number {
  if (!labels?.length || !parents.length) return 0;
  const parentKeys = new Set(parents.flatMap((parent) => [...hierarchyKeys(parent)]));
  return new Set(labels.map(hierarchyLabelKey).filter((label) => parentKeys.has(label))).size;
}

/** Build the complete scorecard from already-aggregated data. */
export function summarizeTomeLeadershipKpis(
  projects: TomeLeadershipProject[],
  engagement: { sessions: number; messages: number; repeatUsers: number },
  bhagSynthesisByProjectId: Map<string, Date>,
  now = new Date(),
  windowDays = 30,
  details: TomeLeadershipDetails = {},
): TomeLeadershipKpis {
  const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
  const directProjects = projects.filter((project) => project.type !== "bhag" && project.type !== "area");
  const coverage = {
    eligibleProjects: directProjects.length,
    stewardedProjects: directProjects.filter((project) => Boolean(project.dataSteward?.trim())).length,
    sourcedProjects: directProjects.filter((project) => hasConfiguredTomeSource(project.sources)).length,
  };
  const sourceHealth = { ...EMPTY_SOURCE_HEALTH };
  let activeProjects = 0;
  for (const project of directProjects) {
    const sourceSignal = latestTimestamp(project.lastSourceEventAt, project.lastIngestedAt);
    sourceHealth[getTomeFreshnessBucket(sourceSignal, now)] += 1;
    const activitySignal = latestTimestamp(project.lastChatAt, project.lastIngestedAt);
    if (activitySignal && activitySignal >= cutoff) activeProjects += 1;
  }

  const bhags = projects.filter((project) => project.type === "bhag");
  const areas = projects.filter((project) => project.type === "area");
  const bhag = { count: bhags.length, childProjects: 0, fresh: 0, aging: 0, stale: 0, never: 0 };
  for (const goal of bhags) {
    bhag.childProjects += directProjects.filter((project) => matchingHierarchyRelations(project.initiatives, [goal]) > 0).length;
    bhag[getTomeFreshnessBucket(bhagSynthesisByProjectId.get(goal.projectId), now)] += 1;
  }
  const maturity = { realWikis: 0, greenfieldOnly: 0, emptyShells: 0 };
  for (const project of directProjects) {
    const state = details.maturityByProjectId?.get(project.projectId) ?? "empty";
    if (state === "real") maturity.realWikis += 1;
    else if (state === "greenfield") maturity.greenfieldOnly += 1;
    else maturity.emptyShells += 1;
  }
  const reliability = details.ingestReliability ?? { succeeded: 0, failed: 0 };
  const terminalRuns = details.cost?.terminalRuns ?? 0;
  const measuredRuns = details.cost?.measuredRuns ?? 0;
  const totalUsd = details.cost?.totalUsd ?? 0;

  return {
    windowDays,
    coverage,
    activity: { activeProjects, dormantProjects: directProjects.length - activeProjects },
    engagement,
    sourceHealth,
    bhag,
    hierarchy: {
      bhags: bhags.length,
      areas: areas.length,
      projects: directProjects.length,
      bhagAreaRelations: areas.reduce((count, area) => count + matchingHierarchyRelations(area.initiatives, bhags), 0),
      bhagProjectRelations: directProjects.reduce(
        (count, project) => count + matchingHierarchyRelations(project.initiatives, bhags),
        0,
      ),
      areaProjectRelations: directProjects.reduce(
        (count, project) => count + matchingHierarchyRelations(project.areas, areas),
        0,
      ),
    },
    onboarding: {
      totalProjects: directProjects.length,
      addedInWindow: directProjects.filter((project) => project.createdAt && project.createdAt >= cutoff).length,
    },
    wikiMaturity: maturity,
    ingestReliability: {
      ...reliability,
      successRate: reliability.succeeded + reliability.failed > 0
        ? reliability.succeeded / (reliability.succeeded + reliability.failed)
        : null,
    },
    cost: {
      totalUsd,
      perActiveProjectUsd: activeProjects > 0 && measuredRuns > 0 ? totalUsd / activeProjects : null,
      measuredRuns,
      terminalRuns,
    },
    projectEngagement: directProjects
      .map((project) => ({
        projectId: project.projectId,
        slug: project.slug,
        name: project.name ?? project.slug,
        sessions: details.engagementByProjectId?.get(project.projectId)?.sessions ?? 0,
        messages: details.engagementByProjectId?.get(project.projectId)?.messages ?? 0,
        repeatUsers: details.engagementByProjectId?.get(project.projectId)?.repeatUsers ?? 0,
      }))
      .sort((left, right) => right.messages - left.messages || right.sessions - left.sessions || left.name.localeCompare(right.name)),
    bhagBreakdown: bhags.map((goal) => {
      const matchingAreas = areas.filter((area) => matchingHierarchyRelations(area.initiatives, [goal]) > 0);
      const directChildren = directProjects.filter((project) => matchingHierarchyRelations(project.initiatives, [goal]) > 0);
      const areaChildren = directProjects.filter((project) => matchingHierarchyRelations(project.areas, matchingAreas) > 0);
      return {
        projectId: goal.projectId,
        slug: goal.slug,
        name: goal.name ?? goal.slug,
        directProjects: directChildren.length,
        areas: matchingAreas.length,
        areaProjects: areaChildren.length,
      };
    }),
  };
}

/** Fetch aggregate-only coverage, engagement, health, and BHAG scorecard data. */
export async function getTomeLeadershipKpis(windowDays = 30): Promise<TomeLeadershipKpis> {
  const empty = (): TomeLeadershipKpis =>
    summarizeTomeLeadershipKpis([], { sessions: 0, messages: 0, repeatUsers: 0 }, new Map(), new Date(), windowDays);
  try {
    const [projects, sessions, messages, ingestRuns] = await Promise.all([
      getCollection<ProjectDocument>("projects"),
      getCollection("tome_chat_sessions"),
      getTomeChatMessagesCollection(),
      getCollection("tome_ingest_runs"),
    ]);
    const cutoff = new Date(Date.now() - windowDays * DAY_MS);
    const [projectRows, chatRows, ingestRows, synthesisRows, sessionCount, messageCount, repeatRows, projectSessionRows, projectMessageRows, runRows, reliabilityRows] = await Promise.all([
      projects
        .find({ status: "active" })
        .project({ type: 1, slug: 1, name: 1, data_steward: 1, sources: 1, labels: 1, last_source_event_at: 1, created_at: 1 })
        .toArray(),
      sessions
        .aggregate<{ _id: string; lastChatAt: Date }>([
          { $match: { updated_at: { $gte: cutoff } } },
          { $group: { _id: "$project_id", lastChatAt: { $max: "$updated_at" } } },
        ])
        .toArray(),
      ingestRuns
        .aggregate<{ _id: string; lastIngestedAt: Date }>([
          { $match: { status: "succeeded" } },
          { $group: { _id: "$project_id", lastIngestedAt: { $max: "$finished_at" } } },
        ])
        .toArray(),
      ingestRuns
        .aggregate<{ _id: string; lastSynthesizedAt: Date }>([
          { $match: { status: "succeeded", "dispatch.endpoint": "/synthesize" } },
          { $group: { _id: "$project_id", lastSynthesizedAt: { $max: "$finished_at" } } },
        ])
        .toArray(),
      sessions.countDocuments({ created_at: { $gte: cutoff } }),
      messages.countDocuments({ created_at: { $gte: cutoff } }),
      sessions
        .aggregate<{ repeatUsers: number }>([
          { $match: { created_at: { $gte: cutoff } } },
          { $group: { _id: "$user_id", sessions: { $sum: 1 } } },
          { $match: { sessions: { $gte: 2 } } },
          { $count: "repeatUsers" },
        ])
        .toArray(),
      sessions
        .aggregate<{ _id: string; sessions: number; repeatUsers: number }>([
          { $match: { created_at: { $gte: cutoff } } },
          { $group: { _id: { projectId: "$project_id", userId: "$user_id" }, sessions: { $sum: 1 } } },
          {
            $group: {
              _id: "$_id.projectId",
              sessions: { $sum: "$sessions" },
              repeatUsers: { $sum: { $cond: [{ $gte: ["$sessions", 2] }, 1, 0] } },
            },
          },
        ])
        .toArray(),
      messages
        .aggregate<{ _id: string; messages: number }>([
          { $match: { created_at: { $gte: cutoff } } },
          { $group: { _id: "$project_id", messages: { $sum: 1 } } },
        ])
        .toArray(),
      ingestRuns
        .aggregate<{
          _id: string;
          successfulRuns: number;
          successfulNonGreenfieldRuns: number;
          totalCostUsd: number;
          measuredRuns: number;
          terminalRuns: number;
        }>([
          { $match: { "dispatch.endpoint": { $ne: "/synthesize" }, status: { $in: ["succeeded", "failed"] } } },
          {
            $group: {
              _id: "$project_id",
              successfulRuns: { $sum: { $cond: [{ $eq: ["$status", "succeeded"] }, 1, 0] } },
              successfulNonGreenfieldRuns: {
                $sum: { $cond: [{ $and: [{ $eq: ["$status", "succeeded"] }, { $eq: ["$greenfield", false] }] }, 1, 0] },
              },
              totalCostUsd: { $sum: { $ifNull: ["$cost_usd", 0] } },
              measuredRuns: { $sum: { $cond: [{ $ne: [{ $type: "$cost_usd" }, "missing"] }, 1, 0] } },
              terminalRuns: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      ingestRuns
        .aggregate<{ _id: { projectId: string; status: "succeeded" | "failed" }; count: number }>([
          {
            $match: {
              "dispatch.endpoint": { $ne: "/synthesize" },
              status: { $in: ["succeeded", "failed"] },
              finished_at: { $gte: cutoff },
            },
          },
          { $group: { _id: { projectId: "$project_id", status: "$status" }, count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    const chatsByProject = new Map(chatRows.map((row) => [String(row._id), row.lastChatAt]));
    const ingestsByProject = new Map(ingestRows.map((row) => [String(row._id), row.lastIngestedAt]));
    const synthesesByProject = new Map(synthesisRows.map((row) => [String(row._id), row.lastSynthesizedAt]));
    const scorecardProjects: TomeLeadershipProject[] = projectRows.map((project) => ({
      projectId: String(project._id),
      type: project.type,
      slug: project.slug,
      name: project.name,
      dataSteward: project.data_steward,
      sources: project.sources,
      initiatives: project.labels?.initiatives,
      areas: project.labels?.areas,
      createdAt: project.created_at,
      lastSourceEventAt: project.last_source_event_at,
      lastIngestedAt: ingestsByProject.get(String(project._id)) ?? null,
      lastChatAt: chatsByProject.get(String(project._id)) ?? null,
    }));
    const directProjectIds = new Set(
      scorecardProjects.filter((project) => project.type !== "bhag" && project.type !== "area").map((project) => project.projectId),
    );
    const projectEngagement = new Map<string, { sessions: number; messages: number; repeatUsers: number }>();
    for (const row of projectSessionRows) {
      projectEngagement.set(String(row._id), { sessions: row.sessions, messages: 0, repeatUsers: row.repeatUsers });
    }
    for (const row of projectMessageRows) {
      const projectId = String(row._id);
      const current = projectEngagement.get(projectId) ?? { sessions: 0, messages: 0, repeatUsers: 0 };
      current.messages = row.messages;
      projectEngagement.set(projectId, current);
    }
    const maturity = new Map<string, "real" | "greenfield" | "empty">();
    let totalCostUsd = 0;
    let measuredRuns = 0;
    let terminalRuns = 0;
    for (const row of runRows) {
      maturity.set(String(row._id), row.successfulNonGreenfieldRuns > 0 ? "real" : row.successfulRuns > 0 ? "greenfield" : "empty");
      if (!directProjectIds.has(String(row._id))) continue;
      totalCostUsd += row.totalCostUsd;
      measuredRuns += row.measuredRuns;
      terminalRuns += row.terminalRuns;
    }
    const reliability = {
      succeeded: reliabilityRows
        .filter((row) => directProjectIds.has(String(row._id.projectId)) && row._id.status === "succeeded")
        .reduce((total, row) => total + row.count, 0),
      failed: reliabilityRows
        .filter((row) => directProjectIds.has(String(row._id.projectId)) && row._id.status === "failed")
        .reduce((total, row) => total + row.count, 0),
    };
    return summarizeTomeLeadershipKpis(
      scorecardProjects,
      { sessions: sessionCount, messages: messageCount, repeatUsers: repeatRows[0]?.repeatUsers ?? 0 },
      synthesesByProject,
      new Date(),
      windowDays,
      { maturityByProjectId: maturity, engagementByProjectId: projectEngagement, ingestReliability: reliability, cost: { totalUsd: totalCostUsd, measuredRuns, terminalRuns } },
    );
  } catch {
    return empty();
  }
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

/** Daily active direct-project onboarding. `value` is projects created on the
 * day, while the dashboard headline supplies the cumulative active total. */
export async function getTomeProjectOnboardingTrend(days = 30): Promise<DailyPoint[]> {
  const buckets = buildDailyBuckets(days);
  try {
    const projects = await getCollection<ProjectDocument>("projects");
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const rows = await projects
      .aggregate<{ _id: string; projects: number }>([
        { $match: { status: "active", created_at: { $gte: cutoff }, type: { $nin: ["bhag", "area"] } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } }, projects: { $sum: 1 } } },
      ])
      .toArray();
    const byDay = new Map(rows.map((row) => [row._id, row.projects]));
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
