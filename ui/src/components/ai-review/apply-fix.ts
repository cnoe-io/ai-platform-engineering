/**
 * Apply a `SuggestedFix` returned by the AI Review backend to a content string.
 *
 * The two patch kinds intentionally cover only the two cases the backend
 * model is allowed to emit:
 *
 *   - `replace_all` — overwrite the entire document with `fix.text`.
 *   - `replace_range` — splice lines `[line_start, line_end]` (inclusive,
 *     0-based) with `fix.text.split("\n")`.
 *
 * Boundary semantics (replace_range):
 *  - Both `line_start` and `line_end` are inclusive and 0-based, mirroring
 *    the contract documented on `SuggestedFix` in `@/types/ai-review`.
 *  - Negative indices clamp to 0.
 *  - Indices past the last line clamp to the last line index. If both
 *    indices are past the end (e.g. `line_start = 999` on a 5-line file)
 *    the replacement is appended after the last existing line.
 *  - When `line_end < line_start` (a degenerate range), the patch is
 *    treated as an INSERTION at `line_start`: no lines are removed; the
 *    replacement text is spliced in before the line at `line_start`.
 *  - Trailing/leading newlines in the source are preserved by `split`
 *    + `join("\n")` round-trip — an empty trailing line becomes an empty
 *    string element which rejoins identically.
 */

import type { SuggestedFix } from "@/types/ai-review";

export function applyFix(content: string, fix: SuggestedFix): string {
  if (fix.kind === "replace_all") {
    return fix.text;
  }

  // replace_range
  const lines = content.split("\n");
  const lastIdx = Math.max(0, lines.length - 1);

  // Clamp indices into [0, lastIdx]. Treat anything past end as append-position.
  const rawStart = Number.isFinite(fix.line_start) ? fix.line_start : 0;
  const rawEnd = Number.isFinite(fix.line_end) ? fix.line_end : rawStart;

  const clampedStart = Math.max(0, Math.min(lines.length, rawStart));
  const clampedEnd = Math.max(0, Math.min(lastIdx, rawEnd));

  const replacementLines = fix.text.split("\n");

  // Degenerate range (end < start) → insert at start without removing anything.
  if (clampedEnd < clampedStart) {
    const out = lines.slice();
    // For an "insert at start" we splice in before clampedStart with deleteCount 0.
    // If clampedStart is past lastIdx, splice acts as an append, which is what we want.
    out.splice(clampedStart, 0, ...replacementLines);
    return out.join("\n");
  }

  // line_start beyond end of file → append after the last line.
  if (rawStart > lastIdx) {
    return [...lines, ...replacementLines].join("\n");
  }

  // Normal inclusive splice [start, end].
  const deleteCount = clampedEnd - clampedStart + 1;
  const out = lines.slice();
  out.splice(clampedStart, deleteCount, ...replacementLines);
  return out.join("\n");
}
