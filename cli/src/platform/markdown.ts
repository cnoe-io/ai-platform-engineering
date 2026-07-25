/**
 * Markdown → ANSI terminal renderer.
 *
 * Wraps marked + marked-terminal with polished styling for a good
 * terminal UX: colored headings, box-drawing tables, styled code blocks.
 * Respects NO_COLOR / --no-color (set early in index.ts as NO_COLOR=1).
 */

import chalk from "chalk";
import { marked } from "marked";
import { getPlainMarkdown } from "./config.js";
// @ts-ignore: marked-terminal has no typings
import TerminalRenderer from "marked-terminal";

const NO_COLOR = Boolean(process.env.NO_COLOR);

function terminalWidth(): number {
  const cols = process.stdout.columns ?? 80;
  // Ink/yoga layout breaks on full-width tables and HR lines; cap for readability.
  return Math.max(60, Math.min(cols, 100));
}

let _initialized = false;
let _cachedWidth = 0;

function ensureInit(): void {
  const width = terminalWidth();
  if (_initialized && _cachedWidth === width) return;
  _cachedWidth = width;

  const rendererOpts: Record<string, unknown> = NO_COLOR
    ? { enabled: false, width }
    : {
        firstHeading: chalk.bold.cyan,
        heading: chalk.bold.white,
        strong: chalk.bold,
        em: chalk.italic,
        // No background on inline code — bgGray renders as tall blocks in Ink.
        codespan: chalk.cyan,
        code: chalk.gray,
        blockquote: chalk.dim.italic,
        link: chalk.cyan.underline,
        href: chalk.cyan.underline,
        hr: () => chalk.dim(`\n${"─".repeat(Math.min(48, width - 4))}\n`),
        showSectionPrefix: false,
        reflowText: true,
        tab: 2,
        width,
        tableOptions: {
          chars: {
            top: "─",
            "top-mid": "┬",
            "top-left": "┌",
            "top-right": "┐",
            bottom: "─",
            "bottom-mid": "┴",
            "bottom-left": "└",
            "bottom-right": "┘",
            left: "│",
            "left-mid": "├",
            mid: "─",
            "mid-mid": "┼",
            right: "│",
            "right-mid": "┤",
            middle: "│",
          },
          style: { head: ["cyan", "bold"], border: ["gray"] },
        },
      };

  marked.setOptions({
    renderer: new TerminalRenderer(rendererOpts),
    gfm: true,
    breaks: false,
    async: false,
  });
  _initialized = true;
}

/**
 * Render a GitHub-flavored Markdown string to ANSI-formatted terminal output.
 * Returns plain text (no escape codes) when NO_COLOR is set.
 */
export function renderMarkdown(text: string): string {
  if (getPlainMarkdown()) return text;
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
