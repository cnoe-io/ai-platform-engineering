/**
 * Unified diff helper for skill update previews.
 *
 * Uses the `diff` npm package to produce a unified diff and colorizes it
 * with ANSI escape codes (green = added, red = removed, grey = context).
 * All color output is suppressed when NO_COLOR is set.
 */

import { createTwoFilesPatch } from "diff";

const NO_COLOR = Boolean(process.env["NO_COLOR"]);

const GREEN = NO_COLOR ? "" : "\x1b[32m";
const RED = NO_COLOR ? "" : "\x1b[31m";
const GREY = NO_COLOR ? "" : "\x1b[90m";
const RESET = NO_COLOR ? "" : "\x1b[0m";

/**
 * Render a colored unified diff between `oldText` and `newText`.
 * `label` is used as the file name in the diff header.
 */
export function renderDiff(oldText: string, newText: string, label: string): string {
  const patch = createTwoFilesPatch(
    `${label} (current)`,
    `${label} (new)`,
    oldText,
    newText,
    "",
    "",
    { context: 3 },
  );

  const lines = patch.split("\n");
  const colored = lines.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return `${GREEN}${line}${RESET}`;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return `${RED}${line}${RESET}`;
    }
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) {
      return `${GREY}${line}${RESET}`;
    }
    return line;
  });

  return colored.join("\n");
}
