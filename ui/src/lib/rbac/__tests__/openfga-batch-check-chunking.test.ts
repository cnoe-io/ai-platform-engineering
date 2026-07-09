/**
 * @jest-environment node
 *
 * Unit tests for OpenFGA batch-check chunking.
 *
 * Why this matters: OpenFGA's HTTP `/batch-check` endpoint caps each call
 * at 50 checks by default (`max_checks_per_batch_check`). The admin-tab-gates
 * fallback (`hasAccessibleSlackChannel`/`hasAccessibleWebexSpace`) fans a
 * (can_read, can_manage) check out over every active
 * channel_team_mappings/webex_space_team_mappings row — 26+ active rows
 * already exceeds the limit. The un-chunked call failed outright, and the
 * caller's blanket try/catch silently treated every check as denied,
 * hiding the Slack/Webex admin tab for non-admin users who had valid
 * per-channel grants. This test pins the chunking fix.
 */

import { batchCheckOpenFgaTuples, type OpenFgaTupleKey } from "../openfga";

function tuple(i: number): OpenFgaTupleKey {
  return {
    user: `user:u-${i}`,
    relation: i % 2 === 0 ? "can_read" : "can_manage",
    object: `slack_channel:CAIPE--C${i}`,
  };
}

describe("batchCheckOpenFgaTuples (chunked)", () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.OPENFGA_HTTP = "http://openfga.test";
    process.env.OPENFGA_STORE_NAME = "caipe-openfga-test";
    delete process.env.OPENFGA_STORE_ID;
    delete process.env.OPENFGA_MAX_CHECKS_PER_BATCH;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    process.env = { ...ORIGINAL_ENV };
  });

  /**
   * Wire a fake `fetch` that resolves store discovery (GET /stores) the
   * same way production does — only OPENFGA_HTTP is set, no
   * OPENFGA_STORE_ID override — then delegates /batch-check calls to the
   * per-test callback.
   */
  function mockFetch(batchCheckBehavior: (body: { checks: Array<{ tuple_key: OpenFgaTupleKey; correlation_id: string }> }) => Response | Promise<Response>) {
    const batchCheckBodies: unknown[] = [];
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/stores") && (!init || init.method === "GET" || !init.method)) {
        return new Response(
          JSON.stringify({ stores: [{ id: "store-id", name: "caipe-openfga-test" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("/batch-check")) {
        const body = init?.body ? JSON.parse(String(init.body)) : { checks: [] };
        batchCheckBodies.push(body);
        return batchCheckBehavior(body);
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;
    return { fetchMock, batchCheckBodies };
  }

  it("issues a single /batch-check call for <= 50 tuples", async () => {
    const tuples = Array.from({ length: 50 }, (_, i) => tuple(i));
    const { batchCheckBodies } = mockFetch((body) => {
      const result: Record<string, { allowed: boolean }> = {};
      body.checks.forEach((c) => { result[c.correlation_id] = { allowed: true }; });
      return new Response(JSON.stringify({ result }), { status: 200 });
    });

    const results = await batchCheckOpenFgaTuples(tuples);

    expect(batchCheckBodies).toHaveLength(1);
    expect(results).toHaveLength(50);
    expect(results.every(Boolean)).toBe(true);
  });

  it("splits 174 tuples (the prod channel_team_mappings scale) into four <=50 chunks", async () => {
    // Mirrors the real bug: 174 active channel_team_mappings rows x 2
    // checks (can_read, can_manage) = 348 tuples. Using 174 tuples directly
    // here to keep the test focused on the chunking boundary math.
    const tuples = Array.from({ length: 174 }, (_, i) => tuple(i));
    const { batchCheckBodies } = mockFetch((body) => {
      const result: Record<string, { allowed: boolean }> = {};
      // Only tuple index 100 (arbitrary) is actually granted, to prove
      // results map back to the right tuple across chunk boundaries.
      body.checks.forEach((c) => {
        result[c.correlation_id] = { allowed: c.tuple_key.object === "slack_channel:CAIPE--C100" };
      });
      return new Response(JSON.stringify({ result }), { status: 200 });
    });

    const results = await batchCheckOpenFgaTuples(tuples);

    expect(batchCheckBodies).toHaveLength(4);
    const chunkSizes = (batchCheckBodies as Array<{ checks: unknown[] }>).map((b) => b.checks.length);
    expect(chunkSizes).toEqual([50, 50, 50, 24]);
    expect(results).toHaveLength(174);
    expect(results.filter(Boolean)).toEqual([true]);
    expect(results[100]).toBe(true);
  });

  it("propagates a chunk failure instead of silently denying every check", async () => {
    const tuples = Array.from({ length: 60 }, (_, i) => tuple(i));
    let callIndex = 0;
    mockFetch(() => {
      callIndex += 1;
      if (callIndex === 2) {
        return new Response("exceeded_checks_limit", { status: 400 });
      }
      return new Response(JSON.stringify({ result: {} }), { status: 200 });
    });

    await expect(batchCheckOpenFgaTuples(tuples)).rejects.toThrow(
      /OpenFGA batch-check failed: 400/,
    );
  });

  it("respects OPENFGA_MAX_CHECKS_PER_BATCH when set to a smaller value", async () => {
    process.env.OPENFGA_MAX_CHECKS_PER_BATCH = "10";
    const tuples = Array.from({ length: 25 }, (_, i) => tuple(i));
    const { batchCheckBodies } = mockFetch((body) => {
      const result: Record<string, { allowed: boolean }> = {};
      body.checks.forEach((c) => { result[c.correlation_id] = { allowed: false }; });
      return new Response(JSON.stringify({ result }), { status: 200 });
    });

    const results = await batchCheckOpenFgaTuples(tuples);

    expect(batchCheckBodies).toHaveLength(3);
    const chunkSizes = (batchCheckBodies as Array<{ checks: unknown[] }>).map((b) => b.checks.length);
    expect(chunkSizes).toEqual([10, 10, 5]);
    expect(results).toHaveLength(25);
  });
});
