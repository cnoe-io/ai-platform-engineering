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

// -- Admin scan-override gate -------------------------------------------------
//
// Mirrors the policy table in
// ai_platform_engineering/skills_middleware/scan_gate.py — the Node
// gate stamps `runnable` for the UI; the Python gate enforces it on
// the actual loader path. They have to agree on every cell of the
// table or the gallery and the runtime will disagree about whether
// a skill is launchable, which is exactly the kind of drift the
// scan_status field was introduced to prevent.
describe("applyRunnableGate — admin_overridden", () => {
  const overriddenSkill: CatalogSkill = {
    ...baseSkill,
    scan_status: "admin_overridden",
    scan_override: {
      set_by: "alice@example.com",
      set_at: "2026-05-05T12:00:00Z",
      reason: "Reviewed shell-out warning, all paths use allow-list.",
      prior_scan_status: "flagged",
      prior_scan_summary: "Detected shell exec with user input",
    },
  };

  // Reset the env var between cases so a prior test can't leak the
  // feature into the off state. afterEach is paired with an explicit
  // delete instead of restoreAllMocks because the gate reads
  // process.env directly (not through a mockable function).
  afterEach(() => {
    delete process.env.ADMIN_SCAN_OVERRIDE_ENABLED;
  });

  it("treats admin_overridden as runnable when feature is on (default)", () => {
    // ADMIN_SCAN_OVERRIDE_ENABLED unset ⇒ default-on. This is the
    // happy path: an admin has explicitly green-lit a flagged skill
    // and the runtime serves it.
    const out = applyRunnableGate(overriddenSkill);
    expect(out.runnable).toBe(true);
    expect(out.blocked_reason).toBeUndefined();
    // The override metadata must round-trip so the report dialog can
    // render set_by / reason / prior_scan_status.
    expect(out.scan_override).toEqual(overriddenSkill.scan_override);
  });

  it("treats admin_overridden as runnable when feature is explicitly true", () => {
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "true";
    const out = applyRunnableGate(overriddenSkill);
    expect(out.runnable).toBe(true);
  });

  it.each(["false", "0", "no", "off"])(
    "collapses admin_overridden back to flagged when feature is off (%s)",
    (value) => {
      // Flipping the env disables the escape hatch on both tiers.
      // The UI must collapse to runnable=false even though the doc
      // still says admin_overridden, so the runner refuses to
      // launch and the gallery shows the disabled badge again.
      process.env.ADMIN_SCAN_OVERRIDE_ENABLED = value;
      const out = applyRunnableGate(overriddenSkill);
      expect(out.runnable).toBe(false);
      expect(out.blocked_reason).toBe("scan_flagged");
      // We deliberately keep scan_status === "admin_overridden" so
      // the UI can still render override metadata and explain why
      // the skill is blocked despite the override existing.
      expect(out.scan_status).toBe("admin_overridden");
    },
  );

  it("flagged skills stay blocked regardless of override env", () => {
    // Toggling the override flag has nothing to do with plain
    // flagged. This pins the invariant from
    // TestIsStatusBlockedForAdminOverride.test_flagged_invariant_unaffected_by_override_flag
    // on the Python side.
    for (const value of ["true", "false"]) {
      process.env.ADMIN_SCAN_OVERRIDE_ENABLED = value;
      const out = applyRunnableGate({
        ...baseSkill,
        scan_status: "flagged",
      });
      expect(out.runnable).toBe(false);
      expect(out.blocked_reason).toBe("scan_flagged");
    }
  });
});
