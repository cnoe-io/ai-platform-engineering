/**
 * @jest-environment node
 */

// The engine fns must be created INSIDE the factory: index.ts builds its
// singleton engine at module load (before outer consts initialize), so the
// factory cannot reference variables declared after the hoisted imports.
jest.mock("../engines/openfga", () => {
  const check = jest.fn();
  const batchCheck = jest.fn();
  return {
    __esModule: true,
    createOpenFgaEngine: () => ({ check, batchCheck }),
    describeFgaCheck: jest.fn(),
    getEngineStats: jest.fn(() => ({ circuitState: "closed", cacheSize: 0, cacheHits: 0, cacheMisses: 0, cacheHitRatio: 0 })),
    __mocks: { check, batchCheck },
  };
});
// Audit is a no-op in tests (Mongo unconfigured).
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn(), isMongoDBConfigured: false }));

import * as openfgaEngine from "../engines/openfga";
const { check: mockCheck, batchCheck: mockBatch } = (
  openfgaEngine as unknown as { __mocks: { check: jest.Mock; batchCheck: jest.Mock } }
).__mocks;

import {
  authorize,
  authorizeMany,
  authorizeOrThrow,
  filterAccessible,
  AuthzDeniedError,
  describeFgaCheck,
  getEngineStats,
  type AuthorizeResult,
} from "../index";

const ALLOW: AuthorizeResult = { decision: "ALLOW", reason: "OK", retriable: false };
const DENY: AuthorizeResult = { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };

beforeEach(() => jest.clearAllMocks());

describe("authorize", () => {
  it("returns the engine's decision", async () => {
    mockCheck.mockResolvedValue(ALLOW);
    const r = await authorize({ subject: { type: "user", id: "u" }, resource: { type: "agent", id: "a" }, action: "use" });
    expect(r.decision).toBe("ALLOW");
  });
});

describe("authorizeOrThrow", () => {
  it("resolves on ALLOW", async () => {
    mockCheck.mockResolvedValue(ALLOW);
    await expect(
      authorizeOrThrow({ subject: { type: "user", id: "u" }, resource: { type: "agent", id: "a" }, action: "use" }),
    ).resolves.toBeUndefined();
  });
  it("throws AuthzDeniedError on DENY", async () => {
    mockCheck.mockResolvedValue(DENY);
    await expect(
      authorizeOrThrow({ subject: { type: "user", id: "u" }, resource: { type: "agent", id: "a" }, action: "use" }),
    ).rejects.toBeInstanceOf(AuthzDeniedError);
  });
});

describe("filterAccessible", () => {
  it("returns only the ALLOWed ids", async () => {
    mockBatch.mockResolvedValue(new Map([["a", ALLOW], ["b", DENY], ["c", ALLOW]]));
    const out = await filterAccessible({ type: "user", id: "u" }, "discover", "agent", ["a", "b", "c"]);
    expect(out).toEqual(["a", "c"]);
  });
  it("short-circuits an empty id list without calling the engine", async () => {
    const out = await filterAccessible({ type: "user", id: "u" }, "discover", "agent", []);
    expect(out).toEqual([]);
    expect(mockBatch).not.toHaveBeenCalled();
  });
});

describe("authorizeMany", () => {
  it("delegates to the engine batch", async () => {
    mockBatch.mockResolvedValue(new Map([["a", ALLOW]]));
    const r = await authorizeMany({ type: "user", id: "u" }, "read", "task", ["a"]);
    expect(r.get("a")?.decision).toBe("ALLOW");
    expect(mockBatch).toHaveBeenCalledWith({ type: "user", id: "u" }, "read", "task", ["a"]);
  });
});

describe("re-exports", () => {
  it("surfaces describeFgaCheck and getEngineStats from the engine", () => {
    expect(describeFgaCheck).toBeDefined();
    expect(getEngineStats).toBeDefined();
    expect(getEngineStats()).toMatchObject({ circuitState: "closed" });
  });
});
