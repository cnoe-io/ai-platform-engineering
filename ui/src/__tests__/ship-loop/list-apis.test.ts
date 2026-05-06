/**
 * @jest-environment node
 *
 * Route-level tests for the two list endpoints. We mock the Mongo
 * collection helpers + auth helper directly. The aim is to exercise
 * filter parsing, pagination, and response shape against the
 * documented contract -- not to test Mongo itself.
 */

const mockGetReposCollection = jest.fn();
const mockGetArtifactsCollection = jest.fn();
const mockGetEventsCollection = jest.fn();
const mockReader = jest.fn();

jest.mock("@/lib/ship-loop/mongo-collections", () => ({
  __esModule: true,
  getShipLoopReposCollection: () => mockGetReposCollection(),
  getShipLoopArtifactsCollection: () => mockGetArtifactsCollection(),
  getShipLoopEventsCollection: () => mockGetEventsCollection(),
}));

jest.mock("@/lib/ship-loop/ship-loop-auth", () => ({
  __esModule: true,
  requireShipLoopReader: () => mockReader(),
  isShipLoopMockAuthAllowed: () => false,
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  getServerConfig: () => ({ shipLoopEnabled: true }),
  getConfig: () => true,
}));

const MOCK_USER = {
  kind: "mock" as const,
  user: { email: "ship-loop-mock@local", name: "Ship Loop Mock" },
};

describe("GET /api/ship-loop/repos", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockGetEventsCollection.mockReset();
    mockReader.mockReset();
  });

  it("returns 401 with a typed error when caller is unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    mockGetReposCollection.mockReturnValue({});
    const { GET } = await import("@/app/api/ship-loop/repos/route");
    const res = await GET(new Request("http://localhost/api/ship-loop/repos"));
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

    const { GET } = await import("@/app/api/ship-loop/repos/route");
    const res = await GET(new Request("http://localhost/api/ship-loop/repos"));
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
});

describe("GET /api/ship-loop/repos/{owner}/{repo}/epics", () => {
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
  }) {
    const findCursor = {
      toArray: jest.fn().mockResolvedValue(opts.epicDocs),
    };
    const aggCursor = {
      toArray: jest.fn().mockResolvedValue(opts.childRows ?? []),
    };
    const find = jest.fn().mockReturnValue(findCursor);
    const aggregate = jest.fn().mockReturnValue(aggCursor);
    return { find, aggregate, _findCursor: findCursor };
  }

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request("http://localhost/api/ship-loop/repos/x/y/epics"),
      { params: Promise.resolve({ owner: "x", repo: "y" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when the repo is not onboarded (or has been offboarded)", async () => {
    mockReader.mockResolvedValue(MOCK_USER);
    setupReposLookup(null);
    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request("http://localhost/api/ship-loop/repos/x/y/epics"),
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
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/ship-loop/repos/demoorg/agentic-demo/epics?stage=bogus",
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
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/ship-loop/repos/demoorg/agentic-demo/epics",
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
        "http://localhost/api/ship-loop/repos/demoorg/agentic-demo/epics?needs_human=true&stalled=true",
      ),
      {
        params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
      },
    );
    const filter = artifactsCol.find.mock.calls[0][0] as Record<string, unknown>;
    expect(filter.needs_human).toBe(true);
    expect(filter.stalled_since).toEqual({ $ne: null });
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
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/ship-loop/repos/demoorg/agentic-demo/epics?limit=2",
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
