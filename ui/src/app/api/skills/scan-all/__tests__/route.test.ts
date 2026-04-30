/**
 * @jest-environment node
 *
 * Tests for POST /api/skills/scan-all
 *
 * Covers:
 *   - Non-admins are rejected with 403 before any scan runs.
 *   - 503 when MongoDB or the scanner is not configured (fail fast — we
 *     don't want a half-completed sweep).
 *   - Happy path: walks `agent_skills` + `hub_skills`, calls the scanner
 *     once per row, persists scan_status onto each doc, records a
 *     `bulk_*` history event, and returns counts/results.
 *   - Skips rows with no scannable content (no SKILL.md, no prompts) and
 *     reports them in `skipped` + a row with `error`.
 *   - `scope=custom` skips the hub collection; `scope=hub` skips agent_skills.
 *   - Per-skill scanner errors are captured into the row and counted as
 *     unscanned rather than aborting the whole sweep.
 */

const mockNextResponseJson = jest.fn(
  (data: any, init?: { headers?: Record<string, string>; status?: number }) => ({
    json: async () => data,
    status: init?.status ?? 200,
    headers: new Map(Object.entries(init?.headers ?? {})),
  }),
);
// Streaming-path also needs `new NextResponse(stream, init)`. We forward
// to the real Web `Response` (Node 18+ ships it) so test code can read
// the NDJSON body via `.body.getReader()` exactly like the dialog does.
jest.mock("next/server", () => {
  class MockNextResponse extends Response {}
  return {
    NextResponse: Object.assign(MockNextResponse, {
      json: (...args: any[]) => mockNextResponseJson(...args),
    }),
  };
});

// Auth: provide a user we can flip role on per test.
const mockUser = { email: "admin@example.com", name: "Admin", role: "admin" };
jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    withAuth: jest.fn(async (_req: any, handler: any) =>
      handler(_req, mockUser, { accessToken: "tok" }),
    ),
  };
});

// Mongo: stub two collections we touch.
const agentSkillsDocs: any[] = [];
const hubSkillsDocs: any[] = [];
const agentSkillsUpdates: any[] = [];
const hubSkillsUpdates: any[] = [];

// Track the filter passed to find() so tests can assert hub_ids[] wiring.
const hubFindCalls: any[] = [];

function makeCursor(docs: any[]) {
  return {
    project: () => ({
      limit: () => ({
        async *[Symbol.asyncIterator]() {
          for (const d of docs) yield d;
        },
      }),
    }),
  };
}

function matchHubDocs(filter?: any) {
  let matching = hubSkillsDocs;
  if (filter && filter.hub_id) {
    if (typeof filter.hub_id === "string") {
      matching = hubSkillsDocs.filter((d) => d.hub_id === filter.hub_id);
    } else if (filter.hub_id.$in) {
      matching = hubSkillsDocs.filter((d) =>
        filter.hub_id.$in.includes(d.hub_id),
      );
    }
  }
  return matching;
}

const agentSkillsCol = {
  find: () => makeCursor(agentSkillsDocs),
  // `planTotal()` (streaming path) calls countDocuments to compute the
  // upper bound for the start event's progress bar. Mirror the same
  // shape `find()` would walk so the count + iteration stay aligned.
  countDocuments: jest.fn(async () => agentSkillsDocs.length),
  updateOne: jest.fn(async (filter: any, update: any) => {
    agentSkillsUpdates.push({ filter, update });
    return { matchedCount: 1 };
  }),
};
const hubSkillsCol = {
  find: (filter?: any) => {
    hubFindCalls.push(filter);
    // Mimic the route's filter semantics so the cursor only yields the
    // matching hub docs — keeps the assertions honest end-to-end.
    return makeCursor(matchHubDocs(filter));
  },
  countDocuments: jest.fn(async (filter?: any) => matchHubDocs(filter).length),
  updateOne: jest.fn(async (filter: any, update: any) => {
    hubSkillsUpdates.push({ filter, update });
    return { matchedCount: 1 };
  }),
};

let isMongoDBConfiguredFlag = true;
jest.mock("@/lib/mongodb", () => ({
  get isMongoDBConfigured() {
    return isMongoDBConfiguredFlag;
  },
  getCollection: jest.fn(async (name: string) => {
    if (name === "agent_skills") return agentSkillsCol;
    if (name === "hub_skills") return hubSkillsCol;
    throw new Error(`Unexpected collection: ${name}`);
  }),
}));

// Scanner: configurable per test.
let scannerConfigured = true;
const scanCalls: Array<[string, string, string | undefined]> = [];
const scanResultsQueue: Array<
  | { scan_status: "passed" | "flagged" | "unscanned"; scan_summary?: string }
  | Error
> = [];
jest.mock("@/lib/skill-scan", () => ({
  isSkillScannerConfigured: () => scannerConfigured,
  scanSkillContent: jest.fn(async (name: string, content: string, id?: string) => {
    scanCalls.push([name, content, id]);
    const next = scanResultsQueue.shift();
    if (next instanceof Error) throw next;
    return next ?? { scan_status: "passed", scan_summary: "ok" };
  }),
}));

const recordScanEventMock = jest.fn();
jest.mock("@/lib/skill-scan-history", () => ({
  recordScanEvent: (...args: any[]) => recordScanEventMock(...args),
}));

import { POST } from "../route";

function makeReq(body: unknown = {}, headers: Record<string, string> = {}) {
  // Lower-case lookups so the route's `req.headers.get("accept")` matches
  // regardless of whether the caller passes "Accept" or "accept".
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
  } as any;
}

/**
 * Drain a NDJSON-streaming Response into its individual events. Used by
 * the streaming-path tests so we can assert on the event sequence the
 * `<ScanAllDialog>` consumes.
 */
async function readNdjsonEvents(res: Response): Promise<any[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: any[] = [];
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) events.push(JSON.parse(line));
    }
  }
  if (buf.trim()) events.push(JSON.parse(buf));
  return events;
}

beforeEach(() => {
  jest.clearAllMocks();
  agentSkillsDocs.length = 0;
  hubSkillsDocs.length = 0;
  agentSkillsUpdates.length = 0;
  hubSkillsUpdates.length = 0;
  hubFindCalls.length = 0;
  scanCalls.length = 0;
  scanResultsQueue.length = 0;
  isMongoDBConfiguredFlag = true;
  scannerConfigured = true;
  mockUser.role = "admin";
});

describe("POST /api/skills/scan-all — gating", () => {
  it("rejects non-admins with 403 before scanning", async () => {
    mockUser.role = "user";
    agentSkillsDocs.push({
      id: "s1",
      name: "x",
      skill_content: "# X\nbody",
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(scanCalls).toHaveLength(0);
  });

  it("503 when MongoDB is not configured", async () => {
    isMongoDBConfiguredFlag = false;
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
  });

  it("503 when the scanner URL is not set", async () => {
    scannerConfigured = false;
    const res = await POST(makeReq());
    expect(res.status).toBe(503);
  });

  it("400 on invalid scope", async () => {
    const res = await POST(makeReq({ scope: "bogus" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/skills/scan-all — sweep", () => {
  it("scans custom + hub by default, persists, records events, returns counts", async () => {
    agentSkillsDocs.push(
      { id: "s1", name: "alpha", skill_content: "# alpha\nbody" },
      // No content + no prompts → must be skipped, not scanned.
      { id: "s2", name: "beta", skill_content: "" },
    );
    hubSkillsDocs.push({
      hub_id: "h1",
      skill_id: "k1",
      name: "gamma",
      content: "# gamma\nbody",
    });

    scanResultsQueue.push(
      { scan_status: "passed", scan_summary: "clean" },
      { scan_status: "flagged", scan_summary: "high: x" },
    );

    const res = await POST(makeReq());
    const body = await res.json();
    const data = body.data ?? body;

    // Two real scans (alpha + gamma); beta is skipped.
    expect(scanCalls.map((c) => c[0])).toEqual(["alpha", "gamma"]);
    expect(data.scanned).toBe(2);
    expect(data.skipped).toBe(1);
    expect(data.counts.passed).toBe(1);
    expect(data.counts.flagged).toBe(1);
    expect(data.counts.unscanned).toBe(0);
    expect(data.results).toHaveLength(3);

    // Persisted onto both collections.
    expect(agentSkillsCol.updateOne).toHaveBeenCalledWith(
      { id: "s1" },
      expect.objectContaining({
        $set: expect.objectContaining({ scan_status: "passed" }),
      }),
    );
    expect(hubSkillsCol.updateOne).toHaveBeenCalledWith(
      { hub_id: "h1", skill_id: "k1" },
      expect.objectContaining({
        $set: expect.objectContaining({ scan_status: "flagged" }),
      }),
    );

    // History gets bulk_* triggers, never manual_*.
    const triggers = recordScanEventMock.mock.calls.map((c) => c[0].trigger);
    expect(triggers).toEqual(["bulk_user_skill", "bulk_hub_skill"]);
    expect(recordScanEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "bulk_user_skill",
        skill_id: "s1",
        actor: "admin@example.com",
        scan_status: "passed",
      }),
    );
  });

  it("scope=custom skips hub collection entirely", async () => {
    agentSkillsDocs.push({
      id: "s1",
      name: "alpha",
      skill_content: "# alpha\nbody",
    });
    hubSkillsDocs.push({
      hub_id: "h1",
      skill_id: "k1",
      name: "gamma",
      content: "# gamma\nbody",
    });
    scanResultsQueue.push({ scan_status: "passed" });

    const res = await POST(makeReq({ scope: "custom" }));
    const body = await res.json();
    const data = body.data ?? body;

    expect(scanCalls.map((c) => c[0])).toEqual(["alpha"]);
    expect(hubSkillsCol.updateOne).not.toHaveBeenCalled();
    expect(data.scanned).toBe(1);
  });

  it("captures per-skill scanner errors as unscanned without aborting", async () => {
    agentSkillsDocs.push(
      { id: "s1", name: "alpha", skill_content: "# alpha\nbody" },
      { id: "s2", name: "beta", skill_content: "# beta\nbody" },
    );
    scanResultsQueue.push(new Error("boom"));
    scanResultsQueue.push({ scan_status: "passed", scan_summary: "ok" });

    const res = await POST(makeReq({ scope: "custom" }));
    const body = await res.json();
    const data = body.data ?? body;

    expect(data.scanned).toBe(2);
    expect(data.counts.unscanned).toBe(1);
    expect(data.counts.passed).toBe(1);
    const failed = data.results.find((r: any) => r.id === "s1");
    expect(failed.error).toMatch(/boom/);
    expect(failed.scan_status).toBe("unscanned");
  });

  it("hub_ids[] narrows the hub_skills cursor via $in", async () => {
    hubSkillsDocs.push(
      { hub_id: "h1", skill_id: "k1", name: "alpha", content: "# a" },
      { hub_id: "h2", skill_id: "k2", name: "beta", content: "# b" },
      { hub_id: "h3", skill_id: "k3", name: "gamma", content: "# c" },
    );
    scanResultsQueue.push(
      { scan_status: "passed" },
      { scan_status: "passed" },
    );

    await POST(makeReq({ scope: "hub", hub_ids: ["h1", "h3"] }));

    // Filter must use $in for >1 ids so the route doesn't accidentally
    // drop into the legacy single-hub branch.
    expect(hubFindCalls[0]).toEqual({ hub_id: { $in: ["h1", "h3"] } });
    // Only the two matching hubs were scanned.
    expect(scanCalls.map((c) => c[0]).sort()).toEqual(["alpha", "gamma"]);
  });

  it("hub_ids[] of length 1 collapses to plain equality (no $in)", async () => {
    hubSkillsDocs.push({
      hub_id: "h1",
      skill_id: "k1",
      name: "alpha",
      content: "# a",
    });
    scanResultsQueue.push({ scan_status: "passed" });

    await POST(makeReq({ scope: "hub", hub_ids: ["h1"] }));

    // Mongo can use a more efficient index lookup with `{hub_id: "h1"}`
    // than `{hub_id: {$in: ["h1"]}}`. Belt-and-suspenders assertion.
    expect(hubFindCalls[0]).toEqual({ hub_id: "h1" });
    expect(scanCalls).toHaveLength(1);
  });

  it("synthesizes markdown from task prompts when skill_content missing", async () => {
    agentSkillsDocs.push({
      id: "s1",
      name: "promptonly",
      tasks: [{ llm_prompt: "step one" }, { llm_prompt: "step two" }],
    });
    scanResultsQueue.push({ scan_status: "passed" });

    await POST(makeReq({ scope: "custom" }));

    expect(scanCalls).toHaveLength(1);
    const [, content] = scanCalls[0];
    expect(content).toContain("# promptonly");
    expect(content).toContain("## Step 1");
    expect(content).toContain("step one");
    expect(content).toContain("step two");
  });
});

describe("POST /api/skills/scan-all — streaming (Accept: application/x-ndjson)", () => {
  it("emits start → row(s) → complete in order with the same row data the JSON path returns", async () => {
    agentSkillsDocs.push(
      { id: "s1", name: "alpha", skill_content: "# alpha\nbody" },
      { id: "s2", name: "beta", skill_content: "# beta\nbody" },
    );
    scanResultsQueue.push(
      { scan_status: "passed", scan_summary: "clean" },
      { scan_status: "flagged", scan_summary: "high: x" },
    );

    const res = await POST(
      makeReq({ scope: "custom" }, { accept: "application/x-ndjson" }),
    );
    expect(res.headers.get("Content-Type")).toMatch(/x-ndjson/);

    const events = await readNdjsonEvents(res as unknown as Response);

    // Sequence: 1× start, N× row, 1× complete.
    expect(events[0]).toEqual({
      type: "start",
      scope: "custom",
      total_planned: 2,
    });
    const rows = events.filter((e) => e.type === "row");
    expect(rows.map((r) => r.row.name)).toEqual(["alpha", "beta"]);
    expect(rows[0].row.scan_status).toBe("passed");
    expect(rows[1].row.scan_status).toBe("flagged");
    expect(rows.map((r) => r.index)).toEqual([0, 1]);

    const complete = events.at(-1);
    expect(complete.type).toBe("complete");
    expect(complete.summary.scanned).toBe(2);
    expect(complete.summary.counts.passed).toBe(1);
    expect(complete.summary.counts.flagged).toBe(1);
    expect(complete.summary.results).toHaveLength(2);
  });

  it("counts skipped rows in start total but emits them as row events too", async () => {
    agentSkillsDocs.push(
      { id: "s1", name: "alpha", skill_content: "" }, // skipped
      { id: "s2", name: "beta", skill_content: "# beta\nbody" },
    );
    scanResultsQueue.push({ scan_status: "passed" });

    const res = await POST(
      makeReq({ scope: "custom" }, { accept: "application/x-ndjson" }),
    );
    const events = await readNdjsonEvents(res as unknown as Response);

    // total_planned reflects what the cursor will yield (countDocuments),
    // not what actually scans — important so the UI's progress bar lines
    // up when the dialog increments per `row` event.
    expect(events[0].total_planned).toBe(2);
    const rowEvents = events.filter((e) => e.type === "row");
    expect(rowEvents).toHaveLength(2);
    expect(rowEvents[0].row.name).toBe("alpha");
    expect(rowEvents[0].row.scan_status).toBe("unscanned");
    expect(rowEvents[0].row.error).toMatch(/No SKILL\.md/);
  });
});
