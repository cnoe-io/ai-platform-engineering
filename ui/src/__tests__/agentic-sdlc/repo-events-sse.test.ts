/**
 * @jest-environment node
 *
 * Repo detail pages need a live stream too. This route should subscribe
 * to the repo-level topic without requiring an Epic artifact to exist.
 */

const mockGetReposCollection = jest.fn();
const mockReader = jest.fn();

jest.mock("@/lib/agentic-sdlc/mongo-collections", () => ({
  __esModule: true,
  getAgenticSdlcReposCollection: () => mockGetReposCollection(),
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
    frames += (text.match(/\n\n/g) ?? []).length;
  }
  return chunks.join("");
}

describe("GET /api/agentic-sdlc/repos/{owner}/{repo}/events", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockGetReposCollection.mockReset();
    mockReader.mockReset();
    const { _resetBusForTest } = await import("@/lib/agentic-sdlc/sse-bus");
    _resetBusForTest();
  });

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/events/route"
    );

    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 when repo is not onboarded", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue(null),
    });
    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/events/route"
    );

    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ owner: "demoorg", repo: "missing" }),
    });

    expect(res.status).toBe(404);
  });

  it("opens a repo stream and forwards repo-topic publishes", async () => {
    mockReader.mockResolvedValue(READER);
    mockGetReposCollection.mockResolvedValue({
      findOne: jest.fn().mockResolvedValue({ repo_id: "99000001" }),
    });

    const { GET } = await import(
      "@/app/api/agentic-sdlc/repos/[owner]/[repo]/events/route"
    );
    const { publish, repoTopic, _subscriberCountForTest } = await import(
      "@/lib/agentic-sdlc/sse-bus"
    );

    const ac = new AbortController();
    const res = await GET(new Request("http://localhost/x", { signal: ac.signal }), {
      params: Promise.resolve({ owner: "demoorg", repo: "agentic-demo" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const handshake = await readNFrames(reader, 1);
    expect(handshake).toMatch(/event: connected/);
    expect(handshake).toMatch(/"repo_id":"99000001"/);

    const topic = repoTopic("99000001");
    expect(_subscriberCountForTest(topic)).toBe(1);

    publish(topic, {
      event: "artifact_upserted",
      data: { artifact_id: "I_1", current_stage: "specify" },
    });

    const frame = await readNFrames(reader, 1);
    expect(frame).toMatch(/event: artifact_upserted/);
    expect(frame).toMatch(/"artifact_id":"I_1"/);

    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(_subscriberCountForTest(topic)).toBe(0);
  });
});
