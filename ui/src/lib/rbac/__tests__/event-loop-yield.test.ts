import { loopYieldEvery, maybeYield, yieldToEventLoop } from "../event-loop-yield";

describe("event-loop-yield", () => {
  const originalEnv = process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY;
    else process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY = originalEnv;
  });

  describe("loopYieldEvery", () => {
    it("defaults to 500 when the env var is unset", () => {
      delete process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY;
      expect(loopYieldEvery()).toBe(500);
    });

    it("honors a valid override", () => {
      process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY = "25";
      expect(loopYieldEvery()).toBe(25);
    });

    it("floors fractional overrides", () => {
      process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY = "7.9";
      expect(loopYieldEvery()).toBe(7);
    });

    it("falls back to the default for invalid or sub-1 values", () => {
      for (const bad of ["0", "-4", "abc", ""]) {
        process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY = bad;
        expect(loopYieldEvery()).toBe(500);
      }
    });
  });

  describe("yieldToEventLoop", () => {
    it("uses setImmediate when available", async () => {
      // jsdom (this test env) has NO setImmediate, which is why the sync path
      // originally threw ReferenceError here; inject a stub to exercise the
      // Node-runtime branch and confirm it's the scheduler that gets called.
      const stub = jest.fn((cb: () => void) => setTimeout(cb, 0));
      (globalThis as { setImmediate?: unknown }).setImmediate = stub;
      try {
        await expect(yieldToEventLoop()).resolves.toBeUndefined();
        expect(stub).toHaveBeenCalledTimes(1);
      } finally {
        delete (globalThis as { setImmediate?: unknown }).setImmediate;
      }
    });

    it("falls back to setTimeout when setImmediate is unavailable", async () => {
      // The jsdom env has no setImmediate; the fallback must schedule a
      // macrotask instead of throwing ReferenceError.
      expect((globalThis as { setImmediate?: unknown }).setImmediate).toBeUndefined();
      await expect(yieldToEventLoop()).resolves.toBeUndefined();
    });
  });

  describe("maybeYield", () => {
    it("only yields when count is a positive multiple of every", async () => {
      // jsdom has no setImmediate, so yieldToEventLoop uses the setTimeout
      // fallback; spy on it to count macrotask scheduling.
      const spy = jest.spyOn(globalThis, "setTimeout");
      try {
        spy.mockClear();
        await maybeYield(0, 3); // count 0 → never yields
        await maybeYield(1, 3);
        await maybeYield(2, 3);
        expect(spy).not.toHaveBeenCalled();
        await maybeYield(3, 3); // multiple → yields
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
