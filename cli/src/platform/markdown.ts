/**
 * Markdown → ANSI terminal renderer.
 *
 * Wraps marked + marked-terminal.
 * Respects NO_COLOR / --no-color (set early in index.ts as NO_COLOR=1).
 */

import { marked } from "marked";
// @ts-expect-error: no typings for marked-terminal
import TerminalRenderer from "marked-terminal";

let _initialized = false;

function ensureInit(): void {
  if (_initialized) return;
  marked.setOptions({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: new TerminalRenderer({
      // Disable color if NO_COLOR env is set
      enabled: !process.env["NO_COLOR"],
      // Width: use terminal columns, fall back to 80
      width: process.stdout.columns ?? 80,
    }),
    gfm: true,
    breaks: false,
  });
  _initialized = true;
}

/**
 * Render a GitHub-flavored Markdown string to ANSI-formatted terminal output.
 * Returns plain text (no escape codes) when NO_COLOR is set.
 */
export function renderMarkdown(text: string): string {
  ensureInit();
  try {
    const result = marked(text);
    // marked can return a Promise if async: false is not set; coerce.
    if (typeof result === "string") return result;
    // Sync fallback: strip basic markdown if async result escapes
    return text;
  } catch {
    return text;
  }
}
