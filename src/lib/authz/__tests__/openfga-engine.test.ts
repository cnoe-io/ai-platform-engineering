/**
 * @jest-environment node
 */
import { createOpenFgaAdmin, createOpenFgaEngine, describeFgaCheck, getEngineStats, __resetAdapterStateForTests } from "../engines/openfga";
import type { AuthorizeRequest } from "../contract";

const realFetch = global.fetch;

function checkResponse(allowed: boolean): Response {
  return { ok: true, status: 200, json: async () => ({ allowed }) } as unknown as Response;
}
function storesResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ stores: [{ id: "store-xyz", name: "caipe-openfga" }] }),
  } as unknown as Response;
}

const req: AuthorizeRequest = {
  subject: { type: "user", id: "alice" },
  resource: { type: "agent", id: "pe" },
  action: "use",
};

describe("OpenFGA engine adapter", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.OPENFGA_HTTP = "http://openfga:8080";
    process.env.OPENFGA_STORE_ID = "store-xyz"; // skip discovery unless a test clears it
    __resetAdapterStateForTests();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.OPENFGA_STORE_ID;
  });

  it("maps allowed:true → ALLOW (via tuple)", async () => {
    fetchMock.mockResolvedValue(checkResponse(true));
    const r = await createOpenFgaEngine().check(req);
    expect(r.decision).toBe("ALLOW");
    expect(r.reason).toBe("OK");
    expect(r.via).toBe("tuple");
  });

  it("maps allowed:false → DENY/NO_CAPABILITY", async () => {
    fetchMock.mockResolvedValue(checkResponse(false));
    const r = await createOpenFgaEngine().check(req);
    expect(r).toMatchObject({ decision: "DENY", reason: "NO_CAPABILITY" });
  });

  it("fails closed to AUTHZ_UNAVAILABLE when OpenFGA errors", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await createOpenFgaEngine().check(req);
    expect(r).toMatchObject({ decision: "DENY", reason: "AUTHZ_UNAVAILABLE", retriable: true });
  });

  it("caches a definitive decision (second identical check hits no fetch)", async () => {
    fetchMock.mockResolvedValue(checkResponse(true));
    const engine = createOpenFgaEngine();
    await engine.check(req);
    await engine.check(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches AUTHZ_UNAVAILABLE (retries on next call)", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const engine = createOpenFgaEngine();
    await engine.check(req);
    await engine.check(req);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("opens the circuit after the failure threshold and stops calling OpenFGA", async () => {
    fetchMock.mockRejectedValue(new Error("down"));
    const engine = createOpenFgaEngine();
    // 5 failures trip the breaker.
    for (let i = 0; i < 5; i++) await engine.check(req);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    // 6th is short-circuited by the open breaker — no further fetch.
    const r = await engine.check(req);
    expect(r.reason).toBe("AUTHZ_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("discovers and caches the store id when OPENFGA_STORE_ID is unset", async () => {
    delete process.env.OPENFGA_STORE_ID;
    __resetAdapterStateForTests();
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/stores") ? storesResponse() : checkResponse(true),
    );
    const engine = createOpenFgaEngine();
    await engine.check(req); // /stores + /check
    await engine.check({ ...req, resource: { type: "agent", id: "other" } }); // /check only (store cached)
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.endsWith("/stores")).length).toBe(1);
  });

  it("batchCheck returns one decision per id", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return checkResponse(body.tuple_key.object === "agent:yes");
    });
    const results = await createOpenFgaEngine().batchCheck(
      { type: "user", id: "alice" },
      "use",
      "agent",
      ["yes", "no"],
    );
    expect(results.get("yes")?.decision).toBe("ALLOW");
    expect(results.get("no")?.decision).toBe("DENY");
  });

  it("invalidates the cached store id and fails closed when a check returns 404", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as unknown as Response);
    const r = await createOpenFgaEngine().check(req);
    expect(r).toMatchObject({ decision: "DENY", reason: "AUTHZ_UNAVAILABLE" });
  });

  it("fails closed to AUTHZ_UNAVAILABLE when store discovery returns non-ok", async () => {
    delete process.env.OPENFGA_STORE_ID;
    __resetAdapterStateForTests();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const r = await createOpenFgaEngine().check(req);
    expect(r).toMatchObject({ decision: "DENY", reason: "AUTHZ_UNAVAILABLE" });
  });

  it("getEngineStats tracks cache hits/misses and circuit state", async () => {
    fetchMock.mockResolvedValue(checkResponse(true));
    const engine = createOpenFgaEngine();
    await engine.check(req); // miss → fetch
    await engine.check(req); // hit
    const s = getEngineStats();
    expect(s.cacheMisses).toBe(1);
    expect(s.cacheHits).toBe(1);
    expect(s.cacheHitRatio).toBeCloseTo(0.5);
    expect(s.circuitState).toBe("closed");
    expect(s.cacheSize).toBeGreaterThanOrEqual(1);
  });

  describe("circuit breaker recovery", () => {
    afterEach(() => jest.restoreAllMocks());

    it("transitions open → half_open after cooldown, then closes on a successful probe", async () => {
      let now = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => now);
      fetchMock.mockRejectedValue(new Error("down"));
      const engine = createOpenFgaEngine();
      for (let i = 0; i < 5; i++) await engine.check(req); // trip open
      expect(getEngineStats().circuitState).toBe("open");

      // Within cooldown: short-circuited, no new fetch.
      const callsBefore = fetchMock.mock.calls.length;
      expect((await engine.check(req)).reason).toBe("AUTHZ_UNAVAILABLE");
      expect(fetchMock.mock.calls.length).toBe(callsBefore);

      // After cooldown: half-open probe succeeds → closed.
      now += 31_000;
      fetchMock.mockResolvedValue(checkResponse(true));
      const r = await engine.check(req);
      expect(r.decision).toBe("ALLOW");
      expect(getEngineStats().circuitState).toBe("closed");
    });

    it("re-opens if the half-open probe fails", async () => {
      let now = 2_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => now);
      fetchMock.mockRejectedValue(new Error("down"));
      const engine = createOpenFgaEngine();
      for (let i = 0; i < 5; i++) await engine.check(req);
      now += 31_000;
      await engine.check(req); // probe fails → re-open
      expect(getEngineStats().circuitState).toBe("open");
    });

    it("admits only one probe while half-open (concurrent callers fail closed)", async () => {
      let now = 3_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => now);
      fetchMock.mockRejectedValue(new Error("down"));
      const engine = createOpenFgaEngine();
      for (let i = 0; i < 5; i++) await engine.check(req); // open
      now += 31_000;

      // Make the probe hang so a second concurrent caller observes probeInFlight.
      let release: (v: Response) => void = () => {};
      fetchMock.mockImplementation(() => new Promise<Response>((res) => { release = res; }));
      const p1 = engine.check(req); // becomes the single probe
      const p2 = engine.check(req); // denied — a probe is already in flight
      expect((await p2).reason).toBe("AUTHZ_UNAVAILABLE");
      release(checkResponse(true));
      expect((await p1).decision).toBe("ALLOW");
    });
  });

  describe("PolicyAdmin (grant/revoke)", () => {
    function writeResponse(): Response {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }

    it("grant writes the base-relation tuple (team→use agent)", async () => {
      fetchMock.mockResolvedValue(writeResponse());
      await createOpenFgaAdmin().grant({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" });
      const writeCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/write"));
      const body = JSON.parse((writeCall![1] as RequestInit).body as string);
      expect(body.writes.tuple_keys[0]).toEqual({ user: "team:eng#member", relation: "user", object: "agent:pe" });
      expect(body.deletes).toBeUndefined();
    });

    it("grant for 'everyone' writes a user:* wildcard tuple", async () => {
      fetchMock.mockResolvedValue(writeResponse());
      await createOpenFgaAdmin().grant({ resource: { type: "agent", id: "pe" }, grantee: { type: "everyone" }, capability: "use" });
      const body = JSON.parse((fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/write"))![1] as RequestInit).body as string);
      expect(body.writes.tuple_keys[0]).toEqual({ user: "user:*", relation: "user", object: "agent:pe" });
    });

  it("revoke deletes the tuple", async () => {
    fetchMock.mockResolvedValue(writeResponse());
    await createOpenFgaAdmin().revoke({ resource: { type: "knowledge_base", id: "kb1" }, grantee: { type: "user", id: "alice" }, capability: "read" });
    const body = JSON.parse((fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/write"))![1] as RequestInit).body as string);
    expect(body.deletes.tuple_keys[0]).toEqual({ user: "user:alice", relation: "reader", object: "knowledge_base:kb1" });
    expect(body.writes).toBeUndefined();
  });

  it("is idempotent — a 'tuple already exists' 400 does not throw", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => '{"code":"write_failed_due_to_invalid_input","message":"cannot write a tuple which already exists"}' } as unknown as Response);
    await expect(
      createOpenFgaAdmin().grant({ resource: { type: "agent", id: "pe" }, grantee: { type: "user", id: "x" }, capability: "use" }),
    ).resolves.toBeUndefined();
  });

  it("does not hide a grant failure just because the 400 body mentions a missing tuple", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => '{"message":"tuple does not exist"}' } as unknown as Response);
    await expect(
      createOpenFgaAdmin().grant({ resource: { type: "agent", id: "pe" }, grantee: { type: "user", id: "x" }, capability: "use" }),
    ).rejects.toThrow(/write failed/i);
  });

  it("encodes OpenFGA-unsafe llm_model ids through the shared resource encoder", async () => {
    fetchMock.mockResolvedValue(writeResponse());
    await createOpenFgaAdmin().grant({
      resource: { type: "llm_model", id: "global.anthropic.claude-haiku-4-5-20251001-v1:0" },
      grantee: { type: "user", id: "alice" },
      capability: "read",
    });
    const body = JSON.parse((fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/write"))![1] as RequestInit).body as string);
    expect(body.writes.tuple_keys[0].object).toMatch(/^llm_model:b64_/);
  });

  it("throws on a real write failure", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" } as unknown as Response);
    await expect(
      createOpenFgaAdmin().grant({ resource: { type: "agent", id: "pe" }, grantee: { type: "user", id: "x" }, capability: "use" }),
    ).rejects.toThrow(/write failed/i);
  });
  });

  it("describeFgaCheck exposes the relation actually used (single source of truth)", () => {
    expect(describeFgaCheck(req)).toMatchObject({
      engine: "openfga",
      relation: "can_use",
      user: "user:alice",
      object: "agent:pe",
    });
    // create maps to can_manage — explain reflects the real check
    expect(describeFgaCheck({ ...req, action: "create" }).relation).toBe("can_manage");
  });
});
