/**
 * @jest-environment node
 *
 * Unit tests for `lib/agentic-sdlc/repo-insights.ts`. We mock the
 * Mongo collection helpers directly and assert the shape returned by
 * each aggregation helper.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

const mockGetArtifactsCollection = jest.fn();
const mockGetEventsCollection = jest.fn();

jest.mock("@/lib/agentic-sdlc/mongo-collections", () => ({
  __esModule: true,
  getAgenticSdlcArtifactsCollection: () => mockGetArtifactsCollection(),
  getAgenticSdlcEventsCollection: () => mockGetEventsCollection(),
}));

const REPO_ID = "r1";

function findCursor<T>(rows: T[]) {
  return {
    toArray: jest.fn().mockResolvedValue(rows),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
}

describe("getInFlightCi", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
  });

  it("returns each in-flight artifact with its CI summary and counts pending+failure", async () => {
    const find = jest.fn().mockReturnValue(
      findCursor([
        {
          artifact_id: "PR_1",
          kind: "pull_request",
          title: "open PR with failing CI",
          current_stage: "review_hitl",
          github_url: "u1",
          state: "open",
          head_sha: "aaa",
          ci_summary: {
            conclusion: "failure",
            status: "completed",
            by_conclusion: { failure: 1, success: 1 },
            total: 2,
            last_event_at: "2026-05-22T00:01:00Z",
          },
          last_event_at: new Date("2026-05-22T00:02:00Z"),
        },
        {
          artifact_id: "PR_2",
          kind: "pull_request",
          title: "open PR still building",
          current_stage: "implement",
          github_url: "u2",
          state: "open",
          head_sha: "bbb",
          ci_summary: {
            conclusion: "pending",
            status: "in_progress",
            by_conclusion: { pending: 1 },
            total: 1,
            last_event_at: "2026-05-22T00:00:30Z",
          },
          last_event_at: new Date("2026-05-22T00:01:00Z"),
        },
        {
          artifact_id: "ST_1",
          kind: "subtask",
          title: "task without CI events yet",
          current_stage: "implement",
          github_url: "u3",
          state: "open",
          head_sha: null,
          ci_summary: null,
          last_event_at: new Date("2026-05-22T00:00:00Z"),
        },
      ]),
    );
    mockGetArtifactsCollection.mockResolvedValue({ find });

    const { getInFlightCi } = await import("@/lib/agentic-sdlc/repo-insights");
    const result = await getInFlightCi(REPO_ID);

    expect(result.items).toHaveLength(3);
    expect(result.totals).toEqual({
      success: 0,
      failure: 1,
      pending: 1,
      no_ci: 1,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_id: REPO_ID,
        kind: { $in: ["pull_request", "subtask"] },
        state: { $nin: ["closed", "merged", "cancelled"] },
      }),
      expect.any(Object),
    );
  });
});

describe("getChangelogEntries", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
  });

  it("returns merged epics, merged PRs, and successful deploys in the window", async () => {
    const find = jest.fn().mockReturnValue(
      findCursor([
        {
          artifact_id: "PR_1",
          kind: "pull_request",
          title: "feat: shipped",
          body_excerpt: "Body excerpt",
          state: "merged",
          epic_id: "EP_1",
          github_url: "https://github.com/o/r/pull/1",
          labels: ["agent:awaiting-review"],
          agent_labels: ["agent:awaiting-review"],
          last_event_at: new Date("2026-05-21T10:00:00Z"),
        },
        {
          artifact_id: "EP_1",
          kind: "epic",
          title: "Epic shipped",
          body_excerpt: "Epic done",
          state: "closed",
          epic_id: "EP_1",
          github_url: "https://github.com/o/r/issues/100",
          labels: ["epic"],
          agent_labels: [],
          last_event_at: new Date("2026-05-21T11:00:00Z"),
        },
        {
          artifact_id: "DEP_1",
          kind: "deploy",
          title: "Deploy → sandbox",
          body_excerpt: "ok",
          state: "success",
          epic_id: "EP_1",
          github_url: "https://github.com/o/r/deployments",
          labels: [],
          agent_labels: [],
          last_event_at: new Date("2026-05-21T12:00:00Z"),
        },
      ]),
    );
    mockGetArtifactsCollection.mockResolvedValue({ find });

    const { getChangelogEntries } = await import(
      "@/lib/agentic-sdlc/repo-insights"
    );
    const entries = await getChangelogEntries(REPO_ID, { lookbackDays: 7 });
    expect(entries.map((e) => e.kind)).toEqual([
      "pull_request_merged",
      "epic_closed",
      "deploy_succeeded",
    ]);
    expect(entries[0].actor_kind).toBe("agent");
    expect(entries[1].actor_kind).toBe("human");
  });
});

describe("getRecentSnapshots", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
  });

  it("combines workflow_run events, deploy artifacts, and recent agentic artifacts, sorted by recency", async () => {
    const eventsFind = jest.fn().mockReturnValue(
      findCursor([
        {
          payload: {
            workflow_run: {
              id: 1,
              name: "CI",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/o/r/actions/runs/1",
            },
          },
          occurred_at: new Date("2026-05-22T05:00:00Z"),
          github_delivery_id: "d-1",
        },
      ]),
    );
    const artifactsFind = jest
      .fn()
      .mockReturnValueOnce(
        // First call: deploy artifacts
        findCursor([
          {
            artifact_id: "DEP_1",
            title: "Deploy → sandbox",
            state: "success",
            body_excerpt: "ok",
            github_url: "https://github.com/o/r/deployments",
            last_event_at: new Date("2026-05-22T04:00:00Z"),
            labels: [],
          },
        ]),
      )
      .mockReturnValueOnce(
        // Second call: recent agentic artifacts
        findCursor([
          {
            artifact_id: "PR_1",
            kind: "pull_request",
            title: "PR title",
            state: "open",
            current_stage: "implement",
            github_url: "https://github.com/o/r/pull/1",
            last_event_at: new Date("2026-05-22T06:00:00Z"),
          },
        ]),
      );

    mockGetEventsCollection.mockResolvedValue({ find: eventsFind });
    mockGetArtifactsCollection.mockResolvedValue({ find: artifactsFind });

    const { getRecentSnapshots } = await import(
      "@/lib/agentic-sdlc/repo-insights"
    );
    const result = await getRecentSnapshots(REPO_ID, { recentRuns: 5 });

    expect(result.items.map((i) => i.kind)).toEqual([
      "agentic_artifact",
      "github_actions_artifact",
      "deploy_snapshot",
    ]);
    expect(result.by_kind).toEqual({
      github_actions_artifact: 1,
      deploy_snapshot: 1,
      agentic_artifact: 1,
    });
    expect(result.items[1].tone).toBe("success");
    expect(result.items[2].tone).toBe("success");
  });
});

describe("getDeploymentHealth", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
  });

  it("groups deploys per environment with success/failure totals and recent records", async () => {
    const eventsFind = jest.fn().mockReturnValue(
      findCursor([
        {
          payload: {
            deployment: {
              node_id: "DEP_2",
              environment: "sandbox",
              created_at: "2026-05-22T05:55:00Z",
            },
            deployment_status: {
              state: "failure",
              description: "OOM in worker pod",
              target_url: "https://logs/2",
              updated_at: "2026-05-22T06:01:00Z",
            },
          },
          occurred_at: new Date("2026-05-22T06:01:00Z"),
          epic_id: null,
          artifact_id: "DEP_2",
        },
        {
          payload: {
            deployment: {
              node_id: "DEP_1",
              environment: "sandbox",
              created_at: "2026-05-22T04:00:00Z",
            },
            deployment_status: {
              state: "success",
              description: "rollout ok",
              target_url: "https://logs/1",
              updated_at: "2026-05-22T04:05:00Z",
            },
          },
          occurred_at: new Date("2026-05-22T04:05:00Z"),
          epic_id: null,
          artifact_id: "DEP_1",
        },
      ]),
    );

    const artifactsFind = jest.fn().mockReturnValue(findCursor([]));

    mockGetEventsCollection.mockResolvedValue({ find: eventsFind });
    mockGetArtifactsCollection.mockResolvedValue({ find: artifactsFind });

    const { getDeploymentHealth } = await import(
      "@/lib/agentic-sdlc/repo-insights"
    );
    const result = await getDeploymentHealth(REPO_ID, { windowHours: 24 });

    expect(result.environments).toHaveLength(1);
    const sandbox = result.environments[0];
    expect(sandbox.environment).toBe("sandbox");
    // Latest is the failure → environment is "failing"
    expect(sandbox.health).toBe("failing");
    expect(sandbox.success_count).toBe(1);
    expect(sandbox.failure_count).toBe(1);
    expect(sandbox.recent_deploys[0].id).toBe("DEP_2");
    expect(sandbox.recent_deploys[0].failure_reason).toContain("OOM");
    expect(result.totals.success).toBe(1);
    expect(result.totals.failure).toBe(1);
  });

  it("falls back to deploy artifacts when no events match the window", async () => {
    const eventsFind = jest.fn().mockReturnValue(findCursor([]));
    const artifactsFind = jest.fn().mockReturnValue(
      findCursor([
        {
          artifact_id: "DEP_OLD",
          title: "Deploy → sandbox",
          state: "success",
          body_excerpt: "ok",
          github_url: "u",
          last_event_at: new Date("2026-05-15T10:00:00Z"),
          created_at: new Date("2026-05-15T09:55:00Z"),
          epic_id: null,
        },
      ]),
    );

    mockGetEventsCollection.mockResolvedValue({ find: eventsFind });
    mockGetArtifactsCollection.mockResolvedValue({ find: artifactsFind });

    const { getDeploymentHealth } = await import(
      "@/lib/agentic-sdlc/repo-insights"
    );
    const result = await getDeploymentHealth(REPO_ID, { windowHours: 168 });
    expect(result.environments).toHaveLength(1);
    expect(result.environments[0].environment).toBe("sandbox");
    expect(result.environments[0].success_count).toBe(1);
  });
});
