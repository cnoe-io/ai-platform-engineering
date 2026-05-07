/**
 * @jest-environment node
 *
 * Route-level tests for the two list endpoints. We mock the Mongo
 * collection helpers + auth helper directly. The aim is to exercise
 * filter parsing, pagination, and response shape against the
 * documented contract -- not to test Mongo itself.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

const mockGetReposCollection = jest.fn();
const mockGetArtifactsCollection = jest.fn();
const mockGetEventsCollection = jest.fn();
const mockReader = jest.fn();
const mockCreateGitHubClient = jest.fn();

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

jest.mock("@/lib/agentic-sdlc/github-client", () => ({
  __esModule: true,
  createGitHubClient: (...args: unknown[]) => mockCreateGitHubClient(...args),
  GitHubClientError: class GitHubClientError extends Error {
    code: string;
    status: number | null;
    documentationUrl: string | null;
    constructor(
      message: string,
      code: string,
      status: number | null = null,
      documentationUrl: string | null = null,
    ) {
      super(message);
      this.name = "GitHubClientError";
      this.code = code;
      this.status = status;
      this.documentationUrl = documentationUrl;
    }
  },
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  getServerConfig: () => ({ shipLoopEnabled: true }),
  getConfig: () => true,
}));

const MOCK_USER = {
  kind: "mock" as const,
  user: { email: "ship-loop-mock@local", name: "Agentic SDLC Mock" },
};

describe("GET /api/agentic-sdlc/repos", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
    mockCreateGitHubClient.mockReset();
    delete process.env.GITHUB_TOKEN;
  });

  it("returns 401 with a typed error when caller is unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    mockGetReposCollection.mockReturnValue({});
    const { GET } = await import("@/app/api/agentic-sdlc/repos/route");
    const res = await GET(new Request("http://localhost/api/agentic-sdlc/repos"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "unauthenticated",
      message: "Sign in required.",
    });
  });

  it("returns active repos with counts under the {items: [...]} shape", async () => {
    mockReader.mockResolvedValue(MOCK_USER);

    const repoCursor = {
      toArray: jest.fn().mockResolvedValue([
        {
          repo_id: "99000001",
          owner: "demoorg",
          name: "agentic-demo",
          full_name: "demoorg/agentic-demo",
          sandbox_environment: "sandbox-eks",
          webhook_status: "healthy",
          webhook_last_event_at: new Date("2026-05-05T21:30:00Z"),
          updated_at: new Date("2026-05-05T20:00:00Z"),
        },
      ]),
    };
    const reposCol = { find: jest.fn().mockReturnValue(repoCursor) };
    mockGetReposCollection.mockResolvedValue(reposCol);

    // Counts pipeline: 1 open epic, 2 in-flight subtasks, 1 PR
    // awaiting review -> {open_epics:1, in_flight_subtasks:2, prs_awaiting_review:1}
    const artifactsAggCursor = {
      toArray: jest.fn().mockResolvedValue([
        { _id: { kind: "epic", state: "open", current_stage: "implement" }, n: 1 },
        { _id: { kind: "subtask", state: "open", current_stage: "implement" }, n: 2 },
        { _id: { kind: "pull_request", state: "open", current_stage: "review_hitl" }, n: 1 },
        // Should NOT count: closed PR / merged epic / open PR not in review_hitl
        { _id: { kind: "pull_request", state: "closed", current_stage: "review_hitl" }, n: 99 },
        { _id: { kind: "epic", state: "merged", current_stage: "deploy" }, n: 99 },
        { _id: { kind: "pull_request", state: "open", current_stage: "implement" }, n: 99 },
      ]),
    };
    mockGetArtifactsCollection.mockResolvedValue({
      aggregate: jest.fn().mockReturnValue(artifactsAggCursor),
    });
    mockGetEventsCollection.mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValue(7),
    });

    const { GET } = await import("@/app/api/agentic-sdlc/repos/route");
    const res = await GET(new Request("http://localhost/api/agentic-sdlc/repos"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          repo_id: "99000001",
          owner: "demoorg",
          name: "agentic-demo",
          full_name: "demoorg/agentic-demo",
          sandbox_environment: "sandbox-eks",
          webhook_status: "healthy",
          last_activity_at: "2026-05-05T21:30:00.000Z",
          counts: {
            open_epics: 1,
            in_flight_subtasks: 2,
            prs_awaiting_review: 1,
            deploys_24h: 7,
          },
        },
      ],
    });

    // Confirm we only query active repos -- offboarded repos must
    // not leak into the dashboard.
    expect(reposCol.find).toHaveBeenCalledWith(
      expect.objectContaining({ offboarded_at: null }),
      expect.any(Object),
    );
  });

  it("onboards a real GitHub repo by creating a webhook and upserting the repo row", async () => {
    process.env.GITHUB_TOKEN = "token";
    mockReader.mockResolvedValue(MOCK_USER);
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    mockGetReposCollection.mockResolvedValue({ updateOne });
    const getRepoMetadata = jest.fn().mockResolvedValue({
      id: 123456,
      full_name: "acme/real-repo",
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true },
    });
    const createRepoWebhook = jest.fn().mockResolvedValue({
      id: 987,
      url: "https://api.github.com/repos/acme/real-repo/hooks/987",
      active: true,
      events: ["issues", "pull_request"],
      config: {
        url: "https://demo.ngrok-free.app/api/agentic-sdlc/webhooks/github",
      },
    });
    const listRepoWebhooks = jest.fn().mockResolvedValue([]);
    mockCreateGitHubClient.mockReturnValue({
      getRepoMetadata,
      listRepoWebhooks,
      createRepoWebhook,
    });

    const { POST } = await import("@/app/api/agentic-sdlc/repos/route");
    const res = await POST(
      new Request("http://localhost/api/agentic-sdlc/repos", {
        method: "POST",
        body: JSON.stringify({
          owner: "acme",
          repo: "real-repo",
          callback_url:
            "https://demo.ngrok-free.app/api/agentic-sdlc/webhooks/github",
          webhook_secret: "local-secret",
          sandbox_environment: "sandbox-eks",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(mockCreateGitHubClient).toHaveBeenCalledWith({ authToken: "token" });
    expect(getRepoMetadata).toHaveBeenCalledWith("acme", "real-repo");
    expect(listRepoWebhooks).toHaveBeenCalledWith("acme", "real-repo");
    expect(createRepoWebhook).toHaveBeenCalledWith("acme", "real-repo", {
      callbackUrl: "https://demo.ngrok-free.app/api/agentic-sdlc/webhooks/github",
      secret: "local-secret",
      events: [
        "issues",
        "issue_comment",
        "pull_request",
        "pull_request_review",
        "pull_request_review_comment",
        "push",
        "check_run",
        "check_suite",
        "deployment",
        "deployment_status",
        "label",
      ],
    });
    expect(updateOne).toHaveBeenCalledWith(
      { repo_id: "123456" },
      expect.objectContaining({
        $set: expect.objectContaining({
          repo_id: "123456",
          owner: "acme",
          name: "real-repo",
          full_name: "acme/real-repo",
          default_branch: "main",
          sandbox_environment: "sandbox-eks",
          webhook_id: 987,
          webhook_status: "healthy",
          onboarded_by_user_id: MOCK_USER.user.email,
        }),
        $setOnInsert: expect.any(Object),
      }),
      { upsert: true },
    );
    const body = await res.json();
    expect(body.item).toEqual(
      expect.objectContaining({
        repo_id: "123456",
        full_name: "acme/real-repo",
        webhook_id: 987,
        webhook_url: "https://demo.ngrok-free.app/api/agentic-sdlc/webhooks/github",
      }),
    );
  });

  it("reuses an existing eticloud webhook when onboarding a real repo", async () => {
    process.env.GITHUB_TOKEN = "token";
    mockReader.mockResolvedValue(MOCK_USER);
    const updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetReposCollection.mockResolvedValue({ updateOne });
    const getRepoMetadata = jest.fn().mockResolvedValue({
      id: 987654321,
      full_name: "cisco-eti/sri-speckit-test",
      default_branch: "main",
      permissions: { admin: true, push: true, pull: true },
    });
    const listRepoWebhooks = jest.fn().mockResolvedValue([
      {
        id: 555,
        url: "https://api.github.com/repos/cisco-eti/sri-speckit-test/hooks/555",
        active: true,
        events: ["issues", "pull_request"],
        config: {
          url: "https://github-webhook.eticloud.io/github",
          content_type: "json",
        },
      },
    ]);
    const createRepoWebhook = jest.fn();
    mockCreateGitHubClient.mockReturnValue({
      getRepoMetadata,
      listRepoWebhooks,
      createRepoWebhook,
    });

    const { POST } = await import("@/app/api/agentic-sdlc/repos/route");
    const res = await POST(
      new Request("http://localhost/api/agentic-sdlc/repos", {
        method: "POST",
        body: JSON.stringify({
          owner: "cisco-eti",
          repo: "sri-speckit-test",
          callback_url: "https://github-webhook.eticloud.io/github",
          webhook_secret: "local-secret",
          sandbox_environment: "sandbox-eks",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(createRepoWebhook).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { repo_id: "987654321" },
      expect.objectContaining({
        $set: expect.objectContaining({
          repo_id: "987654321",
          owner: "cisco-eti",
          name: "sri-speckit-test",
          full_name: "cisco-eti/sri-speckit-test",
          webhook_id: 555,
          webhook_status: "healthy",
        }),
      }),
      { upsert: true },
    );
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        item: expect.objectContaining({
          repo_id: "987654321",
          full_name: "cisco-eti/sri-speckit-test",
          webhook_id: 555,
          webhook_url: "https://github-webhook.eticloud.io/github",
        }),
      }),
    );
  });

  it("returns 400 for invalid onboarding callback URLs", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    const { POST } = await import("@/app/api/agentic-sdlc/repos/route");
    const res = await POST(
      new Request("http://localhost/api/agentic-sdlc/repos", {
        method: "POST",
        body: JSON.stringify({
          owner: "acme",
          repo: "real-repo",
          callback_url: "file:///etc/passwd",
          webhook_secret: "local-secret",
          sandbox_environment: "sandbox-eks",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_callback_url");
  });
});

describe("GET /api/agentic-sdlc/metrics", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("returns live portfolio metrics and graph series from projected data", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    mockGetReposCollection.mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValue(2),
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { repo_id: "1", full_name: "cisco-eti/sri-speckit-test" },
          { repo_id: "2", full_name: "cisco-eti/another-repo" },
        ]),
      }),
    });
    mockGetArtifactsCollection.mockResolvedValue({
      countDocuments: jest
        .fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5),
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: { repo_id: "1", current_stage: "implement" }, count: 4 },
          { _id: { repo_id: "1", current_stage: "review_hitl" }, count: 2 },
          { _id: { repo_id: "2", current_stage: "deploy" }, count: 1 },
        ]),
      }),
    });
    mockGetEventsCollection.mockResolvedValue({
      aggregate: jest
        .fn()
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([
            { _id: "2026-05-03", count: 2 },
            { _id: "2026-05-04", count: 5 },
          ]),
        })
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([{ total_tokens: 12345 }]),
        }),
    });

    const { GET } = await import("@/app/api/agentic-sdlc/metrics/route");
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/metrics"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      summary: {
        repos_in_scope: 2,
        hitl_queue_count: 3,
        velocity_30d: 5,
        token_spend_total: 12345,
      },
      stage_pressure: [
        {
          repo_id: "1",
          repo_name: "cisco-eti/sri-speckit-test",
          stage: "implement",
          count: 4,
        },
        {
          repo_id: "1",
          repo_name: "cisco-eti/sri-speckit-test",
          stage: "review_hitl",
          count: 2,
        },
        {
          repo_id: "2",
          repo_name: "cisco-eti/another-repo",
          stage: "deploy",
          count: 1,
        },
      ],
      velocity_series: [
        { date: "2026-05-03", count: 2 },
        { date: "2026-05-04", count: 5 },
      ],
    });
  });
});

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}/epics", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  function setupReposLookup(repoId: string | null) {
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(repoId ? { repo_id: repoId } : null),
    });
  }

  function makeArtifactsCollection(opts: {
    epicDocs: unknown[];
    childRows?: unknown[];
    linkedSubtaskRows?: unknown[];
  }) {
    const epicFindCursor = {
      toArray: jest.fn().mockResolvedValue(opts.epicDocs),
    };
    const linkedSubtaskFindCursor = {
      toArray: jest.fn().mockResolvedValue(opts.linkedSubtaskRows ?? []),
    };
    const aggCursor = {
      toArray: jest.fn().mockResolvedValue(opts.childRows ?? []),
    };
    const find = jest
      .fn()
      .mockReturnValueOnce(epicFindCursor)
      .mockReturnValue(linkedSubtaskFindCursor);
    const aggregate = jest.fn().mockReturnValue(aggCursor);
    return { find, aggregate, _findCursor: epicFindCursor };
  }

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/x/y/epics"),
      { params: Promise.resolve({ owner: "x", repo: "y" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the repo is not onboarded (or has been offboarded)", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup(null);
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/x/y/epics"),
      { params: Promise.resolve({ owner: "x", repo: "y" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when the stage filter is not in the closed enum", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup("99000001");
    mockGetArtifactsCollection.mockResolvedValue(
      makeArtifactsCollection({ epicDocs: [] }),
    );
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics?stage=bogus",
      ),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("bad_stage");
  });

  it("serialises Epic rows with child counts and ISO timestamps; null next_cursor when page fits", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup("99000001");

    const lastEvent = new Date("2026-05-05T20:00:00.000Z");
    const stalledSince = new Date("2026-05-04T10:00:00.000Z");

    const artifactsCol = makeArtifactsCollection({
      epicDocs: [
        {
          artifact_id: "I_1",
          title: "Add OAuth device flow",
          current_stage: "implement",
          needs_human: false,
          stalled_since: null,
          github_url: "https://github.com/demoorg/agentic-demo/issues/1",
          last_event_at: lastEvent,
        },
        {
          artifact_id: "I_2",
          title: "Migrate logging",
          current_stage: "review_hitl",
          needs_human: true,
          stalled_since: stalledSince,
          github_url: "https://github.com/demoorg/agentic-demo/issues/2",
          last_event_at: lastEvent,
        },
      ],
      childRows: [
        { _id: { epic_id: "I_1", kind: "subtask" }, n: 5 },
        { _id: { epic_id: "I_1", kind: "pull_request" }, n: 3 },
        { _id: { epic_id: "I_1", kind: "deploy" }, n: 1 },
        { _id: { epic_id: "I_2", kind: "pull_request" }, n: 2 },
      ],
    });
    mockGetArtifactsCollection.mockResolvedValue(artifactsCol);

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics",
      ),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      artifact_id: "I_1",
      title: "Add OAuth device flow",
      current_stage: "implement",
      needs_human: false,
      stalled_since: null,
      child_counts: { subtasks: 5, prs: 3, deploys: 1 },
      github_url: "https://github.com/demoorg/agentic-demo/issues/1",
      last_event_at: "2026-05-05T20:00:00.000Z",
    });
    expect(body.items[1].stalled_since).toBe(stalledSince.toISOString());
    expect(body.items[1].child_counts).toEqual({
      subtasks: 0,
      prs: 2,
      deploys: 0,
    });
    expect(body.next_cursor).toBeNull();

    // Confirm needs_human=true & stalled=true wired into the find filter.
    // (We re-run with those flags set.)
    artifactsCol.find.mockClear();
    await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics?needs_human=true&stalled=true",
      ),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );
    const filter = artifactsCol.find.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.needs_human).toBe(true);
    expect(filter.stalled_since).toEqual({ $ne: null });
  });

  it("hides stale task-as-Epic rows when the same artifact is linked as a subtask", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup("99000001");

    const lastEvent = new Date("2026-05-05T20:00:00.000Z");
    mockGetArtifactsCollection.mockResolvedValue(
      makeArtifactsCollection({
        epicDocs: [
          {
            artifact_id: "I_EPIC",
            title: "Create dashboard",
            current_stage: "specify",
            needs_human: false,
            stalled_since: null,
            github_url: "https://github.com/demoorg/agentic-demo/issues/1",
            last_event_at: lastEvent,
          },
          {
            artifact_id: "I_TASK",
            title: "Task issue incorrectly projected as Epic",
            current_stage: "specify",
            needs_human: false,
            stalled_since: null,
            github_url: "https://github.com/demoorg/agentic-demo/issues/2",
            last_event_at: lastEvent,
          },
        ],
        childRows: [
          { _id: { epic_id: "I_EPIC", kind: "subtask" }, n: 1 },
        ],
        linkedSubtaskRows: [{ artifact_id: "I_TASK" }],
      }),
    );

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics"),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        artifact_id: "I_EPIC",
        child_counts: { subtasks: 1, prs: 0, deploys: 0 },
      }),
    ]);
  });

  it("emits a base64url next_cursor when more rows exist and respects limit", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup("99000001");

    const { ObjectId } = await import("mongodb");
    const lastId = new ObjectId();
    const lastEvent = new Date("2026-05-05T19:00:00.000Z");

    // limit=2, so we ask for 3 and the third row signals "hasMore".
    const epicDocs = [
      {
        artifact_id: "I_a",
        title: "a",
        current_stage: "implement",
        needs_human: false,
        stalled_since: null,
        github_url: "u",
        last_event_at: new Date("2026-05-05T20:00:00.000Z"),
        _id: new ObjectId(),
      },
      {
        artifact_id: "I_b",
        title: "b",
        current_stage: "implement",
        needs_human: false,
        stalled_since: null,
        github_url: "u",
        last_event_at: lastEvent,
        _id: lastId,
      },
      {
        artifact_id: "I_c",
        title: "c (overflow)",
        current_stage: "implement",
        needs_human: false,
        stalled_since: null,
        github_url: "u",
        last_event_at: new Date("2026-05-05T18:00:00.000Z"),
        _id: new ObjectId(),
      },
    ];
    mockGetArtifactsCollection.mockResolvedValue(
      makeArtifactsCollection({ epicDocs }),
    );

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo/epics?limit=2",
      ),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.next_cursor).toBeTruthy();
    const decoded = JSON.parse(
      Buffer.from(body.next_cursor, "base64url").toString("utf8"),
    );
    expect(decoded).toEqual({ t: lastEvent.toISOString(), id: lastId.toString() });
  });
});

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("returns live repo operating metrics and human queue", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        repo_id: "987654321",
        owner: "demoorg",
        name: "agentic-demo",
        full_name: "demoorg/agentic-demo",
        webhook_status: "healthy",
        webhook_last_event_at: new Date("2026-05-05T21:00:00Z"),
      }),
    });
    mockGetArtifactsCollection.mockResolvedValue({
      aggregate: jest
        .fn()
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([
            { _id: { kind: "epic", state: "open", current_stage: "specify" }, n: 2 },
            { _id: { kind: "subtask", state: "open", current_stage: "tasks" }, n: 4 },
            {
              _id: {
                kind: "pull_request",
                state: "open",
                current_stage: "review_hitl",
              },
              n: 1,
            },
          ]),
        })
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([
            { _id: "specify", n: 2 },
            { _id: "tasks", n: 4 },
            { _id: "review_hitl", n: 1 },
          ]),
        }),
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            artifact_id: "PR_42",
            kind: "pull_request",
            title: "Review OAuth PR",
            current_stage: "review_hitl",
            github_url: "https://github.com/demoorg/agentic-demo/pull/42",
            last_event_at: new Date("2026-05-05T20:00:00Z"),
          },
        ]),
      }),
    });
    mockGetEventsCollection.mockResolvedValue({
      countDocuments: jest
        .fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(9),
    });

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/route"
    );
    const res = await GET(
      new Request("http://localhost/api/agentic-sdlc/repos/demoorg/agentic-demo"),
      { params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      repo: {
        repo_id: "987654321",
        full_name: "demoorg/agentic-demo",
        webhook_status: "healthy",
        webhook_last_event_at: "2026-05-05T21:00:00.000Z",
      },
      counts: {
        open_epics: 2,
        in_flight_subtasks: 4,
        prs_awaiting_review: 1,
        deploys_24h: 3,
      },
      activity_24h: 9,
      stage_counts: [
        { stage: "specify", count: 2 },
        { stage: "tasks", count: 4 },
        { stage: "review_hitl", count: 1 },
      ],
      human_queue: {
        needs_human_count: 1,
        oldest_waiting_since: "2026-05-05T20:00:00.000Z",
        items: [
          {
            artifact_id: "PR_42",
            title: "Review OAuth PR",
            current_stage: "review_hitl",
          },
        ],
      },
      swim_lanes: [
        {
          stage: "review_hitl",
          items: [
            {
              artifact_id: "PR_42",
              title: "Review OAuth PR",
              actor_kind: "human",
            },
          ],
        },
      ],
    });
  });
});

describe("POST /api/agentic-sdlc/repos/{owner}/{repo}/sync", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
    mockCreateGitHubClient.mockReset();
    process.env.GITHUB_TOKEN = "token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("pulls paginated GitHub issues and PRs into the derived artifact state", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    const updateRepo = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({
        repo_id: "123",
        owner: "cisco-eti",
        name: "sri-react-app",
        full_name: "cisco-eti/sri-react-app",
        label_to_stage_overrides: {},
        offboarded_at: null,
      }),
      updateOne: updateRepo,
    });
    const bulkWrite = jest.fn().mockResolvedValue({ upsertedCount: 2, modifiedCount: 1 });
    mockGetArtifactsCollection.mockResolvedValue({ bulkWrite });
    const insertMany = jest.fn().mockResolvedValue({ insertedCount: 3 });
    mockGetEventsCollection.mockResolvedValue({ insertMany });

    const listRepoIssues = jest.fn().mockResolvedValue([
      {
        node_id: "I_epic",
        number: 11,
        title: "Epic: refresh repo state",
        body: "Keep the view current after missed webhooks.",
        state: "open",
        labels: [{ name: "epic" }, { name: "agent:specify" }],
        assignees: [{ login: "agentic-sdlc-bot" }],
        html_url: "https://github.com/cisco-eti/sri-react-app/issues/11",
        updated_at: "2026-05-07T08:00:00Z",
      },
      {
        node_id: "I_task",
        number: 12,
        title: "Implement reconciliation",
        body: "Pull issues and PRs.",
        state: "open",
        labels: [{ name: "agent:implement" }],
        assignees: [],
        html_url: "https://github.com/cisco-eti/sri-react-app/issues/12",
        updated_at: "2026-05-07T08:05:00Z",
      },
      {
        node_id: "I_pr_issue_shell",
        number: 13,
        title: "PR shell from issues endpoint",
        state: "open",
        labels: [],
        pull_request: {},
        html_url: "https://github.com/cisco-eti/sri-react-app/pull/13",
        updated_at: "2026-05-07T08:08:00Z",
      },
    ]);
    const listIssueSubIssues = jest.fn((_, __, issueNumber: number) => {
      if (issueNumber === 11) {
        return Promise.resolve([
          {
            node_id: "I_task",
            number: 12,
            title: "Implement reconciliation",
            body: "Pull issues and PRs.",
            state: "open",
            labels: [{ name: "agent:implement" }],
            assignees: [],
            html_url: "https://github.com/cisco-eti/sri-react-app/issues/12",
            updated_at: "2026-05-07T08:05:00Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const listRepoPullRequests = jest.fn().mockResolvedValue([
      {
        node_id: "PR_13",
        number: 13,
        title: "feat: add reconciliation",
        body: "Keeps Agentic SDLC from going stale.",
        state: "open",
        merged: false,
        labels: [{ name: "agent:awaiting-review" }],
        assignees: [{ login: "agentic-sdlc-bot" }],
        requested_reviewers: [{ login: "sraradhy" }],
        html_url: "https://github.com/cisco-eti/sri-react-app/pull/13",
        updated_at: "2026-05-07T08:09:00Z",
      },
    ]);
    mockCreateGitHubClient.mockReturnValue({
      listRepoIssues,
      listIssueSubIssues,
      listRepoPullRequests,
    });

    const { POST } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/sync/route"
    );
    const res = await POST(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/cisco-eti/sri-react-app/sync",
        { method: "POST" },
      ),
      { params: Promise.resolve({ owner: "cisco-eti", repo: "sri-react-app" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      synced: true,
      repo: "cisco-eti/sri-react-app",
      issues_seen: 3,
      pull_requests_seen: 1,
      artifacts_upserted: 3,
      events_recorded: 3,
    });
    expect(mockCreateGitHubClient).toHaveBeenCalledWith({ authToken: "token" });
    expect(listRepoIssues).toHaveBeenCalledWith("cisco-eti", "sri-react-app", {
      perPage: 100,
      state: "all",
    });
    expect(listRepoPullRequests).toHaveBeenCalledWith(
      "cisco-eti",
      "sri-react-app",
      {
        perPage: 100,
        state: "all",
      },
    );
    expect(listIssueSubIssues).toHaveBeenCalledWith(
      "cisco-eti",
      "sri-react-app",
      11,
      { perPage: 100 },
    );
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const operations = bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(4);
    expect(operations[0].updateOne.update.$set).toMatchObject({
      repo_id: "123",
      kind: "epic",
      artifact_id: "I_epic",
      current_stage: "specify",
    });
    expect(operations[2].updateOne.update.$set).toMatchObject({
      kind: "pull_request",
      artifact_id: "PR_13",
      current_stage: "review_hitl",
      needs_human: true,
    });
    expect(operations[3].deleteOne.filter).toMatchObject({
      repo_id: "123",
      kind: "epic",
      artifact_id: "I_task",
    });
    expect(insertMany).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        repo_id: "123",
        source: "ui",
        github_event_type: "pull_request",
        projection_status: "projected",
      }),
    ]), { ordered: false });
    expect(updateRepo).toHaveBeenCalledWith(
      { repo_id: "123" },
      expect.objectContaining({
        $set: expect.objectContaining({
          last_reconciled_at: expect.any(Date),
          updated_at: expect.any(Date),
        }),
      }),
    );
  });
});

describe("POST /api/agentic-sdlc/repos/{owner}/{repo}/simulate", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("seeds a realistic local agentic loop for an onboarded repo", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    const repoDoc = {
      repo_id: "987654321",
      owner: "cisco-eti",
      name: "sri-speckit-test",
      full_name: "cisco-eti/sri-speckit-test",
      sandbox_environment: "sandbox-eks",
      webhook_status: "healthy",
    };
    const reposCol = {
      findOne: jest.fn().mockResolvedValue(repoDoc),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const artifactsCol = {
      bulkWrite: jest.fn().mockResolvedValue({ upsertedCount: 5 }),
    };
    const eventsCol = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 6 }),
    };
    mockGetReposCollection.mockResolvedValue(reposCol);
    mockGetArtifactsCollection.mockResolvedValue(artifactsCol);
    mockGetEventsCollection.mockResolvedValue(eventsCol);

    const { POST } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/simulate/route"
    );
    const res = await POST(
      new Request(
        "http://localhost/api/agentic-sdlc/repos/cisco-eti/sri-speckit-test/simulate",
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          owner: "cisco-eti",
          repo: "sri-speckit-test",
        }),
      },
    );

    expect(res.status).toBe(201);
    expect(artifactsCol.bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: {
              repo_id: "987654321",
              kind: "epic",
              artifact_id: expect.stringMatching(/^SIM_EPIC_/),
            },
          }),
        }),
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: {
              repo_id: "987654321",
              kind: "pull_request",
              artifact_id: expect.stringMatching(/^SIM_PR_/),
            },
          }),
        }),
      ]),
      { ordered: false },
    );
    expect(eventsCol.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          repo_id: "987654321",
          source: "github",
          github_event_type: "issues",
          artifact_kind: "epic",
        }),
        expect.objectContaining({
          repo_id: "987654321",
          github_event_type: "pull_request",
          artifact_kind: "pull_request",
        }),
      ]),
      { ordered: false },
    );
    expect(reposCol.updateOne).toHaveBeenCalledWith(
      { repo_id: "987654321" },
      expect.objectContaining({
        $set: expect.objectContaining({ webhook_status: "healthy" }),
      }),
    );
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({
        simulated: true,
        repo: "cisco-eti/sri-speckit-test",
        artifacts_created: 5,
        events_created: 6,
        epic_id: expect.stringMatching(/^SIM_EPIC_/),
      }),
    );
  });

  it("returns 404 when the repo has not been onboarded", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const { POST } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/simulate/route"
    );
    const res = await POST(
      new Request("http://localhost/api/agentic-sdlc/repos/missing/repo/simulate", {
        method: "POST",
      }),
      { params: Promise.resolve({ owner: "missing", repo: "repo" }) },
    );
    expect(res.status).toBe(404);
  });
});
