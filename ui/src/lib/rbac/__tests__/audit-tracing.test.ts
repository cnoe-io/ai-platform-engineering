/**
 * @jest-environment node
 */

import { logOpenFgaRebacAuditEvent } from "../audit";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

describe("OpenFGA ReBAC audit trace correlation", () => {
  it("adds trace correlation fields to durable OpenFGA audit events", () => {
    const event = logOpenFgaRebacAuditEvent({
      sub: "alice-sub",
      operation: "agent_use_check",
      resource: "dynamic_agent",
      scope: "use",
      resourceRef: "user:alice-sub can_use agent:agent-1",
    });

    expect(event.audit_event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(event.trace_id).toMatch(/^[a-f0-9]{32}$/);
    expect(event.span_id).toMatch(/^[a-f0-9]{16}$/);
    expect(event.trace_url).toBeUndefined();
  });
});
