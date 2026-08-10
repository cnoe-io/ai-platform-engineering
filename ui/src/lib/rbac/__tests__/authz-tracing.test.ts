/**
 * @jest-environment node
 */

import {
  createAuthzTraceContext,
  extractTraceIdFromTraceparent,
  isValidTraceparent,
} from "../authz-tracing";

describe("authz tracing helpers", () => {
  it("creates W3C trace context values for authz spans", () => {
    const ctx = createAuthzTraceContext();

    expect(ctx.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(ctx.spanId).toMatch(/^[a-f0-9]{16}$/);
    expect(ctx.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-01`);
    expect(isValidTraceparent(ctx.traceparent)).toBe(true);
  });

  it("extracts trace ids from valid traceparent headers only", () => {
    const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";

    expect(extractTraceIdFromTraceparent(traceparent)).toBe("0123456789abcdef0123456789abcdef");
    expect(extractTraceIdFromTraceparent("bad-value")).toBeNull();
  });

});
