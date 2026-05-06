/**
 * GET /api/ship-loop/repos/{owner}/{repo}/epics/{epicId}
 *
 * Full Epic detail: the Epic artifact, every child sub-task / PR /
 * deploy, the 100 most recent events, and a `needs_me` array of
 * artifact ids that require the caller's review/approval.
 *
 * Response shape mirrors contracts/http-api.md exactly. Events are
 * emitted with the raw `payload` field stripped because the SSE
 * channel does the same (security note in
 * contracts/sse-channels.md): the projected summary is enough for
 * the timeline view, and we don't want untrusted GitHub markdown to
 * cross the wire by accident.
 *
 * `needs_me` is computed from the Epic's PR/sub-task children: a
 * caller "needs to act" when their email's local-part appears in
 * `requested_reviewers` or `assignees`. This is a best-effort match
 * for the mock-flow demo; the real GitHub-OAuth-driven version
 * (FR-029) will land alongside repo visibility filtering.
 */

import {
  getShipLoopArtifactsCollection,
  getShipLoopEventsCollection,
  getShipLoopReposCollection,
} from "@/lib/ship-loop/mongo-collections";
import { withShipLoopGate } from "@/lib/ship-loop/guard";
import { requireShipLoopReader } from "@/lib/ship-loop/ship-loop-auth";
import type { ShipLoopArtifact, ShipLoopEvent } from "@/types/ship-loop";

const RECENT_EVENTS_LIMIT = 100;

interface EpicDetailResponse {
  epic: ShipLoopArtifact;
  subtasks: ShipLoopArtifact[];
  pull_requests: ShipLoopArtifact[];
  deploys: ShipLoopArtifact[];
  recent_events: SafeEvent[];
  needs_me: string[];
}

type SafeEvent = Omit<ShipLoopEvent, "payload" | "_id">;

function stripPayload(ev: ShipLoopEvent): SafeEvent {
  // Strip both `payload` and the Mongo-internal _id so the JSON is
  // stable and free of un-sanitised user content. The summary fields
  // we keep -- artifact_kind/id, actor_*, github_event_type/action,
  // timestamps, projection_status -- are all derived server-side.
  const { _id: _ignoredId, payload: _ignoredPayload, ...rest } = ev as ShipLoopEvent & {
    _id?: unknown;
  };
  void _ignoredId;
  void _ignoredPayload;
  return rest;
}

function localPartOfEmail(email: string): string {
  const at = email.indexOf("@");
  return at < 0 ? email : email.slice(0, at);
}

function computeNeedsMe(
  callerEmail: string,
  artifacts: ShipLoopArtifact[],
): string[] {
  const handle = localPartOfEmail(callerEmail).toLowerCase();
  const needs = new Set<string>();
  for (const a of artifacts) {
    if (a.kind !== "pull_request" && a.kind !== "subtask") continue;
    const reviewers = (a.requested_reviewers ?? []).map((r) => r.toLowerCase());
    const assignees = (a.assignees ?? []).map((r) => r.toLowerCase());
    if (reviewers.includes(handle) || assignees.includes(handle)) {
      needs.add(a.artifact_id);
    }
  }
  return Array.from(needs);
}

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string; epicId: string }> },
): Promise<Response> {
  const reader = await requireShipLoopReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo, epicId } = await ctx.params;

  const repos = await getShipLoopReposCollection();
  const repoDoc = await repos.findOne(
    { owner, name: repo, offboarded_at: null },
    { projection: { repo_id: 1 } },
  );
  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const artifacts = await getShipLoopArtifactsCollection();
  const events = await getShipLoopEventsCollection();

  const [epic, children, recent] = await Promise.all([
    artifacts.findOne({
      repo_id: repoDoc.repo_id,
      kind: "epic",
      artifact_id: epicId,
    }),
    artifacts
      .find({ repo_id: repoDoc.repo_id, epic_id: epicId })
      .sort({ last_event_at: -1 })
      .toArray(),
    events
      .find({ repo_id: repoDoc.repo_id, epic_id: epicId })
      .sort({ delivered_at: -1 })
      .limit(RECENT_EVENTS_LIMIT)
      .toArray(),
  ]);

  if (!epic) {
    return Response.json(
      { error: "not_found", message: "Epic not found." },
      { status: 404 },
    );
  }

  const subtasks: ShipLoopArtifact[] = [];
  const pull_requests: ShipLoopArtifact[] = [];
  const deploys: ShipLoopArtifact[] = [];
  for (const c of children) {
    if (c.kind === "subtask") subtasks.push(c);
    else if (c.kind === "pull_request") pull_requests.push(c);
    else if (c.kind === "deploy") deploys.push(c);
  }

  const body: EpicDetailResponse = {
    epic,
    subtasks,
    pull_requests,
    deploys,
    recent_events: recent.map(stripPayload),
    needs_me: computeNeedsMe(reader.user.email, [
      ...subtasks,
      ...pull_requests,
    ]),
  };
  return Response.json(body);
}

export const GET = withShipLoopGate(handle);
