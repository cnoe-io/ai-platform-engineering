/**
 * @jest-environment node
 *
 * Top-level Agentic SDLC screens need one portfolio stream so Overview,
 * Repos, Metrics, and Settings can show live status while mounted.
 */

const mockReader = jest.fn();

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

describe("GET /api/agentic-sdlc/events", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockReader.mockReset();
    const { _resetBusForTest } = await import("@/lib/agentic-sdlc/sse-bus");
    _resetBusForTest();
  });

  it("returns 401 when unauthenticated", async () => {
    mockReader.mockResolvedValue(null);
    const { GET } = await import("@/app/api/agentic-sdlc/events/route");

    const res = await GET(new Request("http://localhost/x"));

    expect(res.status).toBe(401);
  });

  it("opens a portfolio stream and forwards portfolio-topic publishes", async () => {
    mockReader.mockResolvedValue(READER);
    const { GET } = await import("@/app/api/agentic-sdlc/events/route");
    const { publish, portfolioTopic, _subscriberCountForTest } = await import(
      "@/lib/agentic-sdlc/sse-bus"
    );

    const ac = new AbortController();
    const res = await GET(new Request("http://localhost/x", { signal: ac.signal }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const handshake = await readNFrames(reader, 1);
    expect(handshake).toMatch(/event: connected/);
    expect(handshake).toMatch(/"scope":"portfolio"/);

    const topic = portfolioTopic();
    expect(_subscriberCountForTest(topic)).toBe(1);

    publish(topic, {
      event: "event_appended",
      data: { repo_id: "99000001", artifact_id: "I_1" },
    });

    const frame = await readNFrames(reader, 1);
    expect(frame).toMatch(/event: event_appended/);
    expect(frame).toMatch(/"repo_id":"99000001"/);

    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(_subscriberCountForTest(topic)).toBe(0);
  });
});
