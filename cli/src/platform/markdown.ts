/**
 * Markdown → ANSI terminal renderer.
 *
 * Wraps marked + marked-terminal with polished styling for a good
 * terminal UX: colored headings, box-drawing tables, styled code blocks.
 * Respects NO_COLOR / --no-color (set early in index.ts as NO_COLOR=1).
 */

import chalk from "chalk";
import { marked } from "marked";
// @ts-ignore: marked-terminal has no typings
import TerminalRenderer from "marked-terminal";

const NO_COLOR = Boolean(process.env.NO_COLOR);

let _initialized = false;

function ensureInit(): void {
  if (_initialized) return;

  const rendererOpts: Record<string, unknown> = NO_COLOR
    ? { enabled: false, width: process.stdout.columns ?? 80 }
    : {
        firstHeading: chalk.bold.cyan,
        heading: chalk.bold.white,
        strong: chalk.bold,
        em: chalk.italic,
        codespan: chalk.bgGray.white,
        code: chalk.gray,
        blockquote: chalk.dim.italic,
        link: chalk.cyan.underline,
        href: chalk.cyan.underline,
        showSectionPrefix: false,
        reflowText: true,
        tab: 2,
        width: process.stdout.columns ?? 80,
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
