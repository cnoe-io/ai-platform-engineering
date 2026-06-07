/**
 * @jest-environment node
 *
 * Security-critical: these helpers enforce the CAS trust boundary. The
 * binding rule must FAIL CLOSED.
 */

const mockAuthorize = jest.fn();
jest.mock("../index", () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
}));

import {
  HttpAuthzError,
  decisionContext,
  enforceSubjectBinding,
  isValidId,
  parseAction,
  parseGrantIntent,
  parseGrantee,
  parseResource,
  parseResourceType,
  parseSubject,
  requireAuditCapability,
  requireManage,
  resolveCaller,
  type Caller,
} from "../http";

beforeEach(() => jest.clearAllMocks());

describe("resolveCaller — fail closed", () => {
  it("returns null when session is missing or not an object", () => {
    expect(resolveCaller(null)).toBeNull();
    expect(resolveCaller(undefined)).toBeNull();
    expect(resolveCaller("nope")).toBeNull();
  });

  it("returns null when there is no stable sub (catalog-key / local-skills token)", () => {
    expect(resolveCaller({ role: "user", catalogKey: "abc" })).toBeNull();
    expect(resolveCaller({ sub: "" })).toBeNull();
    expect(resolveCaller({ sub: "   " })).toBeNull();
  });

  it("resolves a user subject from a bearer/cookie session", () => {
    expect(resolveCaller({ sub: "alice-sub" })).toEqual({ type: "user", id: "alice-sub" });
  });

  it("graphs an explicit service account under service_account:", () => {
    expect(resolveCaller({ sub: "bot-sa", isServiceAccount: true })).toEqual({
      type: "service_account",
      id: "bot-sa",
    });
  });
});

describe("decisionContext", () => {
  it("derives tenant from session.org and mints a correlation id", () => {
    const ctx = decisionContext({ org: "acme" });
    expect(ctx.tenantId).toBe("acme");
    expect(typeof ctx.correlationId).toBe("string");
  });
  it("leaves tenant undefined when there is no org claim", () => {
    expect(decisionContext({ sub: "x" }).tenantId).toBeUndefined();
  });
});

describe("isValidId — rejects OpenFGA structure and abuse", () => {
  it("accepts UUIDs, emails, and resource ids", () => {
    expect(isValidId("platform-engineer")).toBe(true);
    expect(isValidId("3f1a-9b2c")).toBe(true);
    expect(isValidId("alice@example.com")).toBe(true);
  });
  it("rejects wildcard, relation/type separators, and path traversal", () => {
    expect(isValidId("*")).toBe(false);
    expect(isValidId("agent:*")).toBe(false);
    expect(isValidId("team:eng#member")).toBe(false);
    expect(isValidId("../etc/passwd")).toBe(false);
  });
  it("rejects empty and overlong ids", () => {
    expect(isValidId("")).toBe(false);
    expect(isValidId("a".repeat(257))).toBe(false);
  });
});

describe("parsers", () => {
  it("parseSubject accepts valid and rejects bad type/id", () => {
    expect(parseSubject({ type: "user", id: "x" })).toEqual({ type: "user", id: "x" });
    expect(() => parseSubject({ type: "robot", id: "x" })).toThrow(HttpAuthzError);
    expect(() => parseSubject({ type: "user", id: "a*b" })).toThrow(HttpAuthzError);
    expect(() => parseSubject(null)).toThrow(HttpAuthzError);
  });
  it("parseResource validates type + id", () => {
    expect(parseResource({ type: "agent", id: "pe" })).toEqual({ type: "agent", id: "pe" });
    expect(() => parseResource({ type: "nope", id: "x" })).toThrow(HttpAuthzError);
  });
  it("parseResource rejects a missing object and an invalid id", () => {
    expect(() => parseResource(null)).toThrow(HttpAuthzError);
    expect(() => parseResource({ type: "agent", id: "a*b" })).toThrow(HttpAuthzError);
  });
  it("parseAction / parseResourceType validate membership", () => {
    expect(parseAction("use")).toBe("use");
    expect(() => parseAction("frobnicate")).toThrow(HttpAuthzError);
    expect(parseResourceType("task")).toBe("task");
    expect(() => parseResourceType("nope")).toThrow(HttpAuthzError);
  });
});

describe("enforceSubjectBinding — the core control", () => {
  const caller: Caller = { type: "user", id: "alice" };

  it("allows a caller to evaluate its own subject without consulting the PDP", async () => {
    await expect(
      enforceSubjectBinding(caller, { type: "user", id: "alice" }, {}),
    ).resolves.toBeUndefined();
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("rejects cross-subject evaluation without can_audit (403)", async () => {
    mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
    await expect(
      enforceSubjectBinding(caller, { type: "user", id: "bob" }, {}),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("permits cross-subject evaluation when the caller holds can_audit", async () => {
    mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK" });
    await expect(
      enforceSubjectBinding(caller, { type: "user", id: "bob" }, {}),
    ).resolves.toBeUndefined();
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "audit", resource: { type: "organization", id: "caipe" } }),
      expect.anything(),
    );
  });

  it("treats a type mismatch on the same id as cross-subject", async () => {
    mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
    await expect(
      enforceSubjectBinding(caller, { type: "service_account", id: "alice" }, {}),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("grant parsing", () => {
  it("parseGrantee accepts user/team/everyone and rejects bad types/ids", () => {
    expect(parseGrantee({ type: "team", id: "eng" })).toEqual({ type: "team", id: "eng" });
    expect(parseGrantee({ type: "everyone" })).toEqual({ type: "everyone" });
    expect(() => parseGrantee({ type: "nope", id: "x" })).toThrow(HttpAuthzError);
    expect(() => parseGrantee({ type: "user", id: "a*b" })).toThrow(HttpAuthzError);
  });
  it("parseGrantIntent validates resource + grantee + capability", () => {
    expect(parseGrantIntent({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "use" })).toEqual({
      resource: { type: "agent", id: "pe" },
      grantee: { type: "team", id: "eng" },
      capability: "use",
    });
    expect(() => parseGrantIntent({ resource: { type: "agent", id: "pe" }, grantee: { type: "team", id: "eng" }, capability: "frobnicate" })).toThrow(HttpAuthzError);
  });
});

describe("requireManage (grant meta-authz)", () => {
  const caller: Caller = { type: "user", id: "admin" };
  it("passes when the caller can manage the resource", async () => {
    mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK" });
    await expect(requireManage(caller, { type: "agent", id: "pe" }, {})).resolves.toBeUndefined();
    expect(mockAuthorize).toHaveBeenCalledWith(expect.objectContaining({ action: "manage", resource: { type: "agent", id: "pe" } }), expect.anything());
  });
  it("throws 403 when the caller cannot manage the resource", async () => {
    mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
    await expect(requireManage(caller, { type: "agent", id: "pe" }, {})).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("requireAuditCapability", () => {
  it("throws 403 without can_audit", async () => {
    mockAuthorize.mockResolvedValue({ decision: "DENY", reason: "NO_CAPABILITY" });
    await expect(requireAuditCapability({ type: "user", id: "x" }, {})).rejects.toMatchObject({
      status: 403,
    });
  });
  it("passes with can_audit", async () => {
    mockAuthorize.mockResolvedValue({ decision: "ALLOW", reason: "OK" });
    await expect(requireAuditCapability({ type: "user", id: "x" }, {})).resolves.toBeUndefined();
  });
});
