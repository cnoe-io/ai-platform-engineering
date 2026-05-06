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
// a skill is launchable.
//
// IMPORTANT: the override is stored in a SEPARATE field
// (`scan_override` sub-doc), NOT a magic `scan_status =
// "admin_overridden"` value. The earlier design overloaded
// `scan_status` and was removed because every scanner write path
// (rescan, scan-all, hub auto-scan) would blindly overwrite the
// synthetic value with the scanner's raw verdict ("flagged") and
// silently nuke the override. These tests pin the new two-field
// contract so the bug can't regress.
describe("applyRunnableGate — admin scan_override", () => {
  // The persisted shape after an admin sets an override: scan_status
  // stays whatever the scanner last wrote ("flagged"), and the
  // separate scan_override sub-doc carries the audit metadata.
  const flaggedWithOverride: CatalogSkill = {
    ...baseSkill,
    scan_status: "flagged",
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

  it("treats flagged+override as runnable when feature is on (default)", () => {
    // ADMIN_SCAN_OVERRIDE_ENABLED unset ⇒ default-on. This is the
    // happy path: an admin has explicitly green-lit a flagged skill
    // and the runtime serves it.
    const out = applyRunnableGate(flaggedWithOverride);
    expect(out.runnable).toBe(true);
    expect(out.blocked_reason).toBeUndefined();
    // The override metadata must round-trip so the report dialog can
    // render set_by / reason / prior_scan_status.
    expect(out.scan_override).toEqual(flaggedWithOverride.scan_override);
    // scan_status stays "flagged" — the gate doesn't mutate the
    // scanner verdict, only the runnable bit.
    expect(out.scan_status).toBe("flagged");
  });

  it("treats flagged+override as runnable when feature is explicitly true", () => {
    process.env.ADMIN_SCAN_OVERRIDE_ENABLED = "true";
    const out = applyRunnableGate(flaggedWithOverride);
    expect(out.runnable).toBe(true);
  });

  it.each(["false", "0", "no", "off"])(
    "collapses flagged+override back to blocked when feature is off (%s)",
    (value) => {
      // Flipping the env disables the escape hatch on both tiers.
      // The UI must mark runnable=false even though the override
      // sub-doc is present, so the runner refuses to launch and
      // the gallery shows the disabled badge again. The override
      // sub-doc is preserved on the row so the dialog can still
      // explain "an override exists but the feature is off."
      process.env.ADMIN_SCAN_OVERRIDE_ENABLED = value;
      const out = applyRunnableGate(flaggedWithOverride);
      expect(out.runnable).toBe(false);
      expect(out.blocked_reason).toBe("scan_flagged");
      expect(out.scan_status).toBe("flagged");
      expect(out.scan_override).toEqual(flaggedWithOverride.scan_override);
    },
  );

  it("flagged-without-override stays blocked regardless of override env", () => {
    // Toggling the override flag has nothing to do with a plain
    // flagged skill that has no override sub-doc. Both states of
    // the env must keep an unprotected flagged skill non-runnable.
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

  it("override on a non-flagged skill is a no-op", () => {
    // The override field only rescues "flagged". An override sitting
    // on a passed/unscanned row (shouldn't happen in normal flow but
    // could appear during edge transitions) doesn't grant any extra
    // privilege beyond what scan_status already does.
    const out = applyRunnableGate({
      ...baseSkill,
      scan_status: "passed",
      scan_override: flaggedWithOverride.scan_override,
    });
    expect(out.runnable).toBe(true);
    expect(out.blocked_reason).toBeUndefined();
  });
});
