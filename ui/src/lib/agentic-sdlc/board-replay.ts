/**
 * Historical board replay folds projected GitHub events into point-in-time
 * swim-lane snapshots without mutating the live artifact store.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { buildSwimLanes, type RepoSwimLane } from "@/lib/agentic-sdlc/repo-stats";
import { projectEvent } from "@/lib/agentic-sdlc/projector";
import type {
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
  OnboardedRepo,
} from "@/types/agentic-sdlc";

export interface BoardReplaySnapshot {
  id: string;
  occurred_at: string;
  event_title: string;
  actor_label: string;
  artifact_id: string;
  swim_lanes: RepoSwimLane[];
}

export interface BoardReplayOptions {
  snapshotSince?: Date;
  initialSnapshotAt?: Date;
}

const PROJECTABLE_EVENT_TYPES = new Set([
  "issues",
  "pull_request",
  "sub_issues",
  "deployment_status",
]);

export function isProjectableReplayEvent(event: AgenticSdlcEvent): boolean {
  return Boolean(
    event.github_event_type && PROJECTABLE_EVENT_TYPES.has(event.github_event_type),
  );
}

export function buildBoardReplaySnapshots(
  events: AgenticSdlcEvent[],
  repo: OnboardedRepo,
  options: BoardReplayOptions = {},
): BoardReplaySnapshot[] {
  const artifacts = new Map<string, AgenticSdlcArtifact>();
  const snapshots: BoardReplaySnapshot[] = [];
  let initialSnapshotAdded = false;

  for (const event of events) {
    if (!isProjectableReplayEvent(event)) continue;
    if (
      shouldAddInitialSnapshot(event, artifacts.size, initialSnapshotAdded, options)
    ) {
      snapshots.push({
        id: "replay-start",
        occurred_at: (options.initialSnapshotAt ?? options.snapshotSince ?? event.occurred_at).toISOString(),
        event_title: "Board at replay start",
        actor_label: "system",
        artifact_id: "",
        swim_lanes: buildSnapshotLanes(artifacts),
      });
      initialSnapshotAdded = true;
    }

    const patch = projectEvent(event, repo);
    if (!patch) continue;

    const now = event.occurred_at;
    const existing = artifacts.get(artifactKey(patch.kind, patch.artifact_id));
    const artifact: AgenticSdlcArtifact = {
      ...patch,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    artifacts.set(artifactKey(artifact.kind, artifact.artifact_id), artifact);
    if (artifact.kind === "subtask") {
      artifacts.delete(artifactKey("epic", artifact.artifact_id));
    }

    if (options.snapshotSince && event.occurred_at < options.snapshotSince) {
      continue;
    }

    snapshots.push({
      id: snapshotId(event, snapshots.length),
      occurred_at: event.occurred_at.toISOString(),
      event_title: replayEventTitle(event, artifact.title),
      actor_label: event.actor_login ?? event.actor_kind,
      artifact_id: artifact.artifact_id,
      swim_lanes: buildSnapshotLanes(artifacts),
    });
  }

  if (!initialSnapshotAdded && options.snapshotSince && artifacts.size > 0) {
    snapshots.push({
      id: "replay-start",
      occurred_at: (options.initialSnapshotAt ?? options.snapshotSince).toISOString(),
      event_title: "Board at replay start",
      actor_label: "system",
      artifact_id: "",
      swim_lanes: buildSnapshotLanes(artifacts),
    });
  }

  return snapshots;
}

function shouldAddInitialSnapshot(
  event: AgenticSdlcEvent,
  artifactCount: number,
  initialSnapshotAdded: boolean,
  options: BoardReplayOptions,
): boolean {
  if (!options.snapshotSince || initialSnapshotAdded || artifactCount === 0) {
    return false;
  }
  return event.occurred_at >= options.snapshotSince;
}

function buildSnapshotLanes(
  artifacts: Map<string, AgenticSdlcArtifact>,
): RepoSwimLane[] {
  return buildSwimLanes(
    Array.from(artifacts.values()).sort(
      (a, b) => b.last_event_at.getTime() - a.last_event_at.getTime(),
    ),
  );
}

function artifactKey(kind: string, artifactId: string): string {
  return `${kind}:${artifactId}`;
}

function snapshotId(event: AgenticSdlcEvent, fallbackIndex: number): string {
  const objectId = event._id?.toString();
  if (objectId) return objectId;
  return [
    event.github_delivery_id ?? "replay",
    event.github_event_type ?? "event",
    event.artifact_id,
    fallbackIndex,
  ].join(":");
}

function replayEventTitle(event: AgenticSdlcEvent, title: string): string {
  const type = event.github_event_type?.replaceAll("_", " ") ?? "repo event";
  const action = event.github_action ? ` ${event.github_action}` : "";
  return `${type}${action}: ${title || event.artifact_id}`;
}
