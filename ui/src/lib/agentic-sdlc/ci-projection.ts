/**
 * Pure projection of GitHub `check_run`, `check_suite`, and
 * `workflow_run` events into a compact, UI-friendly CI summary that
 * the worker can patch onto a PR or task artifact.
 *
 * No I/O, no env, no network — the worker handles persistence and
 * the API routes consume the stored `ci_summary` field on artifacts
 * plus the raw events collection for per-check drill-down.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type {
  ArtifactCiSummary,
  CiConclusion,
  CiStatus,
  AgenticSdlcEvent,
  AgenticSdlcArtifact,
} from "@/types/agentic-sdlc";

const CI_EVENT_TYPES = new Set(["check_run", "check_suite", "workflow_run"]);

/**
 * Patch fields the worker applies to the PR / task artifact when a CI
 * event lands. We deliberately keep the surface narrow so we never
 * stomp on stage / label fields that the issue/PR projector owns.
 */
export interface CiArtifactPatch {
  repo_id: string;
  artifact_id: string;
  /** Pull-request node id when known, used for matching on the artifact row. */
  head_sha: string | null;
  ci_summary: ArtifactCiSummary;
  /** Most recent CI activity timestamp for the artifact. */
  last_event_at: Date;
}

export function isCiEvent(ev: AgenticSdlcEvent): boolean {
  return ev.github_event_type !== null && CI_EVENT_TYPES.has(ev.github_event_type);
}

/**
 * Extract the artifact id (PR node id) that a CI event applies to.
 *
 * Returns `null` when the event cannot be linked to a tracked PR — those
 * events are still persisted (for future drill-downs) but contribute
 * no summary patch.
 */
export function ciEventArtifactId(ev: AgenticSdlcEvent): string | null {
  if (!isCiEvent(ev)) return null;
  if (ev.artifact_kind === "pull_request" && ev.artifact_id) {
    return ev.artifact_id;
  }
  // workflow_run events sometimes land with artifact_kind="unknown"
  // when no PR is attached; the webhook receiver still populates
  // artifact_id from the workflow_run.node_id in that case but we
  // only project CI for events that map to a PR.
  return null;
}

/**
 * Normalise a raw GitHub check conclusion into our small CI vocabulary.
 *
 * GitHub uses overlapping vocabularies across `check_run`,
 * `check_suite`, and `workflow_run`. This collapses them so the UI
 * only deals with a single enum.
 */
export function normaliseConclusion(raw: string | null | undefined): CiConclusion {
  if (raw == null) return "pending";
  switch (raw) {
    case "success":
      return "success";
    case "failure":
    case "startup_failure":
      return "failure";
    case "neutral":
      return "neutral";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    case "skipped":
      return "skipped";
    case "action_required":
      return "action_required";
    case "stale":
      return "stale";
    default:
      return "unknown";
  }
}

export function normaliseStatus(raw: string | null | undefined): CiStatus {
  if (raw === "queued") return "queued";
  if (raw === "in_progress") return "in_progress";
  return "completed";
}

interface ParsedCheck {
  external_id: string;
  check_name: string;
  status: CiStatus;
  conclusion: CiConclusion;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  head_sha: string | null;
  occurred_at: Date;
}

/**
 * Parse a single CI event into its check tuple. Returns `null` for
 * events that don't carry the fields we need.
 */
function parseCiEvent(ev: AgenticSdlcEvent): ParsedCheck | null {
  const payload = ev.payload ?? {};
  if (ev.github_event_type === "check_run") {
    const run = (payload as { check_run?: Record<string, unknown> }).check_run;
    if (!run) return null;
    const status = normaliseStatus(run.status as string | undefined);
    return {
      external_id: stringOrNull(run.id) ?? `${ev.github_delivery_id ?? "anon"}:check_run`,
      check_name: (run.name as string | undefined) ?? "check",
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(run.conclusion as string | null | undefined)
          : "pending",
      details_url: (run.details_url as string | undefined) ?? null,
      started_at: (run.started_at as string | undefined) ?? null,
      completed_at: (run.completed_at as string | undefined) ?? null,
      head_sha: (run.head_sha as string | undefined) ?? null,
      occurred_at: ev.occurred_at,
    };
  }

  if (ev.github_event_type === "check_suite") {
    const suite = (payload as { check_suite?: Record<string, unknown> }).check_suite;
    if (!suite) return null;
    const status = normaliseStatus(suite.status as string | undefined);
    return {
      external_id: stringOrNull(suite.id) ?? `${ev.github_delivery_id ?? "anon"}:check_suite`,
      check_name: "check_suite",
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(suite.conclusion as string | null | undefined)
          : "pending",
      details_url: (suite.url as string | undefined) ?? null,
      started_at: null,
      completed_at: (suite.updated_at as string | undefined) ?? null,
      head_sha: (suite.head_sha as string | undefined) ?? null,
      occurred_at: ev.occurred_at,
    };
  }

  if (ev.github_event_type === "workflow_run") {
    const run = (payload as { workflow_run?: Record<string, unknown> }).workflow_run;
    if (!run) return null;
    const status = normaliseStatus(run.status as string | undefined);
    return {
      external_id: stringOrNull(run.id) ?? `${ev.github_delivery_id ?? "anon"}:workflow_run`,
      check_name: (run.name as string | undefined) ?? "workflow",
      status,
      conclusion:
        status === "completed"
          ? normaliseConclusion(run.conclusion as string | null | undefined)
          : "pending",
      details_url: (run.html_url as string | undefined) ?? null,
      started_at: (run.run_started_at as string | undefined) ?? null,
      completed_at: (run.updated_at as string | undefined) ?? null,
      head_sha: (run.head_sha as string | undefined) ?? null,
      occurred_at: ev.occurred_at,
    };
  }

  return null;
}

/**
 * Merge a fresh CI event into the existing summary, replacing the
 * row for `check_name` if it already exists. Pure: returns a new
 * summary without mutating the input.
 *
 * We model "latest per check_name" in two layers:
 *   1. An internal map of check_name → ParsedCheck, kept in the
 *      summary via `_runs` (omitted from the persisted shape; see
 *      `toStoredSummary`).
 *   2. The aggregate counts used by the UI.
 *
 * For pilot scale (<25 repos, modest CI activity) reconstructing the
 * map per event by reading recent CI events from Mongo is acceptable.
 * The worker reads the per-PR check history before computing the
 * merged summary.
 */
export function mergeCiSummary(
  previous: ArtifactCiSummary | null | undefined,
  parsed: ParsedCheck,
  history: ParsedCheck[],
): ArtifactCiSummary {
  const latestPerName = new Map<string, ParsedCheck>();
  for (const item of history) {
    const existing = latestPerName.get(item.check_name);
    if (!existing || item.occurred_at >= existing.occurred_at) {
      latestPerName.set(item.check_name, item);
    }
  }
  // The freshly-parsed event always wins for its check_name.
  latestPerName.set(parsed.check_name, parsed);

  const byConclusion: Partial<Record<CiConclusion, number>> = {};
  let anyInProgress = false;
  let latestEventAt = previous?.last_event_at
    ? new Date(previous.last_event_at)
    : null;

  for (const item of latestPerName.values()) {
    const conclusion: CiConclusion =
      item.status === "completed" ? item.conclusion : "pending";
    byConclusion[conclusion] = (byConclusion[conclusion] ?? 0) + 1;
    if (item.status !== "completed") anyInProgress = true;
    if (!latestEventAt || item.occurred_at > latestEventAt) {
      latestEventAt = item.occurred_at;
    }
  }

  const aggregate: CiConclusion = aggregateConclusion(byConclusion);
  const aggregateStatus: CiStatus = anyInProgress ? "in_progress" : "completed";

  return {
    conclusion: aggregate,
    status: aggregateStatus,
    by_conclusion: byConclusion,
    total: latestPerName.size,
    last_event_at: (latestEventAt ?? parsed.occurred_at).toISOString(),
  };
}

/**
 * Aggregate per-conclusion counts into a single summary conclusion.
 *
 * Precedence (worst wins, so users see the most important state):
 *   failure | timed_out | action_required > pending > neutral / skipped > success > unknown
 */
function aggregateConclusion(
  counts: Partial<Record<CiConclusion, number>>,
): CiConclusion {
  if (
    (counts.failure ?? 0) > 0 ||
    (counts.timed_out ?? 0) > 0 ||
    (counts.action_required ?? 0) > 0
  ) {
    return (counts.failure ?? 0) > 0
      ? "failure"
      : (counts.timed_out ?? 0) > 0
        ? "timed_out"
        : "action_required";
  }
  if ((counts.pending ?? 0) > 0) return "pending";
  if ((counts.cancelled ?? 0) > 0) return "cancelled";
  if ((counts.success ?? 0) > 0) return "success";
  if ((counts.neutral ?? 0) > 0) return "neutral";
  if ((counts.skipped ?? 0) > 0) return "skipped";
  return "unknown";
}

/**
 * Build a CI artifact patch from the freshly delivered event plus the
 * prior CI events on the same artifact. The worker is responsible for
 * loading `history` from the events collection scoped to this artifact.
 *
 * Returns `null` when the event cannot be linked to a tracked PR or
 * carries no usable check payload.
 */
export function projectCiEvent(
  ev: AgenticSdlcEvent,
  history: AgenticSdlcEvent[],
  prior: AgenticSdlcArtifact | null,
): CiArtifactPatch | null {
  const artifactId = ciEventArtifactId(ev);
  if (!artifactId) return null;
  const parsed = parseCiEvent(ev);
  if (!parsed) return null;
  const parsedHistory = history
    .map(parseCiEvent)
    .filter((c): c is ParsedCheck => c !== null);
  const merged = mergeCiSummary(prior?.ci_summary ?? null, parsed, parsedHistory);
  return {
    repo_id: ev.repo_id,
    artifact_id: artifactId,
    head_sha: parsed.head_sha ?? prior?.head_sha ?? null,
    ci_summary: merged,
    last_event_at: ev.occurred_at,
  };
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

export const CI_EVENT_TYPES_SET = CI_EVENT_TYPES;
