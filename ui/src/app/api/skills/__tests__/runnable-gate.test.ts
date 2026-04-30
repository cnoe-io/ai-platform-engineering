/**
 * @jest-environment node
 */
// assisted-by cursor (composer-2-fast)
//
// Pins the UI-side enforcement that flagged skills must be marked
// non-runnable before the catalog leaves the server. The gallery,
// runner, and downstream consumers all depend on the `runnable`
// field; we don't want a drift-by-refactor to silently turn a
// flagged skill back into a launchable one.

// Stub api-middleware before the route imports it so the test
// doesn't pull in NextAuth / Mongo at module load.
jest.mock("@/lib/api-middleware", () => ({
  getAuthFromBearerOrSession: jest.fn(),
  withErrorHandler: (handler: unknown) => handler,
}));

import { applyRunnableGate, type CatalogSkill } from "../route";

const baseSkill: CatalogSkill = {
  id: "x",
  name: "x",
  description: "",
  source: "agent_skills",
  source_id: null,
  content: null,
  metadata: {},
};

describe("applyRunnableGate", () => {
  it("forces runnable=false + blocked_reason on a flagged skill", () => {
    const out = applyRunnableGate({ ...baseSkill, scan_status: "flagged" });
    expect(out.runnable).toBe(false);
    expect(out.blocked_reason).toBe("scan_flagged");
  });

  it("ignores any caller-supplied runnable=true on a flagged skill", () => {
    // Defense-in-depth: even if a stale backend marked the skill
    // runnable, the UI gate must still drop it.
    const out = applyRunnableGate({
      ...baseSkill,
      scan_status: "flagged",
      runnable: true,
    });
    expect(out.runnable).toBe(false);
  });

  it("leaves passed skills runnable", () => {
    const out = applyRunnableGate({ ...baseSkill, scan_status: "passed" });
    expect(out.runnable).toBe(true);
    expect(out.blocked_reason).toBeUndefined();
  });

  it("defaults missing scan_status to runnable=true", () => {
    const out = applyRunnableGate(baseSkill);
    expect(out.runnable).toBe(true);
    expect(out.blocked_reason).toBeUndefined();
  });

  it("preserves an explicit runnable=false from a caller", () => {
    // Callers can still set their own runnable=false for reasons
    // the gate doesn't know about (e.g. a future "tenant disabled"
    // signal). The gate only forces flagged skills to false.
    const out = applyRunnableGate({
      ...baseSkill,
      scan_status: "passed",
      runnable: false,
    });
    expect(out.runnable).toBe(false);
  });
});
