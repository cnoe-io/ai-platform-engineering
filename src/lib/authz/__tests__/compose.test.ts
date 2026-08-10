/**
 * @jest-environment node
 */
import { compose } from "../compose";
import type { PolicyEngine } from "../engine";
import type { AuthorizeRequest, AuthorizeResult } from "../contract";

function allow(): AuthorizeResult {
  return { decision: "ALLOW", reason: "OK", retriable: false };
}
function deny(): AuthorizeResult {
  return { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };
}

function fakeEngine(): { engine: PolicyEngine; check: jest.Mock; batch: jest.Mock } {
  const check = jest.fn().mockResolvedValue(deny());
  const batch = jest.fn();
  return {
    engine: { check, batchCheck: batch },
    check,
    batch,
  };
}

const req: AuthorizeRequest = { subject: { type: "user", id: "u" }, resource: { type: "agent", id: "a" }, action: "use" };

describe("compose", () => {
  it("passes through to the engine when there is no preCheck", async () => {
    const { engine, check } = fakeEngine();
    const composed = compose(engine);
    await composed.check(req);
    expect(check).toHaveBeenCalledWith(req);
  });

  it("short-circuits when preCheck returns a result", async () => {
    const { engine, check } = fakeEngine();
    const composed = compose(engine, { preCheck: async () => allow() });
    const result = await composed.check(req);
    expect(result.decision).toBe("ALLOW");
    expect(check).not.toHaveBeenCalled();
  });

  it("falls through to the engine when preCheck returns null", async () => {
    const { engine, check } = fakeEngine();
    const composed = compose(engine, { preCheck: async () => null });
    await composed.check(req);
    expect(check).toHaveBeenCalledWith(req);
  });

  it("batchCheck without a preCheck delegates straight to the engine", async () => {
    const { engine, batch } = fakeEngine();
    batch.mockResolvedValue(new Map([["a", allow()]]));
    const composed = compose(engine);
    const r = await composed.batchCheck({ type: "user", id: "u" }, "discover", "agent", ["a"]);
    expect(r.get("a")?.decision).toBe("ALLOW");
    expect(batch).toHaveBeenCalledWith({ type: "user", id: "u" }, "discover", "agent", ["a"]);
  });

  it("batchCheck splits overrides from engine passthrough", async () => {
    const { engine, batch } = fakeEngine();
    batch.mockResolvedValue(new Map([["b", deny()]]));
    const composed = compose(engine, {
      preCheck: async (r) => (r.resource.id === "a" ? allow() : null),
    });
    const results = await composed.batchCheck({ type: "user", id: "u" }, "use", "agent", ["a", "b"]);
    expect(results.get("a")?.decision).toBe("ALLOW"); // from preCheck
    expect(results.get("b")?.decision).toBe("DENY"); // from engine
    expect(batch).toHaveBeenCalledWith({ type: "user", id: "u" }, "use", "agent", ["b"]);
  });
});
