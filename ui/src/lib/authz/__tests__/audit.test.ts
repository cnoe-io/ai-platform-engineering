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

import { buildDecisionEvent, emitDecisionAudit } from "../audit";

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
