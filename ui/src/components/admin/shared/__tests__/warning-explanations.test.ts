import {
  BOOTSTRAP_ADMIN_HEADER_EXPLANATION,
  classifyWarning,
  explainWarning,
} from "../warning-explanations";

/**
 * Decoder tests for the Keycloak migration warning explainer used by
 * the Admin → Security & Policy → Keycloak panel.
 *
 * Like the invariant explainer tests, this file pins:
 *
 *   1. Every emitted warning string from the BFF migration is
 *      recognised by exactly one pattern (no generic fallback in
 *      production), and the captured params (email, slug, error
 *      text) are interpolated correctly.
 *   2. The "keep both technical and plain-English" wording rule is
 *      enforced — every body must contain the technical names AND
 *      a gloss for the heaviest jargon.
 *   3. The fallback path returns a safe stub, not a throw.
 *
 * When a new warning string lands in `keycloak-rbac-reconciliation.ts`
 * or `keycloak-bootstrap-admins.ts`, the maintainer must add a
 * matching `WarningPattern` entry; this file is the guardrail.
 */
describe("explainWarning", () => {
  // ────────────────────────────────────────────────────────────────
  // Bootstrap admin per-email failure family
  // ────────────────────────────────────────────────────────────────
  describe("bootstrap_admin_email_failed family", () => {
    it("classifies `<email>: <error>` as bootstrap_admin_email_failed", () => {
      expect(
        classifyWarning("alice@example.com: user not found in Keycloak realm `caipe`"),
      ).toBe("bootstrap_admin_email_failed");
    });

    it("interpolates the email into the title and the error into the body", () => {
      const result = explainWarning(
        "alice@example.com: user not found in Keycloak realm `caipe`",
      );
      expect(result.title).toContain("alice@example.com");
      expect(result.body).toContain("alice@example.com");
      expect(result.body).toContain("user not found in Keycloak realm `caipe`");
    });

    it("explains what BOOTSTRAP_ADMIN_EMAILS is and why a single failed row isn't catastrophic", () => {
      const result = explainWarning(
        "alice@example.com: OpenFGA returned 502",
      );
      // Technical names survive.
      expect(result.body).toMatch(/BOOTSTRAP_ADMIN_EMAILS/);
      expect(result.body).toMatch(/OpenFGA/);
      expect(result.body).toMatch(/Keycloak/);
      // Plain-English summary of what bootstrap admins ARE.
      expect(result.body).toMatch(/realm admins|admin access|sign in.*admin/i);
      // Reassurance: this is non-blocking.
      expect(result.body).toMatch(/left every other admin alone|left the rest|other emails unaffected|rest of the admin set is unaffected/i);
    });

    it("gives a fix with at least 3 distinct common causes (typo, profile policy, OpenFGA, casing)", () => {
      const result = explainWarning(
        "alice@example.com: OpenFGA returned 502",
      );
      expect(result.fix).toBeDefined();
      // Reasonable coverage of the most common failure modes —
      // admins should not have to guess.
      const fix = result.fix ?? "";
      expect(fix).toMatch(/typo/i);
      expect(fix).toMatch(/KEYCLOAK_USER_PROFILE_UNMANAGED_ATTRIBUTE_POLICY/);
      expect(fix).toMatch(/OpenFGA/);
      expect(fix).toMatch(/casing|case-sensitive/i);
      expect(fix).toMatch(/Reconcile all/i);
    });

    it("does not misclassify a non-`<email>: <error>` colon-bearing warning as a bootstrap-admin row", () => {
      // A warning that just happens to contain a colon, but is NOT
      // an `<email>: <error>` line — must NOT be misclassified as a
      // bootstrap-admin row. After Phase 3 demolition no other
      // specific warning family is registered, so this falls through
      // to the safe fallback path.
      const raw = "Some non-email warning: with a colon in it.";
      expect(classifyWarning(raw)).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Fallback
  // ────────────────────────────────────────────────────────────────
  describe("fallback", () => {
    it("returns a safe stub (and does not throw) for a totally unknown warning", () => {
      const result = explainWarning("Some brand new warning we don't recognise yet");
      expect(result.title).toBe("Migration warning");
      expect(result.body).toMatch(/does not have a plain-English explanation registered/);
      // Body must include the path to extend the decoder so the next
      // engineer knows where to add the new pattern.
      expect(result.body).toContain("warning-explanations.ts");
    });

    it("classifyWarning returns null for the fallback path", () => {
      expect(classifyWarning("brand new gibberish")).toBeNull();
    });

    it("does not crash on the empty string", () => {
      expect(() => explainWarning("")).not.toThrow();
      expect(classifyWarning("")).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Bootstrap admin section-header explainer (the "?" next to the
  // header bar, not next to a specific failed-email row).
  // ────────────────────────────────────────────────────────────────
  describe("bootstrap admin header explanation", () => {
    it("explains the *concept* of bootstrap admin reconciliation without referring to any specific failed email", () => {
      const result = BOOTSTRAP_ADMIN_HEADER_EXPLANATION;
      expect(result.title).toMatch(/bootstrap admin/i);
      // Must not interpolate any email-shaped string — this is the
      // header explainer, not a per-row one.
      expect(result.body).not.toMatch(/[^\s@]+@[^\s@.]+\.[^\s@]+/);
      // Explains BOTH env var names so admins find theirs.
      expect(result.body).toContain("BOOTSTRAP_ADMIN_EMAILS");
      expect(result.body).toContain("RBAC_BOOTSTRAP_ADMIN_EMAILS");
      // Reassurance + retry guidance.
      expect(result.body).toMatch(/empty Keycloak realm|locked out|brand-new deployment/i);
      expect(result.body).toMatch(/Reconcile all|every time you click|on the next start/i);
    });

    it("points admins at the per-row tooltips for specific failures", () => {
      const result = BOOTSTRAP_ADMIN_HEADER_EXPLANATION;
      expect(result.fix).toBeDefined();
      expect(result.fix).toMatch(/`\?`|HelpCircle|hover.*for a detailed explanation|per-row/i);
    });
  });
});
