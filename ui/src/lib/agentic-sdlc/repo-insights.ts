/**
 * Server-only aggregations for the four repo-detail insight panels:
 *
 *   - CI for tasks-in-flight  → `getInFlightCi`
 *   - Completed-feature changelog → `getChangelogEntries`
 *   - Snapshot artifacts (GitHub Actions, deploy, recent agentic) →
 *     `getRecentSnapshots`
 *   - Deployment health (per env, rich) → `getDeploymentHealth`
 *
 * All four read from the existing `ship_loop_artifacts` and
 * `ship_loop_events` collections; no new collections are introduced.
 * For pilot scale (<25 repos) the aggregations are cheap and uncached.
 *
 * Pure data layer — never imported from a client component.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcEventsCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import type {
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
  ArtifactCiSummary,
  ArtifactNativeState,
  AgenticSdlcStage,
  ArtifactKindStored,
  ChangelogEntry,
  ChangelogEntryKind,
  CiConclusion,
  CiStatus,
  DeploymentEnvironmentHealth,
  DeploymentEnvironmentSummary,
  DeploymentHealthSummary,
  DeploymentRecord,
  SnapshotArtifactRecord,
  SnapshotArtifactKind,
  ActorKind,
} from "@/types/agentic-sdlc";

// ---------------------------------------------------------------------------
// CI for tasks-in-flight
// ---------------------------------------------------------------------------

export interface InFlightCiArtifact {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  github_url: string;
  state: ArtifactNativeState;
  head_sha: string | null;
  ci_summary: ArtifactCiSummary | null;
  last_event_at: string;
}

export interface InFlightCiResult {
  /** Artifacts that are still in flight (open PRs + open subtasks). */
  items: InFlightCiArtifact[];
  /** Aggregate counts across all in-flight artifacts in this repo. */
  totals: {
    success: number;
    failure: number;
    pending: number;
    no_ci: number;
  };
}

/**
 * Pull all in-flight PRs and tasks (open subtasks) for a repo with
 * their latest CI summary attached. The summary is `null` when no
 * CI events have been projected for the artifact yet.
 */
export async function getInFlightCi(
  repoId: string,
  options: { limit?: number } = {},
): Promise<InFlightCiResult> {
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const limit = clampLimit(options.limit, 50, 200);

  const rows = (await artifacts
    .find(
      {
        repo_id: repoId,
        kind: { $in: ["pull_request", "subtask"] as ArtifactKindStored[] },
        state: { $nin: ["closed", "merged", "cancelled"] },
      },
      {
        projection: {
          _id: 0,
          artifact_id: 1,
          kind: 1,
          title: 1,
          current_stage: 1,
          github_url: 1,
          state: 1,
          head_sha: 1,
          ci_summary: 1,
          last_event_at: 1,
        },
        sort: { last_event_at: -1 },
        limit,
      },
    )
    .toArray()) as unknown as Array<
    Pick<
      AgenticSdlcArtifact,
      | "artifact_id"
      | "kind"
      | "title"
      | "current_stage"
      | "github_url"
      | "state"
      | "head_sha"
      | "ci_summary"
      | "last_event_at"
    >
  >;

  const items: InFlightCiArtifact[] = rows.map((row) => ({
    artifact_id: row.artifact_id,
    kind: row.kind,
    title: row.title,
    current_stage: row.current_stage,
    github_url: row.github_url,
    state: row.state,
    head_sha: row.head_sha ?? null,
    ci_summary: row.ci_summary ?? null,
    last_event_at: row.last_event_at.toISOString(),
  }));

  const totals = items.reduce(
    (acc, item) => {
      if (!item.ci_summary) {
        acc.no_ci += 1;
        return acc;
      }
      const c = item.ci_summary.conclusion;
      if (c === "success") acc.success += 1;
      else if (c === "failure" || c === "timed_out" || c === "action_required") {
        acc.failure += 1;
      } else if (item.ci_summary.status !== "completed" || c === "pending") {
        acc.pending += 1;
      }
      return acc;
    },
    { success: 0, failure: 0, pending: 0, no_ci: 0 },
  );

  return { items, totals };
}

// ---------------------------------------------------------------------------
// Changelog of completed features
// ---------------------------------------------------------------------------

export interface GetChangelogOptions {
  /** Default 30 days. Clamped to 1..365. */
  lookbackDays?: number;
  /** Default 50. Clamped to 1..200. */
  limit?: number;
}

const RESOLVED_STATES: ArtifactNativeState[] = ["closed", "merged"];

export async function getChangelogEntries(
  repoId: string,
  options: GetChangelogOptions = {},
): Promise<ChangelogEntry[]> {
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const lookbackDays = clampLimit(options.lookbackDays, 30, 365);
  const limit = clampLimit(options.limit, 50, 200);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = (await artifacts
    .find(
      {
        repo_id: repoId,
        $or: [
          {
            kind: { $in: ["epic", "pull_request"] },
            state: { $in: RESOLVED_STATES },
            last_event_at: { $gte: since },
          },
          {
            kind: "deploy",
            state: "success",
            last_event_at: { $gte: since },
          },
        ],
      },
      {
        projection: {
          _id: 0,
          artifact_id: 1,
          kind: 1,
          title: 1,
          body_excerpt: 1,
          state: 1,
          epic_id: 1,
          github_url: 1,
          labels: 1,
          agent_labels: 1,
          last_event_at: 1,
        },
        sort: { last_event_at: -1 },
        limit,
      },
    )
    .toArray()) as unknown as Array<
    Pick<
      AgenticSdlcArtifact,
      | "artifact_id"
      | "kind"
      | "title"
      | "body_excerpt"
      | "state"
      | "epic_id"
      | "github_url"
      | "labels"
      | "agent_labels"
      | "last_event_at"
    >
  >;

  return rows.map((row) => ({
    id: row.artifact_id,
    kind: deriveChangelogKind(row.kind, row.state),
    title: row.title,
    body_excerpt: row.body_excerpt,
    completed_at: row.last_event_at.toISOString(),
    github_url: row.github_url,
    epic_id: row.epic_id,
    actor_label: row.agent_labels?.[0] ?? null,
    actor_kind: deriveChangelogActor(row.agent_labels),
    labels: row.labels ?? [],
  }));
}

function deriveChangelogKind(
  kind: ArtifactKindStored,
  state: ArtifactNativeState,
): ChangelogEntryKind {
  if (kind === "epic") return state === "merged" ? "epic_merged" : "epic_closed";
  if (kind === "pull_request") return "pull_request_merged";
  return "deploy_succeeded";
}

function deriveChangelogActor(agentLabels: string[] | undefined): ActorKind {
  return (agentLabels?.length ?? 0) > 0 ? "agent" : "human";
}

// ---------------------------------------------------------------------------
// Snapshot artifacts (last X runs)
// ---------------------------------------------------------------------------

export interface GetSnapshotsOptions {
  /** Default 5. Clamped 1..50. */
  recentRuns?: number;
  /** Default 24h. Clamped 1..720. */
  windowHours?: number;
  /** Which sources to include. Defaults to all three. */
  kinds?: SnapshotArtifactKind[];
}

export interface RepoSnapshotResult {
  items: SnapshotArtifactRecord[];
  by_kind: Record<SnapshotArtifactKind, number>;
}

/**
 * Collect "snapshot artifacts" from three sources:
 *
 *   1. GitHub Actions: workflow_run events that completed in the
 *      window (we read `workflow_run.artifacts_url` if present and
 *      surface the run itself even when individual artifacts aren't
 *      enumerated; richer per-artifact listing requires a live
 *      GitHub call from the API route).
 *   2. Deploy snapshots: the latest N `deploy` artifacts.
 *   3. Recent agentic artifacts: PRs and tasks that changed in the
 *      window (used to give operators a "what did the agents
 *      produce" view).
 */
export async function getRecentSnapshots(
  repoId: string,
  options: GetSnapshotsOptions = {},
): Promise<RepoSnapshotResult> {
  const recentRuns = clampLimit(options.recentRuns, 5, 50);
  const windowHours = clampLimit(options.windowHours, 24, 720);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const kinds = new Set<SnapshotArtifactKind>(
    options.kinds ?? [
      "github_actions_artifact",
      "deploy_snapshot",
      "agentic_artifact",
    ],
  );

  const artifacts = await getAgenticSdlcArtifactsCollection();
  const events = await getAgenticSdlcEventsCollection();

  const [workflowEvents, deployArtifacts, recentAgentic] = await Promise.all([
    kinds.has("github_actions_artifact")
      ? events
          .find(
            {
              repo_id: repoId,
              github_event_type: "workflow_run",
              occurred_at: { $gte: since },
            },
            {
              projection: { _id: 0, github_delivery_id: 1, payload: 1, occurred_at: 1 },
              sort: { occurred_at: -1 },
              limit: recentRuns,
            },
          )
          .toArray()
      : Promise.resolve([] as Array<Partial<AgenticSdlcEvent>>),
    kinds.has("deploy_snapshot")
      ? (artifacts
          .find(
            { repo_id: repoId, kind: "deploy" },
            {
              projection: {
                _id: 0,
                artifact_id: 1,
                title: 1,
                state: 1,
                body_excerpt: 1,
                github_url: 1,
                last_event_at: 1,
                labels: 1,
              },
              sort: { last_event_at: -1 },
              limit: recentRuns,
            },
          )
          .toArray() as Promise<
          Array<
            Pick<
              AgenticSdlcArtifact,
              | "artifact_id"
              | "title"
              | "state"
              | "body_excerpt"
              | "github_url"
              | "last_event_at"
              | "labels"
            >
          >
        >)
      : Promise.resolve([]),
    kinds.has("agentic_artifact")
      ? (artifacts
          .find(
            {
              repo_id: repoId,
              kind: { $in: ["epic", "subtask", "pull_request"] },
              last_event_at: { $gte: since },
            },
            {
              projection: {
                _id: 0,
                artifact_id: 1,
                kind: 1,
                title: 1,
                state: 1,
                current_stage: 1,
                github_url: 1,
                last_event_at: 1,
              },
              sort: { last_event_at: -1 },
              limit: recentRuns,
            },
          )
          .toArray() as Promise<
          Array<
            Pick<
              AgenticSdlcArtifact,
              | "artifact_id"
              | "kind"
              | "title"
              | "state"
              | "current_stage"
              | "github_url"
              | "last_event_at"
            >
          >
        >)
      : Promise.resolve([]),
  ]);

  const items: SnapshotArtifactRecord[] = [];

  for (const ev of workflowEvents) {
    const payload = ev.payload as { workflow_run?: Record<string, unknown> } | undefined;
    const run = payload?.workflow_run;
    if (!run) continue;
    const conclusion = (run.conclusion as string | null | undefined) ?? null;
    const status = (run.status as string | undefined) ?? "completed";
    const url = (run.html_url as string | undefined) ?? null;
    items.push({
      id: `wf:${(run.id as string | number | undefined) ?? ev.github_delivery_id ?? ""}`,
      kind: "github_actions_artifact",
      title:
        (run.name as string | undefined) ??
        (run.display_title as string | undefined) ??
        "Workflow run",
      subtitle: subtitleForWorkflow(status, conclusion),
      produced_at: (ev.occurred_at ?? new Date()).toISOString(),
      url,
      size_bytes: null,
      tone:
        conclusion === "success"
          ? "success"
          : conclusion === "failure" ||
              conclusion === "timed_out" ||
              conclusion === "startup_failure"
            ? "failure"
            : "neutral",
      source_run_id: (run.id as string | number | undefined)?.toString() ?? null,
    });
  }

  for (const deploy of deployArtifacts) {
    items.push({
      id: `deploy:${deploy.artifact_id}`,
      kind: "deploy_snapshot",
      title: deploy.title,
      subtitle:
        deploy.body_excerpt && deploy.body_excerpt.length > 0
          ? deploy.body_excerpt
          : `Deploy state: ${deploy.state}`,
      produced_at: deploy.last_event_at.toISOString(),
      url: deploy.github_url || null,
      size_bytes: null,
      tone:
        deploy.state === "success"
          ? "success"
          : deploy.state === "failure"
            ? "failure"
            : "neutral",
      source_run_id: deploy.artifact_id,
    });
  }

  for (const row of recentAgentic) {
    items.push({
      id: `agentic:${row.artifact_id}`,
      kind: "agentic_artifact",
      title: row.title,
      subtitle: `${row.kind.replaceAll("_", " ")} • ${row.current_stage.replaceAll("_", " ")}`,
      produced_at: row.last_event_at.toISOString(),
      url: row.github_url || null,
      size_bytes: null,
      tone: row.state === "merged" || row.state === "success" ? "success" : "neutral",
      source_run_id: row.artifact_id,
    });
  }

  items.sort(
    (a, b) => Date.parse(b.produced_at) - Date.parse(a.produced_at),
  );

  const by_kind: Record<SnapshotArtifactKind, number> = {
    github_actions_artifact: 0,
    deploy_snapshot: 0,
    agentic_artifact: 0,
  };
  for (const item of items) by_kind[item.kind] += 1;

  return { items, by_kind };
}

function subtitleForWorkflow(status: string, conclusion: string | null): string {
  if (status !== "completed") return `Workflow ${status}`;
  return `Conclusion: ${conclusion ?? "unknown"}`;
}

// ---------------------------------------------------------------------------
// Deployment health (rich, per-environment)
// ---------------------------------------------------------------------------

export interface GetDeploymentHealthOptions {
  /** Default 168h (7 days). Clamped 1..2160 (90 days). */
  windowHours?: number;
  /** Recent deploys to include per environment. Default 10, clamped 1..50. */
  recentPerEnv?: number;
}

export async function getDeploymentHealth(
  repoId: string,
  options: GetDeploymentHealthOptions = {},
): Promise<DeploymentHealthSummary> {
  const windowHours = clampLimit(options.windowHours, 168, 2160);
  const recentPerEnv = clampLimit(options.recentPerEnv, 10, 50);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const events = await getAgenticSdlcEventsCollection();
  const artifacts = await getAgenticSdlcArtifactsCollection();

  const deployEvents = (await events
    .find(
      {
        repo_id: repoId,
        github_event_type: "deployment_status",
        occurred_at: { $gte: since },
      },
      {
        projection: { _id: 0, payload: 1, occurred_at: 1, epic_id: 1, artifact_id: 1 },
        sort: { occurred_at: -1 },
        // Cap scan to keep the route fast on pathological repos.
        limit: 1_000,
      },
    )
    .toArray()) as Array<
    Pick<AgenticSdlcEvent, "payload" | "occurred_at" | "epic_id" | "artifact_id">
  >;

  const deployArtifacts = (await artifacts
    .find(
      { repo_id: repoId, kind: "deploy" },
      {
        projection: {
          _id: 0,
          artifact_id: 1,
          title: 1,
          state: 1,
          body_excerpt: 1,
          github_url: 1,
          last_event_at: 1,
          created_at: 1,
          epic_id: 1,
        },
        sort: { last_event_at: -1 },
        limit: 500,
      },
    )
    .toArray()) as Array<
    Pick<
      AgenticSdlcArtifact,
      | "artifact_id"
      | "title"
      | "state"
      | "body_excerpt"
      | "github_url"
      | "last_event_at"
      | "created_at"
      | "epic_id"
    >
  >;

  type RawDeploy = {
    artifact_id: string;
    environment: string;
    state: ArtifactNativeState;
    description: string | null;
    started_at: string | null;
    completed_at: string | null;
    failure_reason: string | null;
    url: string | null;
    epic_id: string | null;
    occurred_at: Date;
  };

  // Build a per-artifact view from events, fall back to artifact rows
  // when no event was recorded in the window.
  const byArtifact = new Map<string, RawDeploy>();

  for (const ev of deployEvents) {
    const payload = ev.payload as
      | {
          deployment?: { node_id?: string; environment?: string; created_at?: string };
          deployment_status?: {
            state?: string;
            description?: string;
            target_url?: string;
            created_at?: string;
            updated_at?: string;
          };
        }
      | undefined;
    const dep = payload?.deployment;
    const ds = payload?.deployment_status;
    if (!dep || !ds) continue;
    const artifactId = dep.node_id ?? ev.artifact_id ?? "";
    if (!artifactId) continue;
    const environment = dep.environment ?? "unknown";
    const dsState = ds.state ?? "pending";
    const state: ArtifactNativeState =
      dsState === "success"
        ? "success"
        : dsState === "failure" || dsState === "error"
          ? "failure"
          : "in_progress";
    const completed = state === "success" || state === "failure";
    const description = ds.description ?? null;
    const failure_reason =
      state === "failure" ? extractFailureReason(description, ds.target_url ?? null) : null;
    const startedAt = dep.created_at ?? ds.created_at ?? null;
    const completedAt = completed
      ? ds.updated_at ?? ev.occurred_at.toISOString()
      : null;

    const existing = byArtifact.get(artifactId);
    if (!existing || ev.occurred_at > existing.occurred_at) {
      byArtifact.set(artifactId, {
        artifact_id: artifactId,
        environment,
        state,
        description,
        started_at: startedAt,
        completed_at: completedAt,
        failure_reason,
        url: ds.target_url ?? null,
        epic_id: ev.epic_id ?? null,
        occurred_at: ev.occurred_at,
      });
    }
  }

  // Fall back to artifact rows for deploys that have no event in the
  // window — e.g. older deploys whose `deployment_status` events fell
  // outside the lookback range but the projected artifact is still
  // tracked.
  for (const deploy of deployArtifacts) {
    if (byArtifact.has(deploy.artifact_id)) continue;
    const environment = inferEnvironmentFromTitle(deploy.title) ?? "unknown";
    byArtifact.set(deploy.artifact_id, {
      artifact_id: deploy.artifact_id,
      environment,
      state: deploy.state,
      description: deploy.body_excerpt || null,
      started_at: deploy.created_at.toISOString(),
      completed_at:
        deploy.state === "success" || deploy.state === "failure"
          ? deploy.last_event_at.toISOString()
          : null,
      failure_reason:
        deploy.state === "failure" ? extractFailureReason(deploy.body_excerpt, deploy.github_url) : null,
      url: deploy.github_url || null,
      epic_id: deploy.epic_id ?? null,
      occurred_at: deploy.last_event_at,
    });
  }

  // Group by environment, compute summary stats.
  const byEnv = new Map<string, RawDeploy[]>();
  for (const d of byArtifact.values()) {
    const list = byEnv.get(d.environment) ?? [];
    list.push(d);
    byEnv.set(d.environment, list);
  }

  const environments: DeploymentEnvironmentSummary[] = [];
  const totals = { success: 0, failure: 0, in_progress: 0 };
  for (const [environment, list] of byEnv.entries()) {
    list.sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime());
    const completed = list.filter(
      (d) => d.state === "success" || d.state === "failure",
    );
    const successCount = completed.filter((d) => d.state === "success").length;
    const failureCount = completed.filter((d) => d.state === "failure").length;
    const inProgressCount = list.length - successCount - failureCount;
    totals.success += successCount;
    totals.failure += failureCount;
    totals.in_progress += inProgressCount;

    const durations = list
      .map((d) => deployDurationSeconds(d))
      .filter((d): d is number => d !== null && d >= 0);
    const recoverySeconds = computeRecoverySeconds(list);

    const records: DeploymentRecord[] = list.slice(0, recentPerEnv).map((d) => ({
      id: d.artifact_id,
      environment: d.environment,
      state: d.state,
      description: d.description,
      started_at: d.started_at,
      completed_at: d.completed_at,
      duration_seconds: deployDurationSeconds(d),
      failure_reason: d.failure_reason,
      url: d.url,
      epic_id: d.epic_id,
    }));

    environments.push({
      environment,
      health: deriveEnvHealth({
        successCount,
        failureCount,
        latest: list[0]?.state,
      }),
      last_deploy_at: list[0]?.occurred_at.toISOString() ?? null,
      success_rate:
        completed.length === 0 ? 0 : successCount / completed.length,
      failure_count: failureCount,
      success_count: successCount,
      median_duration_seconds: durations.length === 0 ? null : median(durations),
      median_recovery_seconds: recoverySeconds,
      recent_deploys: records,
    });
  }

  environments.sort((a, b) => {
    const aLast = Date.parse(a.last_deploy_at ?? "");
    const bLast = Date.parse(b.last_deploy_at ?? "");
    if (Number.isNaN(aLast) && Number.isNaN(bLast)) {
      return a.environment.localeCompare(b.environment);
    }
    if (Number.isNaN(aLast)) return 1;
    if (Number.isNaN(bLast)) return -1;
    return bLast - aLast;
  });

  return {
    window_hours: windowHours,
    environments,
    totals,
    generated_at: new Date().toISOString(),
  };
}

function deployDurationSeconds(d: {
  started_at: string | null;
  completed_at: string | null;
}): number | null {
  if (!d.started_at || !d.completed_at) return null;
  const start = Date.parse(d.started_at);
  const end = Date.parse(d.completed_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

function computeRecoverySeconds(
  list: { state: ArtifactNativeState; occurred_at: Date }[],
): number | null {
  // For each failure that's followed by a success (in chronological
  // order), measure failure→success seconds; return the median.
  const chronological = [...list].sort(
    (a, b) => a.occurred_at.getTime() - b.occurred_at.getTime(),
  );
  const samples: number[] = [];
  let lastFailureAt: number | null = null;
  for (const d of chronological) {
    if (d.state === "failure") {
      lastFailureAt = d.occurred_at.getTime();
    } else if (d.state === "success" && lastFailureAt !== null) {
      samples.push((d.occurred_at.getTime() - lastFailureAt) / 1000);
      lastFailureAt = null;
    }
  }
  return samples.length === 0 ? null : median(samples);
}

function deriveEnvHealth(args: {
  successCount: number;
  failureCount: number;
  latest: ArtifactNativeState | undefined;
}): DeploymentEnvironmentHealth {
  if (!args.latest) return "unknown";
  if (args.successCount + args.failureCount === 0) return "idle";
  if (args.latest === "failure") return "failing";
  const successRate =
    args.successCount / Math.max(1, args.successCount + args.failureCount);
  if (successRate < 0.7) return "degraded";
  return "healthy";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function inferEnvironmentFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  // Convention from the projector: titles are "Deploy → <env>".
  const arrow = title.indexOf("→");
  if (arrow >= 0) {
    return title.slice(arrow + 1).trim() || null;
  }
  const ascii = title.indexOf("->");
  if (ascii >= 0) {
    return title.slice(ascii + 2).trim() || null;
  }
  return null;
}

function extractFailureReason(
  description: string | null | undefined,
  targetUrl: string | null | undefined,
): string | null {
  const text = description ?? "";
  if (text.length === 0 && targetUrl) {
    return `See logs at ${targetUrl}`;
  }
  // Best-effort: take the first line, capped at 240 chars.
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return null;
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampLimit(
  value: number | undefined,
  defaultValue: number,
  max: number,
): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return defaultValue;
  return Math.min(Math.max(1, Math.floor(value as number)), max);
}

// Re-export CI conclusion / status types for callers that build UI off
// this module without importing from `@/types/agentic-sdlc` directly.
export type { CiConclusion, CiStatus, ArtifactCiSummary };
