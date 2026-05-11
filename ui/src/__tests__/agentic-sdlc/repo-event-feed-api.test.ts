/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
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

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}/event-feed", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("returns curated event feed items without raw webhook payloads", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ repo_id: "99000001" }),
    });
    const events = [
      {
        repo_id: "99000001",
        source: "github",
        github_delivery_id: "delivery-1",
        github_event_type: "pull_request",
        github_action: "opened",
        artifact_kind: "pull_request",
        artifact_id: "PR_node_1234567890",
        epic_id: "I_epic",
        actor_kind: "agent",
        actor_login: "coder-bot",
        payload: { pull_request: { title: "raw title should not leak" } },
        delivered_at: new Date("2026-05-11T08:00:00Z"),
        occurred_at: new Date("2026-05-11T07:59:00Z"),
        projection_status: "projected",
        projection_attempts: 1,
      },
      {
        repo_id: "99000001",
        source: "ui",
        github_delivery_id: "delivery-3",
        github_event_type: "issues",
        github_action: "synchronize",
        artifact_kind: "subtask",
        artifact_id: "I_issue_1234567890",
        epic_id: null,
        actor_kind: "system",
        actor_login: null,
        payload: { issue: { title: "raw issue title should not leak" } },
        delivered_at: new Date("2026-05-11T07:00:00Z"),
        occurred_at: new Date("2026-05-11T07:00:00Z"),
        projection_status: "projected",
        projection_attempts: 1,
      },
      {
        repo_id: "99000001",
        source: "ui",
        github_delivery_id: "delivery-2",
        github_event_type: "issues",
        github_action: "synchronize",
        artifact_kind: "subtask",
        artifact_id: "I_issue_1234567890",
        epic_id: null,
        actor_kind: "system",
        actor_login: null,
        payload: { issue: { title: "older duplicate raw issue title" } },
        delivered_at: new Date("2026-05-11T06:00:00Z"),
        occurred_at: new Date("2026-05-11T06:00:00Z"),
        projection_status: "projected",
        projection_attempts: 1,
      },
    ];
    const toArray = jest.fn().mockResolvedValue(events);
    const limit = jest.fn().mockReturnValue({ toArray });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    mockGetEventsCollection.mockResolvedValue({ find });

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/event-feed/route"
    );
    const res = await GET(new Request("http://localhost/x?limit=100&page=1"), {
      params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        id: "delivery-1",
        category: "pull_request",
        title: "PR opened",
        actor_label: "coder-bot",
        artifact_label: "pull request PR_node_...",
      }),
      expect.objectContaining({
        id: "delivery-3",
        category: "issue",
        title: "Issue synchronized",
        artifact_label: "task I_issue_...",
        duplicate_count: 2,
        details: expect.objectContaining({
          source: "ui",
          github_event_type: "issues",
          github_action: "synchronize",
          artifact_kind: "subtask",
          artifact_id: "I_issue_1234567890",
          projection_status: "projected",
        }),
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("payload");
    expect(JSON.stringify(body)).not.toContain("raw title should not leak");
    expect(JSON.stringify(body)).not.toContain("raw issue title should not leak");
    expect(JSON.stringify(body)).not.toContain("older duplicate raw issue title");
    expect(body.pagination).toEqual({
      page: 1,
      page_size: 100,
      page_size_options: [10, 25, 50, 100, 500],
      has_previous: false,
      has_next: false,
      total_visible: 2,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_id: "99000001",
        $or: expect.any(Array),
      }),
      expect.any(Object),
    );
  });
});
