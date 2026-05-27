/**
 * CodeMirror extension that highlights Jinja2 template syntax in the
 * system prompt editor.
 *
 * - {{ variables }} — purple text with subtle purple background
 * - {% control blocks %} — teal text with subtle teal background
 * - {# comments #} — muted gray italic
 *
 * Uses a ViewPlugin with decorations so it works alongside any language
 * mode (markdown, plain text, etc.) without interfering.
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

// ── Decoration marks ────────────────────────────────────────────

const variableMark = Decoration.mark({ class: "cm-jinja2-variable" });
const blockMark = Decoration.mark({ class: "cm-jinja2-block" });
const commentMark = Decoration.mark({ class: "cm-jinja2-comment" });

// ── Match decorator ─────────────────────────────────────────────
// Matches {{ ... }}, {% ... %}, and {# ... #} (including multi-line).

const jinja2Matcher = new MatchDecorator({
  regexp: /\{\{[\s\S]+?\}\}|\{%[\s\S]+?%\}|\{#[\s\S]+?#\}/g,
  decoration: (match) => {
    const text = match[0];
    if (text.startsWith("{{")) return variableMark;
    if (text.startsWith("{%")) return blockMark;
    return commentMark;
  },
});

// ── ViewPlugin ──────────────────────────────────────────────────

const jinja2HighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = jinja2Matcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = jinja2Matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Theme ───────────────────────────────────────────────────────

const jinja2HighlightTheme = EditorView.baseTheme({
  ".cm-jinja2-variable": {
    color: "#c084fc",               // purple-400
    backgroundColor: "rgba(192, 132, 252, 0.1)",
    borderRadius: "2px",
    padding: "0 1px",
  },
  ".cm-jinja2-block": {
    color: "#2dd4bf",               // teal-400
    backgroundColor: "rgba(45, 212, 191, 0.1)",
    borderRadius: "2px",
    padding: "0 1px",
  },
  ".cm-jinja2-comment": {
    color: "#6b7280",               // gray-500
    fontStyle: "italic",
    backgroundColor: "rgba(107, 114, 128, 0.08)",
    borderRadius: "2px",
    padding: "0 1px",
  },
});

// ── Public extension ────────────────────────────────────────────

/** CodeMirror extension for Jinja2 template syntax highlighting. */
export const jinja2Highlight = [jinja2HighlightPlugin, jinja2HighlightTheme];
