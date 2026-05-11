/**
 * @jest-environment node
 */

const mockGetReposCollection = jest.fn();
const mockGetEventsCollection = jest.fn();
const mockReader = jest.fn();

jest.mock("@/lib/agentic-sdlc/mongo-collections", () => ({
  __esModule: true,
  getAgenticSdlcReposCollection: () => mockGetReposCollection(),
  getAgenticSdlcEventsCollection: () => mockGetEventsCollection(),
}));

jest.mock("@/lib/agentic-sdlc/agentic-sdlc-auth", () => ({
  __esModule: true,
  requireAgenticSdlcReader: () => mockReader(),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  getServerConfig: () => ({ shipLoopEnabled: true }),
  getConfig: (key: string) =>
    key === "shipLoopResolvedArtifactLookbackHours" ? 24 : true,
}));

const READER = {
  kind: "mock" as const,
  user: { email: "alice@example.com", name: "Alice" },
};

function issueEvent(label: string, occurredAt: string) {
  return {
    repo_id: "99000001",
    source: "github",
    github_delivery_id: `delivery-${label}`,
    github_event_type: "issues",
    github_action: "edited",
    artifact_kind: "subtask",
    artifact_id: "I_TASK",
    epic_id: null,
    actor_kind: "agent",
    actor_login: "coder-bot",
    payload: {
      issue: {
        node_id: "I_TASK",
        title: "Build snapshot replay",
        body: "",
        state: "open",
        labels: [{ name: label }],
        assignees: [],
        html_url: "https://github.com/acme/repo/issues/1",
      },
    },
    delivered_at: new Date(occurredAt),
    occurred_at: new Date(occurredAt),
    projection_status: "projected",
    projection_attempts: 1,
  };
}

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}/board-replay", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("folds prior history into chronological board snapshots", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-11T10:00:00Z").getTime());
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        repo_id: "99000001",
        owner: "demoorg",
        name: "agentic-demo",
        full_name: "demoorg/agentic-demo",
        default_branch: "main",
        sandbox_environment: "sandbox",
        webhook_id: 1,
        webhook_secret_hash: "hash",
        webhook_status: "healthy",
        webhook_last_event_at: null,
        label_to_stage_overrides: {},
        onboarded_by_user_id: "alice",
        onboarded_at: new Date("2026-05-01T00:00:00Z"),
        offboarded_at: null,
        created_at: new Date("2026-05-01T00:00:00Z"),
        updated_at: new Date("2026-05-01T00:00:00Z"),
      }),
    });
    const toArray = jest.fn().mockResolvedValue([
      issueEvent("agent:tasks", "2026-05-11T07:30:00Z"),
      issueEvent("agent:coder", "2026-05-11T09:30:00Z"),
    ]);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    mockGetEventsCollection.mockResolvedValue({ find });

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/board-replay/route"
    );
    const res = await GET(
      new Request("http://localhost/x?windowHours=2&limit=100"),
      { params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshots).toHaveLength(2);
    expect(body.snapshots[0].swim_lanes).toEqual([
      expect.objectContaining({
        stage: "tasks",
        items: [expect.objectContaining({ artifact_id: "I_TASK" })],
      }),
    ]);
    expect(body.snapshots[1].swim_lanes).toEqual([
      expect.objectContaining({
        stage: "implement",
        items: [expect.objectContaining({ artifact_id: "I_TASK" })],
      }),
    ]);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_id: "99000001",
        occurred_at: { $lte: new Date("2026-05-11T10:00:00Z") },
      }),
      expect.any(Object),
    );
    jest.useRealTimers();
  });
});
