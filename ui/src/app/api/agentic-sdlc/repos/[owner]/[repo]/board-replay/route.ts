/**
 * GET /api/agentic-sdlc/repos/{owner}/{repo}/board-replay
 *
 * Returns chronological board snapshots reconstructed from historical
 * projection-capable events.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { buildBoardReplaySnapshots } from "@/lib/agentic-sdlc/board-replay";
import type { AgenticSdlcEvent, OnboardedRepo } from "@/types/agentic-sdlc";

const DEFAULT_WINDOW_HOURS = 2;
const MAX_WINDOW_HOURS = 24;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_SOURCE_EVENTS = 5_000;
const PROJECTABLE_EVENT_TYPES = [
  "issues",
  "pull_request",
  "sub_issues",
  "deployment_status",
];

async function handle(
  req: Request,
  ctx: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const { owner, repo } = await ctx.params;
  const repos = await getAgenticSdlcReposCollection();
  const repoDoc = (await repos.findOne({
    owner,
    name: repo,
    offboarded_at: null,
  })) as OnboardedRepo | null;

  if (!repoDoc) {
    return Response.json(
      { error: "not_found", message: "Repo not onboarded." },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const windowHours = parsePositiveInt(
    url.searchParams.get("windowHours"),
    DEFAULT_WINDOW_HOURS,
    MAX_WINDOW_HOURS,
  );
  const limit = parsePositiveInt(
    url.searchParams.get("limit"),
    DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const now = new Date();
  const events = await getAgenticSdlcEventsCollection();
  const replayEvents = await events
    .find(
      {
        repo_id: repoDoc.repo_id,
        github_event_type: { $in: PROJECTABLE_EVENT_TYPES },
        occurred_at: { $lte: now },
      },
      {},
    )
    .sort({ occurred_at: 1, delivered_at: 1 })
    .limit(MAX_SOURCE_EVENTS)
    .toArray();

  const snapshots = buildBoardReplaySnapshots(
    replayEvents as AgenticSdlcEvent[],
    repoDoc,
    {
      snapshotSince: since,
      initialSnapshotAt: since,
    },
  ).slice(0, limit);

  return Response.json({
    repo: repoDoc.full_name,
    window_hours: windowHours,
    snapshots,
  });
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export const GET = withAgenticSdlcGate(handle);
