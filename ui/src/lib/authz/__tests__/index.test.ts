/**
 * @jest-environment node
 */

// The engine fns must be created INSIDE the factory: index.ts builds its
// singleton engine at module load (before outer consts initialize).
jest.mock("../engines/openfga", () => {
  const check = jest.fn();
  const batchCheck = jest.fn();
  const grant = jest.fn();
  const revoke = jest.fn();
  return {
    __esModule: true,
    createOpenFgaEngine: () => ({ check, batchCheck }),
    createOpenFgaAdmin: () => ({ grant, revoke }),
    describeFgaCheck: jest.fn(),
    getEngineStats: jest.fn(() => ({ circuitState: "closed", cacheSize: 0, cacheHits: 0, cacheMisses: 0, cacheHitRatio: 0 })),
    __mocks: { check, batchCheck, grant, revoke },
  };
});
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
  grant,
  revoke,
  AuthzDeniedError,
  describeFgaCheck,
  getEngineStats,
  type AuthorizeResult,
} from "../index";

const { grant: mockGrant, revoke: mockRevoke } = (
  openfgaEngine as unknown as { __mocks: { grant: jest.Mock; revoke: jest.Mock } }
).__mocks;

const ALLOW: AuthorizeResult = { decision: "ALLOW", reason: "OK", retriable: false, via: "tuple" };
const DENY: AuthorizeResult = { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };

const isOrgManage = (req: { resource: { type: string }; action: string }) =>
  req.resource.type === "organization" && req.action === "manage";

/** Default: caller is NOT an org admin (org#manage → DENY); resource → `d`. */
function withResourceDecision(d: AuthorizeResult) {
  mockCheck.mockImplementation(async (req) => (isOrgManage(req) ? DENY : d));
}

const userReq = { subject: { type: "user" as const, id: "u" }, resource: { type: "agent" as const, id: "a" }, action: "use" as const };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RAG_ADMIN_BYPASS_DISABLED;
  withResourceDecision(DENY);
});

describe("authorize", () => {
  it("returns the engine's tuple decision when the caller is not an org admin", async () => {
    withResourceDecision(ALLOW);
    const r = await authorize(userReq);
    expect(r.decision).toBe("ALLOW");
    expect(r.via).toBe("tuple");
  });
});

describe("org-admin bypass", () => {
  it("ALLOWs (via org_admin) when the subject has can_manage on the organization", async () => {
    mockCheck.mockImplementation(async (req) => (isOrgManage(req) ? ALLOW : DENY));
    // resource tuple would DENY, but the org-admin bypass wins
    const r = await authorize({ subject: { type: "user", id: "admin" }, resource: { type: "knowledge_base", id: "kb1" }, action: "manage" });
    expect(r.decision).toBe("ALLOW");
    expect(r.via).toBe("org_admin");
  });

  it("does NOT bypass for service_account subjects", async () => {
    mockCheck.mockImplementation(async (req) => (isOrgManage(req) ? ALLOW : DENY));
    const r = await authorize({ subject: { type: "service_account", id: "bot" }, resource: { type: "knowledge_base", id: "kb1" }, action: "manage" });
    expect(r.decision).toBe("DENY");
  });

  it("does NOT bypass when RAG_ADMIN_BYPASS_DISABLED is set", async () => {
    process.env.RAG_ADMIN_BYPASS_DISABLED = "true";
    mockCheck.mockImplementation(async (req) => (isOrgManage(req) ? ALLOW : DENY));
    const r = await authorize({ subject: { type: "user", id: "admin" }, resource: { type: "knowledge_base", id: "kb1" }, action: "manage" });
    expect(r.decision).toBe("DENY");
  });
});

describe("authorizeOrThrow", () => {
  it("resolves on ALLOW", async () => {
    withResourceDecision(ALLOW);
    await expect(authorizeOrThrow(userReq)).resolves.toBeUndefined();
  });
  it("throws AuthzDeniedError on DENY", async () => {
    await expect(authorizeOrThrow(userReq)).rejects.toBeInstanceOf(AuthzDeniedError);
  });
});

describe("filterAccessible", () => {
  it("returns only the ALLOWed ids (non-admin → engine batch decides)", async () => {
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
  it("delegates to the engine batch for non-admin subjects", async () => {
    mockBatch.mockResolvedValue(new Map([["a", ALLOW]]));
    const r = await authorizeMany({ type: "user", id: "u" }, "read", "task", ["a"]);
    expect(r.get("a")?.decision).toBe("ALLOW");
    expect(mockBatch).toHaveBeenCalledWith({ type: "user", id: "u" }, "read", "task", ["a"]);
  });
});

describe("grant / revoke (PAP)", () => {
  it("grant delegates to the admin engine", async () => {
    const intent = { resource: { type: "agent" as const, id: "pe" }, grantee: { type: "team" as const, id: "eng" }, capability: "use" as const };
    await grant(intent);
    expect(mockGrant).toHaveBeenCalledWith(intent);
  });
  it("revoke delegates to the admin engine", async () => {
    const intent = { resource: { type: "agent" as const, id: "pe" }, grantee: { type: "everyone" as const }, capability: "use" as const };
    await revoke(intent);
    expect(mockRevoke).toHaveBeenCalledWith(intent);
  });
});

describe("re-exports", () => {
  it("surfaces describeFgaCheck and getEngineStats from the engine", () => {
    expect(describeFgaCheck).toBeDefined();
    expect(getEngineStats).toBeDefined();
    expect(getEngineStats()).toMatchObject({ circuitState: "closed" });
  });
});
