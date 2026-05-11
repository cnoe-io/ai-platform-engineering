/**
 * Aggregations for the repo list and repo detail responses.
 *
 * `child_counts` and `counts` are derived from `ship_loop_artifacts`
 * (current state) plus a small lookback into `ship_loop_events` for
 * the "deploys in last 24h" field. Pure server-side; no caching yet
 * because pilot scale (≤25 repos) makes the round trip free.
 */

import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcEventsCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import type { AgenticSdlcStage, ArtifactKindStored } from "@/types/agentic-sdlc";

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

export interface RepoStageCount {
  stage: AgenticSdlcStage;
  count: number;
}

export interface RepoHumanQueueItem {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  github_url: string;
  last_event_at: string;
}

export interface RepoSwimLaneItem {
  artifact_id: string;
  kind: ArtifactKindStored;
  title: string;
  current_stage: AgenticSdlcStage;
  actor_kind: "agent" | "human" | "system";
  agent_label: string | null;
  agent_name: string | null;
  status_label: string | null;
  escalation_labels: string[];
  github_url: string;
  last_event_at: string;
}

export interface RepoSwimLane {
  stage: AgenticSdlcStage;
  items: RepoSwimLaneItem[];
}

export interface RepoOperatingSummary {
  activity_24h: number;
  stage_counts: RepoStageCount[];
  human_queue: {
    needs_human_count: number;
    oldest_waiting_since: string | null;
    items: RepoHumanQueueItem[];
  };
  swim_lanes: RepoSwimLane[];
}

/**
 * Compute counts for a single repo. One artifact aggregation
 * (group-by-kind+state+stage) plus one event count for deploys in
 * the last 24h. The aggregation pipeline runs entirely on indexed
 * fields (`repo_id`, `kind`, `state`, `current_stage`).
 */
export async function getRepoCounts(repoId: string): Promise<RepoCounts> {
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const events = await getAgenticSdlcEventsCollection();

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

export async function getRepoOperatingSummary(
  repoId: string,
): Promise<RepoOperatingSummary> {
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const events = await getAgenticSdlcEventsCollection();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [stageRows, humanRows, swimLaneRows, activity24h] = await Promise.all([
    artifacts
      .aggregate<{ _id: AgenticSdlcStage; n: number }>([
        {
          $match: {
            repo_id: repoId,
            state: { $nin: ["closed", "merged", "cancelled"] },
          },
        },
        { $group: { _id: "$current_stage", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ])
      .toArray(),
    artifacts
      .find(
        {
          repo_id: repoId,
          $or: [
            { needs_human: true },
            { kind: "pull_request", state: "open", current_stage: "review_hitl" },
          ],
        },
        {
          projection: {
            _id: 0,
            artifact_id: 1,
            kind: 1,
            title: 1,
            current_stage: 1,
            github_url: 1,
            last_event_at: 1,
          },
          sort: { last_event_at: 1 },
          limit: 5,
        },
      )
      .toArray(),
    artifacts
      .find(
        {
          repo_id: repoId,
          state: { $nin: ["closed", "merged", "cancelled"] },
        },
        {
          projection: {
            _id: 0,
            artifact_id: 1,
            kind: 1,
            title: 1,
            current_stage: 1,
            needs_human: 1,
            labels: 1,
            agent_labels: 1,
            github_url: 1,
            last_event_at: 1,
          },
          sort: { last_event_at: -1 },
          limit: 50,
        },
      )
      .toArray(),
    events.countDocuments({
      repo_id: repoId,
      occurred_at: { $gte: since },
    }),
  ]);

  const items = humanRows.map((row) => ({
    artifact_id: row.artifact_id,
    kind: row.kind,
    title: row.title,
    current_stage: row.current_stage,
    github_url: row.github_url,
    last_event_at: row.last_event_at.toISOString(),
  }));

  return {
    activity_24h: activity24h,
    stage_counts: stageRows.map((row) => ({
      stage: row._id,
      count: row.n,
    })),
    human_queue: {
      needs_human_count: items.length,
      oldest_waiting_since: items[0]?.last_event_at ?? null,
      items,
    },
    swim_lanes: buildSwimLanes(swimLaneRows),
  };
}

function buildSwimLanes(
  rows: Array<{
    artifact_id: string;
    kind: ArtifactKindStored;
    title: string;
    current_stage: AgenticSdlcStage;
    needs_human?: boolean;
    labels?: string[];
    agent_labels?: string[];
    github_url: string;
    last_event_at: Date;
  }>,
): RepoSwimLane[] {
  const lanes = new Map<AgenticSdlcStage, RepoSwimLaneItem[]>();

  for (const row of rows) {
    const items = lanes.get(row.current_stage) ?? [];
    const labels = row.labels ?? [];
    const persona = deriveAgentPersona([...(row.agent_labels ?? []), ...labels]);
    items.push({
      artifact_id: row.artifact_id,
      kind: row.kind,
      title: row.title,
      current_stage: row.current_stage,
      actor_kind:
        row.needs_human || row.current_stage === "review_hitl"
          ? "human"
          : persona.agent_label
            ? "agent"
            : "system",
      agent_label: persona.agent_label,
      agent_name: persona.agent_name,
      status_label: labels.find((label) => label.startsWith("status:")) ?? null,
      escalation_labels: labels.filter((label) => label.startsWith("needs:")),
      github_url: row.github_url,
      last_event_at: row.last_event_at.toISOString(),
    });
    lanes.set(row.current_stage, items);
  }

  return Array.from(lanes.entries()).map(([stage, items]) => ({
    stage,
    items,
  }));
}

const AGENT_PERSONAS: Array<{ label: string; name: string }> = [
  { label: "agent:architect", name: "Architect" },
  { label: "agent:deep-think", name: "Deep Think" },
  { label: "agent:coder", name: "Coder" },
  { label: "agent:tester", name: "Tester" },
  { label: "agent:reviewer", name: "Reviewer" },
  { label: "agent:deployer", name: "Deployer" },
  { label: "agent:specify", name: "Specifier" },
  { label: "agent:plan", name: "Planner" },
  { label: "agent:tasks", name: "Tasker" },
  { label: "agent:implement", name: "Coder" },
  { label: "agent:unit-test", name: "Tester" },
  { label: "agent:test", name: "Tester" },
  { label: "agent:awaiting-review", name: "Reviewer" },
  { label: "agent:deploy-sandbox", name: "Deployer" },
  { label: "agent:validate", name: "Validator" },
  { label: "agent:observe", name: "Observer" },
];

function deriveAgentPersona(labels: string[]): {
  agent_label: string | null;
  agent_name: string | null;
} {
  for (const persona of AGENT_PERSONAS) {
    if (labels.includes(persona.label)) {
      return { agent_label: persona.label, agent_name: persona.name };
    }
  }
  return { agent_label: null, agent_name: null };
}

export const _internal = {
  deriveAgentPersona,
};
