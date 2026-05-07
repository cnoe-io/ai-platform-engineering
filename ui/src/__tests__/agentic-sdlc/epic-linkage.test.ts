/**
 * Pin the epic-linkage contract: how does a sub-task / PR / deploy
 * declare which Epic it belongs to? Two signals, in priority order:
 *   1) `epic:<id>` label (preferred)
 *   2) Trailing `Parent-Epic: <id>` line in the body (fallback)
 *
 * The mock-webhook-flow script relies on the label form. Real-world
 * agents that can only control body content are covered by the
 * fallback. If anyone breaks this, every downstream SSE channel goes
 * silent because events arrive without an epic_id.
 */
import { extractEpicId } from "@/lib/agentic-sdlc/epic-linkage";

describe("extractEpicId", () => {
  it("returns the suffix of the first epic:<id> label", () => {
    expect(extractEpicId(["bug", "epic:I_42abc", "agent:plan"], null)).toBe(
      "I_42abc",
    );
  });

  it("matches case-insensitively on the prefix and preserves the suffix case", () => {
    expect(extractEpicId(["EPIC:Foo123"], null)).toBe("Foo123");
    expect(extractEpicId(["Epic:Bar"], null)).toBe("Bar");
  });

  it("returns the first epic label when several are present", () => {
    expect(extractEpicId(["epic:first", "epic:second"], null)).toBe("first");
  });

  it("ignores whitespace around the suffix", () => {
    expect(extractEpicId(["epic:  trimmed  "], null)).toBe("trimmed");
  });

  it("falls back to the Parent-Epic body line when no epic: label is present", () => {
    const body = `Closes some other issue.\n\nParent-Epic: I_99\n`;
    expect(extractEpicId(["bug"], body)).toBe("I_99");
  });

  it("prefers the label over the body when both are present", () => {
    const body = "Parent-Epic: from-body";
    expect(extractEpicId(["epic:from-label"], body)).toBe("from-label");
  });

  it("handles undefined / null inputs gracefully", () => {
    expect(extractEpicId(undefined, undefined)).toBeNull();
    expect(extractEpicId(null, null)).toBeNull();
    expect(extractEpicId([], "")).toBeNull();
  });

  it("rejects an empty epic: label suffix", () => {
    expect(extractEpicId(["epic:"], null)).toBeNull();
    expect(extractEpicId(["epic:   "], null)).toBeNull();
  });

  it("rejects body lines that do not match the Parent-Epic pattern", () => {
    expect(extractEpicId([], "Parent: nope")).toBeNull();
    expect(extractEpicId([], "parent epic: lower-cased no-colon")).toBeNull();
  });

  it("ignores non-string entries in the labels array (defensive against payloads)", () => {
    // GitHub payloads can be loose; webhook-receiver coerces but defence-in-depth.
    const labels = ["bug", null, undefined, 1, "epic:I_77"] as unknown as string[];
    expect(extractEpicId(labels, null)).toBe("I_77");
  });
});
