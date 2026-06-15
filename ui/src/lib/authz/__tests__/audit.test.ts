/**
 * @jest-environment node
 */

const mockInsertOne = jest.fn();
const mockGetCollection = jest.fn(async () => ({ insertOne: mockInsertOne }));
let mongoConfigured = true;

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...a: unknown[]) => mockGetCollection(...a),
  get isMongoDBConfigured() {
    return mongoConfigured;
  },
}));

import { buildDecisionEvent, buildGrantEvent, emitDecisionAudit, emitGrantAudit } from "../audit";

const subject = { type: "user" as const, id: "alice" };
const resource = { type: "agent" as const, id: "platform-engineer" };

beforeEach(() => {
  jest.clearAllMocks();
  mongoConfigured = true;
  mockInsertOne.mockResolvedValue({ acknowledged: true });
});

describe("buildDecisionEvent — UnifiedAuditEvent conformance", () => {
  it("maps decision→outcome and builds resource_ref the tab renders", () => {
    const e = buildDecisionEvent(subject, resource, "use", { decision: "DENY", reason: "NO_CAPABILITY", retriable: false });
    expect(e).toMatchObject({
      type: "cas_decision",
      outcome: "deny", // tab reads `outcome`, not `decision`
      action: "use",
      resource_ref: "agent:platform-engineer", // tab reads `resource_ref`
      resource_type: "agent",
      resource_id: "platform-engineer",
      reason_code: "NO_CAPABILITY",
      pdp: "openfga",
      source: "cas",
      component: "cas",
    });
    expect(e.subject_hash).toMatch(/^sha256:/);
    expect(e.subject_hash).not.toContain("alice"); // salted, not raw
  });

  it("maps ALLOW→allow and carries tenant + correlation + trace from context", () => {
    const e = buildDecisionEvent(subject, resource, "use", { decision: "ALLOW", reason: "OK", retriable: false }, {
      tenantId: "acme",
      correlationId: "corr-1",
      traceId: "t-1",
      spanId: "s-1",
    });
    expect(e).toMatchObject({ outcome: "allow", tenant_id: "acme", correlation_id: "corr-1", trace_id: "t-1", span_id: "s-1" });
  });

  it("records decision path and trusted workflow run context when present", () => {
    const e = buildDecisionEvent(
      subject,
      resource,
      "use",
      { decision: "ALLOW", reason: "OK", retriable: false, via: "tuple" },
      { correlationId: "wfrun-20260611200000-abc" },
      { workflowRunId: "wfrun-20260611200000-abc" },
    );

    expect(e).toMatchObject({
      outcome: "allow",
      decision_via: "tuple",
      workflow_run_id: "wfrun-20260611200000-abc",
    });
  });

  it("defaults tenant to 'default' and omits trace fields when absent", () => {
    const e = buildDecisionEvent(subject, resource, "read", { decision: "ALLOW", reason: "OK", retriable: false });
    expect(e.tenant_id).toBe("default");
    expect(e.trace_id).toBeUndefined();
    expect(e.span_id).toBeUndefined();
  });
});

describe("emitDecisionAudit", () => {
  it("inserts the event into audit_events when Mongo is configured", async () => {
    emitDecisionAudit(subject, resource, "use", { decision: "ALLOW", reason: "OK", retriable: false });
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget settle
    expect(mockGetCollection).toHaveBeenCalledWith("audit_events");
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    expect(mockInsertOne.mock.calls[0][0]).toMatchObject({ type: "cas_decision", outcome: "allow" });
  });

  it("is a no-op when Mongo is not configured", () => {
    mongoConfigured = false;
    emitDecisionAudit(subject, resource, "use", { decision: "ALLOW", reason: "OK", retriable: false });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("swallows insert failures (never throws into the decision path)", async () => {
    mockInsertOne.mockRejectedValue(new Error("mongo down"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => emitDecisionAudit(subject, resource, "use", { decision: "DENY", reason: "NO_CAPABILITY", retriable: false })).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

const grantIntent = {
  resource: { type: "agent" as const, id: "platform-engineer" },
  grantee: { type: "team" as const, id: "eng" },
  capability: "use" as const,
};
const caller = { type: "user" as const, id: "alice" };

describe("buildGrantEvent — policy-change audit conformance", () => {
  it("records caller, grantee, resource, capability, operation, outcome, and context", () => {
    const e = buildGrantEvent("grant", grantIntent, {
      caller,
      tenantId: "acme",
      correlationId: "corr-grant-1",
      traceId: "t-2",
    });
    expect(e).toMatchObject({
      type: "cas_grant",
      tenant_id: "acme",
      correlation_id: "corr-grant-1",
      caller_ref: "user:alice",
      grantee_ref: "team:eng",
      action: "use",
      operation: "grant",
      outcome: "success",
      resource_ref: "agent:platform-engineer",
      resource_type: "agent",
      resource_id: "platform-engineer",
      component: "cas",
      pdp: "openfga",
      source: "cas",
      trace_id: "t-2",
    });
    expect(e.subject_hash).toMatch(/^sha256:/);
    expect(e.actor_hash).toBe(e.subject_hash);
    expect(e.subject_hash).not.toContain("alice");
  });

  it("maps everyone grantee to user:*", () => {
    const e = buildGrantEvent("revoke", {
      ...grantIntent,
      grantee: { type: "everyone" },
    }, { caller, correlationId: "c-1" });
    expect(e).toMatchObject({ operation: "revoke", grantee_ref: "user:*", outcome: "success" });
  });

  it("records failed attempts with error outcome and reason_code", () => {
    const e = buildGrantEvent("grant", grantIntent, { caller, tenantId: "acme" }, {
      outcome: "error",
      reasonCode: "NO_CAPABILITY",
    });
    expect(e).toMatchObject({
      outcome: "error",
      reason_code: "NO_CAPABILITY",
      operation: "grant",
      caller_ref: "user:alice",
    });
  });

  it("requires ctx.caller", () => {
    expect(() => buildGrantEvent("grant", grantIntent, {})).toThrow(/ctx\.caller/);
  });
});

describe("emitGrantAudit", () => {
  it("inserts cas_grant when Mongo is configured and caller is present", async () => {
    await emitGrantAudit("grant", grantIntent, { caller, tenantId: "acme", correlationId: "c-1" });
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    expect(mockInsertOne.mock.calls[0][0]).toMatchObject({
      type: "cas_grant",
      caller_ref: "user:alice",
      operation: "grant",
      outcome: "success",
    });
  });

  it("is a no-op without caller (never writes anonymous policy changes)", async () => {
    await emitGrantAudit("grant", grantIntent, { tenantId: "acme" });
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  it("is a no-op when Mongo is not configured", async () => {
    mongoConfigured = false;
    await emitGrantAudit("grant", grantIntent, { caller });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it("persists failed attempts when outcome is error", async () => {
    mongoConfigured = true;
    await emitGrantAudit("revoke", grantIntent, { caller }, { outcome: "error", reasonCode: "PDP_WRITE_FAILED" });
    expect(mockInsertOne.mock.calls[0][0]).toMatchObject({
      outcome: "error",
      reason_code: "PDP_WRITE_FAILED",
      operation: "revoke",
    });
  });

  it("swallows insert failures (never throws into the grant path)", async () => {
    mockInsertOne.mockRejectedValue(new Error("mongo down"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      emitGrantAudit("grant", grantIntent, { caller }, { outcome: "error", reasonCode: "NO_CAPABILITY" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[cas/audit] Failed to persist grant event:", expect.any(Error));
    warn.mockRestore();
  });
});
