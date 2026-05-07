/**
 * GET /api/agentic-sdlc/metrics
 *
 * Portfolio-level operating metrics for the Agentic SDLC Metrics tab.
 * Values are derived from onboarded repos, projected artifacts, and
 * webhook/event history so the dashboard graphs stay live.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import type { AgenticSdlcStage } from "@/types/agentic-sdlc";

interface StagePressureRow {
  repo_id: string;
  repo_name: string;
  stage: AgenticSdlcStage;
  count: number;
}

interface VelocityPoint {
  date: string;
  count: number;
}

async function handle(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }

  const repos = await getAgenticSdlcReposCollection();
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const events = await getAgenticSdlcEventsCollection();

  const now = new Date();
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since10d = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const [reposInScope, repoDocs] = await Promise.all([
    repos.countDocuments({ offboarded_at: null }),
    repos
      .find(
        { offboarded_at: null },
        {
          projection: { _id: 0, repo_id: 1, full_name: 1 },
          sort: { webhook_last_event_at: -1, updated_at: -1 },
          limit: 250,
        },
      )
      .toArray(),
  ]);

  const repoIds = repoDocs.map((repo) => repo.repo_id);
  const repoNameById = new Map(
    repoDocs.map((repo) => [repo.repo_id, repo.full_name]),
  );
  const repoScopeFilter = { repo_id: { $in: repoIds } };

  const [hitlQueueCount, velocity30d, pressureRows, velocityRows, tokenRows] =
    await Promise.all([
      artifacts.countDocuments({
        ...repoScopeFilter,
        $or: [
          { needs_human: true },
          { kind: "pull_request", state: "open", current_stage: "review_hitl" },
        ],
      }),
      artifacts.countDocuments({
        ...repoScopeFilter,
        kind: "epic",
        state: { $in: ["closed", "merged"] },
        last_event_at: { $gte: since30d },
      }),
      artifacts
        .aggregate<{
          _id: { repo_id: string; current_stage: AgenticSdlcStage };
          count: number;
        }>([
          {
            $match: {
              ...repoScopeFilter,
              state: { $nin: ["closed", "merged", "cancelled"] },
            },
          },
          {
            $group: {
              _id: {
                repo_id: "$repo_id",
                current_stage: "$current_stage",
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, "_id.repo_id": 1, "_id.current_stage": 1 } },
          { $limit: 80 },
        ])
        .toArray(),
      events
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              ...repoScopeFilter,
              occurred_at: { $gte: since10d },
              artifact_kind: { $in: ["epic", "pull_request", "deploy"] },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: "$occurred_at",
                  timezone: "UTC",
                },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      events
        .aggregate<{ total_tokens: number }>([
          {
            $match: {
              ...repoScopeFilter,
              occurred_at: { $gte: since30d },
            },
          },
          {
            $project: {
              total_tokens: {
                $ifNull: [
                  "$payload.usage.total_tokens",
                  {
                    $ifNull: [
                      "$payload.token_usage.total_tokens",
                      { $ifNull: ["$payload.total_tokens", 0] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              total_tokens: { $sum: "$total_tokens" },
            },
          },
        ])
        .toArray(),
    ]);

  const stagePressure: StagePressureRow[] = pressureRows.map((row) => ({
    repo_id: row._id.repo_id,
    repo_name: repoNameById.get(row._id.repo_id) ?? row._id.repo_id,
    stage: row._id.current_stage,
    count: row.count,
  }));

  const velocitySeries: VelocityPoint[] = velocityRows.map((row) => ({
    date: row._id,
    count: row.count,
  }));

  return Response.json({
    generated_at: now.toISOString(),
    summary: {
      repos_in_scope: reposInScope,
      hitl_queue_count: hitlQueueCount,
      velocity_30d: velocity30d,
      token_spend_total: tokenRows[0]?.total_tokens ?? 0,
    },
    stage_pressure: stagePressure,
    velocity_series: velocitySeries,
  });
}

export const GET = withAgenticSdlcGate(handle);
