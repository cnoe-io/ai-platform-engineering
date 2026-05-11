/**
 * @jest-environment node
 */

const mockGetReposCollection = jest.fn();
const mockGetArtifactsCollection = jest.fn();
const mockGetEventsCollection = jest.fn();
const mockReader = jest.fn();

jest.mock("@/lib/agentic-sdlc/mongo-collections", () => ({
  __esModule: true,
  getAgenticSdlcReposCollection: () => mockGetReposCollection(),
  getAgenticSdlcArtifactsCollection: () => mockGetArtifactsCollection(),
  getAgenticSdlcEventsCollection: () => mockGetEventsCollection(),
}));

jest.mock("@/lib/agentic-sdlc/agentic-sdlc-auth", () => ({
  __esModule: true,
  requireAgenticSdlcReader: () => mockReader(),
  isAgenticSdlcMockAuthAllowed: () => false,
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  getServerConfig: () => ({ shipLoopEnabled: true }),
  getConfig: () => true,
}));

const READER = {
  kind: "mock" as const,
  user: { email: "alice@example.com", name: "Alice" },
};

function makeArtifact(overrides: Record<string, unknown>) {
  return {
    repo_id: "99000001",
    kind: "subtask",
    artifact_id: "T_x",
    epic_id: "I_42",
    parent_subtask_id: null,
    title: "x",
    body_excerpt: "",
    state: "open",
    current_stage: "implement",
    assignees: [],
    requested_reviewers: [],
    labels: [],
    agent_labels: [],
    needs_human: false,
    stalled_since: null,
    last_event_at: new Date("2026-05-05T12:00:00Z"),
    github_url: "u",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}/epics/{epicId}", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/[epicId]/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/x/y/epics/I_1"),
      { params: Promise.resolve({ owner: "x", repo: "y", epicId: "I_1" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when repo is not onboarded", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/[epicId]/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/x/y/epics/I_1"),
      { params: Promise.resolve({ owner: "x", repo: "y", epicId: "I_1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when Epic does not exist", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ repo_id: "99000001" }),
    });
    const findCursor = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    };
    mockGetArtifactsCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue(findCursor),
    });
    mockGetEventsCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue(findCursor),
    });
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/[epicId]/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics/I_missing",
      ),
      {
        params: Promise.resolve({
          owner: "demoorg",
          repo: "agentic-demo",
          epicId: "I_missing",
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("buckets children by kind and computes needs_me from caller email", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ repo_id: "99000001" }),
    });

    const epic = makeArtifact({
      kind: "epic",
      artifact_id: "I_42",
      title: "Epic 42",
      epic_id: null,
    });
    const subPing = makeArtifact({
      kind: "subtask",
      artifact_id: "T_a",
      assignees: ["alice"], // <- alice@example.com
    });
    const subOther = makeArtifact({
      kind: "subtask",
      artifact_id: "T_b",
      assignees: ["bob"],
    });
    const prPing = makeArtifact({
      kind: "pull_request",
      artifact_id: "PR_1",
      requested_reviewers: ["ALICE"], // case-insensitive match
      current_stage: "review_hitl",
      needs_human: true,
    });
    const prSelfReview = makeArtifact({
      kind: "pull_request",
      artifact_id: "PR_2",
      requested_reviewers: ["bob"],
    });
    const deploy = makeArtifact({
      kind: "deploy",
      artifact_id: "D_1",
      current_stage: "deploy",
    });

    const childrenCursor = {
      sort: jest.fn().mockReturnThis(),
      toArray: jest
        .fn()
        .mockResolvedValue([subPing, subOther, prPing, prSelfReview, deploy]),
    };
    const eventsCursor = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([
        {
          repo_id: "99000001",
          source: "github",
          github_delivery_id: "d-1",
          github_event_type: "issues",
          github_action: "opened",
          artifact_kind: "epic",
          artifact_id: "I_42",
          epic_id: "I_42",
          actor_kind: "human",
          actor_login: "alice",
          payload: { secret: "must-not-leak" },
          delivered_at: new Date("2026-05-05T12:00:00Z"),
          occurred_at: new Date("2026-05-05T12:00:00Z"),
          projection_status: "projected",
          projection_attempts: 1,
          _id: "fake-mongo-id",
        },
      ]),
    };

    mockGetArtifactsCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(epic),
      find: jest.fn().mockReturnValue(childrenCursor),
    });
    mockGetEventsCollection.mockResolvedValue({
      find: jest.fn().mockReturnValue(eventsCursor),
    });

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/[epicId]/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics/I_42",
      ),
      {
        params: Promise.resolve({
          owner: "demoorg",
          repo: "agentic-demo",
          epicId: "I_42",
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.epic.artifact_id).toBe("I_42");
    expect(body.subtasks.map((s: { artifact_id: string }) => s.artifact_id)).toEqual([
      "T_a",
      "T_b",
    ]);
    expect(
      body.pull_requests.map((p: { artifact_id: string }) => p.artifact_id),
    ).toEqual(["PR_1", "PR_2"]);
    expect(body.deploys.map((d: { artifact_id: string }) => d.artifact_id)).toEqual([
      "D_1",
    ]);

    // needs_me: T_a (assignee alice), PR_1 (reviewer ALICE).
    expect(body.needs_me.sort()).toEqual(["PR_1", "T_a"]);

    // recent_events MUST strip raw payload + _id; both are unsafe to
    // forward to the client (untrusted markdown / Mongo internals).
    expect(body.recent_events).toHaveLength(1);
    expect(body.recent_events[0]).not.toHaveProperty("payload");
    expect(body.recent_events[0]).not.toHaveProperty("_id");
    expect(body.recent_events[0].artifact_id).toBe("I_42");
    expect(body.recent_events[0].github_event_type).toBe("issues");
  });
});
