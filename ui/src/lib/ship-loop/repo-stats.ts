/**
 * Aggregations for the repo list and repo detail responses.
 *
 * `child_counts` and `counts` are derived from `ship_loop_artifacts`
 * (current state) plus a small lookback into `ship_loop_events` for
 * the "deploys in last 24h" field. Pure server-side; no caching yet
 * because pilot scale (≤25 repos) makes the round trip free.
 */

import {
  getShipLoopArtifactsCollection,
  getShipLoopEventsCollection,
} from "@/lib/ship-loop/mongo-collections";

export interface RepoCounts {
  open_epics: number;
  in_flight_subtasks: number;
  prs_awaiting_review: number;
  deploys_24h: number;
}

export const ZERO_REPO_COUNTS: RepoCounts = {
  open_epics: 0,
  in_flight_subtasks: 0,
  prs_awaiting_review: 0,
  deploys_24h: 0,
};

/**
 * Compute counts for a single repo. One artifact aggregation
 * (group-by-kind+state+stage) plus one event count for deploys in
 * the last 24h. The aggregation pipeline runs entirely on indexed
 * fields (`repo_id`, `kind`, `state`, `current_stage`).
 */
export async function getRepoCounts(repoId: string): Promise<RepoCounts> {
  const artifacts = await getShipLoopArtifactsCollection();
  const events = await getShipLoopEventsCollection();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [counts, deploys24h] = await Promise.all([
    artifacts
      .aggregate<{
        _id: { kind: string; state: string; current_stage: string };
        n: number;
      }>([
        { $match: { repo_id: repoId } },
        {
          $group: {
            _id: {
              kind: "$kind",
              state: "$state",
              current_stage: "$current_stage",
            },
            n: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    events.countDocuments({
      repo_id: repoId,
      artifact_kind: "deploy",
      delivered_at: { $gte: since },
    }),
  ]);

  let open_epics = 0;
  let in_flight_subtasks = 0;
  let prs_awaiting_review = 0;

  for (const row of counts) {
    const { kind, state, current_stage } = row._id;
    if (kind === "epic" && state !== "closed" && state !== "merged") {
      open_epics += row.n;
    } else if (
      kind === "subtask" &&
      state !== "closed" &&
      state !== "merged"
    ) {
      in_flight_subtasks += row.n;
    } else if (
      kind === "pull_request" &&
      state === "open" &&
      current_stage === "review_hitl"
    ) {
      prs_awaiting_review += row.n;
    }
  }

  return {
    open_epics,
    in_flight_subtasks,
    prs_awaiting_review,
    deploys_24h: deploys24h,
  };
}
