/**
 * POST /api/agentic-sdlc/repos/{owner}/{repo}/simulate
 *
 * Seeds a local, non-mutating Agentic SDLC scenario for an onboarded repo. The
 * records are GitHub-shaped so the existing repo tile, Epic list, and Epic
 * timeline views can visualize a realistic agentic loop without creating
 * issues, PRs, labels, or deployments in GitHub.
 */

import {
  getAgenticSdlcArtifactsCollection,
  getAgenticSdlcEventsCollection,
  getAgenticSdlcReposCollection,
} from "@/lib/agentic-sdlc/mongo-collections";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import type {
  OnboardedRepo,
  AgenticSdlcArtifact,
  AgenticSdlcEvent,
} from "@/types/agentic-sdlc";

// assisted-by Codex Codex-sonnet-4-6

interface SimulationResponse {
  simulated: true;
  repo: string;
  epic_id: string;
  artifacts_created: number;
  events_created: number;
  message: string;
}

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
      {
        error: "not_found",
        message:
          "Repo must be onboarded before seeding a Agentic SDLC simulation.",
      },
      { status: 404 },
    );
  }

  const now = new Date();
  const scenario = buildAgenticLoopSimulation(repoDoc, now);
  const artifacts = await getAgenticSdlcArtifactsCollection();
  const events = await getAgenticSdlcEventsCollection();

  await events.deleteMany({
    repo_id: repoDoc.repo_id,
    github_delivery_id: { $regex: "^sim-" },
  });
  await artifacts.bulkWrite(
    scenario.artifacts.map((artifact) => {
      const { created_at, ...current } = artifact;
      return {
        updateOne: {
          filter: {
            repo_id: artifact.repo_id,
            kind: artifact.kind,
            artifact_id: artifact.artifact_id,
          },
          update: {
            $set: {
              ...current,
              updated_at: now,
            },
            $setOnInsert: {
              created_at,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
  await events.insertMany(scenario.events, { ordered: false });
  await repos.updateOne(
    { repo_id: repoDoc.repo_id },
    {
      $set: {
        webhook_status: "healthy",
        webhook_last_event_at: now,
        updated_at: now,
      },
    },
  );

  const body: SimulationResponse = {
    simulated: true,
    repo: repoDoc.full_name,
    epic_id: scenario.epicId,
    artifacts_created: scenario.artifacts.length,
    events_created: scenario.events.length,
    message:
      "Seeded a local agentic loop with GitHub-shaped issues, PR, labels, review, and deploy events.",
  };
  return Response.json(body, { status: 201 });
}

function buildAgenticLoopSimulation(
  repo: OnboardedRepo,
  now: Date,
): {
  epicId: string;
  artifacts: AgenticSdlcArtifact[];
  events: AgenticSdlcEvent[];
} {
  const epicId = "SIM_EPIC_AGENTIC_SPA";
  const specTaskId = "SIM_ISSUE_SPEC";
  const implTaskId = "SIM_ISSUE_IMPLEMENT";
  const prId = "SIM_PR_HITL";
  const deployId = "SIM_DEPLOY_SANDBOX";
  const t = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60 * 1000);
  const url = (path: string) => `https://github.com/${repo.full_name}/${path}`;

  const artifacts: AgenticSdlcArtifact[] = [
    {
      repo_id: repo.repo_id,
      kind: "epic",
      artifact_id: epicId,
      epic_id: epicId,
      parent_subtask_id: null,
      title: "Epic: Agentic SDLC simulation mode",
      body_excerpt:
        "Agents break a real repo request into issues, PRs, human review, merge, and sandbox deploy signals.",
      state: "open",
      current_stage: "review_hitl",
      assignees: ["agentic-sdlc-bot"],
      requested_reviewers: ["sraradhy"],
      labels: ["epic", "agent:awaiting-review", "agentic-sdlc:simulation"],
      agent_labels: ["agent:awaiting-review"],
      needs_human: true,
      stalled_since: null,
      last_event_at: t(1),
      github_url: url("issues/901"),
      created_at: t(24),
      updated_at: now,
    },
    {
      repo_id: repo.repo_id,
      kind: "subtask",
      artifact_id: specTaskId,
      epic_id: epicId,
      parent_subtask_id: null,
      title: "Specify loop entry contract and labels",
      body_excerpt:
        "Define the Epic acceptance criteria, expected agent labels, and webhook events.",
      state: "closed",
      current_stage: "tasks",
      assignees: ["agentic-sdlc-bot"],
      requested_reviewers: [],
      labels: ["agent:tasks", "agentic-sdlc:simulation"],
      agent_labels: ["agent:tasks"],
      needs_human: false,
      stalled_since: null,
      last_event_at: t(17),
      github_url: url("issues/902"),
      created_at: t(22),
      updated_at: now,
    },
    {
      repo_id: repo.repo_id,
      kind: "subtask",
      artifact_id: implTaskId,
      epic_id: epicId,
      parent_subtask_id: null,
      title: "Implement local simulator seed route",
      body_excerpt:
        "Create DB-backed synthetic GitHub events so the repo detail view becomes demoable.",
      state: "open",
      current_stage: "implement",
      assignees: ["agentic-sdlc-bot"],
      requested_reviewers: [],
      labels: ["agent:implement", "agentic-sdlc:simulation"],
      agent_labels: ["agent:implement"],
      needs_human: false,
      stalled_since: null,
      last_event_at: t(12),
      github_url: url("issues/903"),
      created_at: t(20),
      updated_at: now,
    },
    {
      repo_id: repo.repo_id,
      kind: "pull_request",
      artifact_id: prId,
      epic_id: epicId,
      parent_subtask_id: implTaskId,
      title: "feat(agentic-sdlc): add agentic simulation mode",
      body_excerpt:
        "Generated by the agent loop. Awaits human review before merge and sandbox rollout.",
      state: "open",
      current_stage: "review_hitl",
      assignees: ["agentic-sdlc-bot"],
      requested_reviewers: ["sraradhy"],
      labels: ["agent:awaiting-review", "agentic-sdlc:simulation"],
      agent_labels: ["agent:awaiting-review"],
      needs_human: true,
      stalled_since: null,
      last_event_at: t(5),
      github_url: url("pull/904"),
      created_at: t(10),
      updated_at: now,
    },
    {
      repo_id: repo.repo_id,
      kind: "deploy",
      artifact_id: deployId,
      epic_id: epicId,
      parent_subtask_id: null,
      title: `Deploy -> ${repo.sandbox_environment}`,
      body_excerpt:
        "Sandbox rollout queued by the simulation after PR review completion.",
      state: "in_progress",
      current_stage: "deploy",
      assignees: [],
      requested_reviewers: [],
      labels: ["agentic-sdlc:simulation"],
      agent_labels: [],
      needs_human: false,
      stalled_since: null,
      last_event_at: t(2),
      github_url: url("deployments/activity_log?environment=sandbox"),
      created_at: t(3),
      updated_at: now,
    },
  ];

  const events: AgenticSdlcEvent[] = [
    makeEvent(repo, "sim-issue-epic-opened", "issues", "opened", "epic", epicId, epicId, "agent", "agentic-sdlc-bot", t(24), {
      issue: issuePayload(repo, 901, artifacts[0]),
    }),
    makeEvent(repo, "sim-issue-epic-labeled", "issues", "labeled", "label", epicId, epicId, "agent", "agentic-sdlc-bot", t(18), {
      label: { name: "agent:awaiting-review" },
      issue: issuePayload(repo, 901, artifacts[0]),
    }),
    makeEvent(repo, "sim-issue-spec-task", "issues", "opened", "subtask", specTaskId, epicId, "agent", "agentic-sdlc-bot", t(22), {
      issue: issuePayload(repo, 902, artifacts[1]),
    }),
    makeEvent(repo, "sim-issue-impl-task", "issues", "opened", "subtask", implTaskId, epicId, "agent", "agentic-sdlc-bot", t(20), {
      issue: issuePayload(repo, 903, artifacts[2]),
    }),
    makeEvent(repo, "sim-pr-opened", "pull_request", "opened", "pull_request", prId, epicId, "agent", "agentic-sdlc-bot", t(10), {
      pull_request: pullRequestPayload(repo, 904, artifacts[3]),
    }),
    makeEvent(repo, "sim-deploy-sandbox", "deployment_status", "created", "deploy", deployId, epicId, "system", null, t(2), {
      deployment: {
        node_id: deployId,
        environment: repo.sandbox_environment,
      },
      deployment_status: {
        state: "in_progress",
        description: artifacts[4].body_excerpt,
        target_url: artifacts[4].github_url,
      },
    }),
  ];

  return { epicId, artifacts, events };
}

function makeEvent(
  repo: OnboardedRepo,
  deliveryId: string,
  eventType: string,
  action: string,
  artifactKind: AgenticSdlcEvent["artifact_kind"],
  artifactId: string,
  epicId: string,
  actorKind: AgenticSdlcEvent["actor_kind"],
  actorLogin: string | null,
  occurredAt: Date,
  payload: Record<string, unknown>,
): AgenticSdlcEvent {
  return {
    repo_id: repo.repo_id,
    source: "github",
    github_delivery_id: deliveryId,
    github_event_type: eventType,
    github_action: action,
    artifact_kind: artifactKind,
    artifact_id: artifactId,
    epic_id: epicId,
    actor_kind: actorKind,
    actor_login: actorLogin,
    payload,
    delivered_at: occurredAt,
    occurred_at: occurredAt,
    projection_status: "projected",
    projection_attempts: 1,
  };
}

function issuePayload(
  repo: OnboardedRepo,
  number: number,
  artifact: AgenticSdlcArtifact,
): Record<string, unknown> {
  return {
    node_id: artifact.artifact_id,
    number,
    title: artifact.title,
    body: artifact.body_excerpt,
    state: artifact.state === "closed" ? "closed" : "open",
    labels: artifact.labels.map((name) => ({ name })),
    assignees: artifact.assignees.map((login) => ({ login })),
    html_url: artifact.github_url,
    repository_url: `https://api.github.com/repos/${repo.full_name}`,
  };
}

function pullRequestPayload(
  repo: OnboardedRepo,
  number: number,
  artifact: AgenticSdlcArtifact,
): Record<string, unknown> {
  return {
    node_id: artifact.artifact_id,
    number,
    title: artifact.title,
    body: artifact.body_excerpt,
    state: "open",
    merged: false,
    labels: artifact.labels.map((name) => ({ name })),
    assignees: artifact.assignees.map((login) => ({ login })),
    requested_reviewers: artifact.requested_reviewers.map((login) => ({
      login,
    })),
    html_url: artifact.github_url,
    repository_url: `https://api.github.com/repos/${repo.full_name}`,
  };
}

export const POST = withAgenticSdlcGate(handle);
