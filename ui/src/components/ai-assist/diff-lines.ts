/**
 * diff-lines — tiny line-based diff used by the AiAssist diff preview.
 *
 * No external dep: this is the standard O(N*M) LCS DP, which is plenty for
 * the small text fields the popover targets (descriptions, system prompts,
 * short snippets). For multi-thousand-line inputs you'd reach for a real
 * diff lib; the popover deliberately doesn't support those — it's for
 * single text inputs / short scripts.
 */

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  /** 0-based line index in the source (left) side; -1 for `add`. */
  oldIndex: number;
  /** 0-based line index in the target (right) side; -1 for `remove`. */
  newIndex: number;
  text: string;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const m = a.length;
  const n = b.length;

  // LCS length matrix.
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", oldIndex: i, newIndex: j, text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "remove", oldIndex: i, newIndex: -1, text: a[i] });
      i++;
    } else {
      out.push({ op: "add", oldIndex: -1, newIndex: j, text: b[j] });
      j++;
    }
  }
  while (i < m) {
    out.push({ op: "remove", oldIndex: i, newIndex: -1, text: a[i] });
    i++;
  }
  while (j < n) {
    out.push({ op: "add", oldIndex: -1, newIndex: j, text: b[j] });
    j++;
  }
  return out;
}

function splitLines(s: string): string[] {
  if (s === "") return [];
  // Preserve the line content but drop the trailing newline so the diff
  // doesn't show a phantom empty line at the end of every input.
  return s.replace(/\n$/, "").split("\n");
}
