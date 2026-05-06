/**
 * @jest-environment node
 *
 * The per-Epic SSE route is a thin adapter between sse-bus and a
 * ReadableStream. We exercise:
 *   1) `connected` handshake frame on subscribe
 *   2) An `artifact_upserted` published on the topic reaches the
 *      stream subscriber as a properly formatted SSE frame
 *   3) Aborting the request disposes the bus subscription so we do
 *      not leak subscribers and breach the per-user 10-conn cap
 *   4) 404 on missing repo / Epic + 401 on unauthenticated
 */

const mockGetReposCollection = jest.fn();
const mockGetArtifactsCollection = jest.fn();
const mockReader = jest.fn();

jest.mock("@/lib/ship-loop/mongo-collections", () => ({
  __esModule: true,
  getShipLoopReposCollection: () => mockGetReposCollection(),
  getShipLoopArtifactsCollection: () => mockGetArtifactsCollection(),
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

const READER = {
  kind: "mock" as const,
  user: { email: "alice@example.com", name: "Alice" },
};

function makeOnboardedRepoFindOne() {
  return jest.fn().mockResolvedValue({ repo_id: "99000001" });
}

function makeEpicFindOne(present: boolean) {
  return jest.fn().mockResolvedValue(present ? { _id: "x" } : null);
}

async function readNFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
  timeoutMs = 1000,
): Promise<string> {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let frames = 0;
  const start = Date.now();
  while (frames < n && Date.now() - start < timeoutMs) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const text = decoder.decode(value);
    chunks.push(text);
    // Each well-formed SSE frame ends in a blank line ("\n\n"); count those.
    const newFrames = (text.match(/\n\n/g) ?? []).length;
    frames += newFrames;
  }
  return chunks.join("");
}

describe("GET /api/ship-loop/repos/{owner}/{repo}/epics/{epicId}/events", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockGetArtifactsCollection.mockReset();
    mockReader.mockReset();
    // Reset the bus state across tests so subscriber counts and
    // per-user quotas don't bleed.
    const { _resetBusForTest } = await import("@/lib/ship-loop/sse-bus");
    _resetBusForTest();
  });

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/[epicId]/events/route"
    );
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ owner: "x", repo: "y", epicId: "I_1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when repo is not onboarded (do not open a stream)", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/[epicId]/events/route"
    );
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ owner: "x", repo: "y", epicId: "I_1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the Epic does not exist (avoids forever-empty streams)", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: makeOnboardedRepoFindOne(),
    });
    mockGetArtifactsCollection.mockResolvedValue({
      findOne: makeEpicFindOne(false),
    });
    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/[epicId]/events/route"
    );
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({
        owner: "demoorg",
        repo: "agentic-demo",
        epicId: "I_missing",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("opens an SSE stream, sends a connected frame, then forwards bus publishes", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: makeOnboardedRepoFindOne(),
    });
    mockGetArtifactsCollection.mockResolvedValue({
      findOne: makeEpicFindOne(true),
    });

    const { GET } = await import(
      "@/app/api/ship-loop/repos/[owner]/[repo]/epics/[epicId]/events/route"
    );
    const { epicTopic, publish, _subscriberCountForTest } = await import(
      "@/lib/ship-loop/sse-bus"
    );

    const ac = new AbortController();
    const req = new Request("http://localhost/x", { signal: ac.signal });

    const res = await GET(req, {
      params: Promise.resolve({
        owner: "demoorg",
        repo: "agentic-demo",
        epicId: "I_42",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");

    const reader = res.body!.getReader();

    // Frame 1: connected handshake.
    const handshake = await readNFrames(reader, 1);
    expect(handshake).toMatch(/event: connected/);
    expect(handshake).toMatch(/"epic_id":"I_42"/);

    // Subscriber should now be on the topic.
    const topic = epicTopic("99000001", "I_42");
    expect(_subscriberCountForTest(topic)).toBe(1);

    // Publish an artifact_upserted -- the SSE route should serialise
    // it into a single frame on the wire.
    publish(topic, {
      event: "artifact_upserted",
      data: { artifact_id: "PR_1", current_stage: "review_hitl" },
    });

    const frame2 = await readNFrames(reader, 1);
    expect(frame2).toMatch(/event: artifact_upserted/);
    expect(frame2).toMatch(/"artifact_id":"PR_1"/);
    expect(frame2).toMatch(/"current_stage":"review_hitl"/);

    // Aborting the upstream request must dispose the subscription.
    // Without this, the user's 10-connection quota fills up and
    // every reconnect after that fails with "user_quota_exceeded".
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(_subscriberCountForTest(topic)).toBe(0);

    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  });
});
