/**
 * Tests for applyFix.
 *
 * The replace_range happy path is just `Array.splice` — not retested here.
 * What matters is that bogus line ranges from the LLM never corrupt the
 * document. These tests cover the three documented safety contracts:
 *   - out-of-range indices clamp / append rather than crash
 *   - the degenerate `end < start` range means INSERT, not delete-backwards
 *   - replace_all is a no-questions-asked overwrite
 */

import { applyFix } from "../apply-fix";
import type { SuggestedFix } from "@/types/ai-review";

const range = (
  line_start: number,
  line_end: number,
  text: string,
): SuggestedFix => ({
  kind: "replace_range",
  line_start,
  line_end,
  text,
  summary: "",
});

describe("applyFix", () => {
  it("replace_all overwrites the document verbatim", () => {
    expect(applyFix("old\ncontent", { kind: "replace_all", text: "NEW", summary: "" })).toBe("NEW");
  });

  it("clamps out-of-range indices instead of corrupting the document", () => {
    const content = "a\nb\nc";

    // line_start past the end → append after the last line.
    expect(applyFix(content, range(99, 100, "END"))).toBe("a\nb\nc\nEND");

    // Negative indices clamp to 0 → replace the first line.
    expect(applyFix(content, range(-5, -1, "FIRST"))).toBe("FIRST\nb\nc");
  });

  it("treats `line_end < line_start` as an INSERT at line_start (no deletion)", () => {
    // Documented in apply-fix.ts: a degenerate range must not delete anything.
    // Without this, an LLM that swapped the two indices could nuke content.
    const content = "one\ntwo\nthree";
    expect(applyFix(content, range(1, 0, "INSERTED"))).toBe(
      "one\nINSERTED\ntwo\nthree",
    );
  });
});
