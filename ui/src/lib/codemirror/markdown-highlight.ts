/**
 * Supplementary markdown highlight styles for CodeMirror.
 *
 * The oneDark theme (used via `theme="dark"`) already handles:
 *   headings  → bold #e06c75   emphasis → italic
 *   strong    → bold           links    → underline
 *   urls      → #56b6c2        processingInstruction → #98c379
 *
 * This extension fills the gaps that oneDark does NOT cover
 * (monospace/code, lists, quotes, separators) and adds heading
 * size differentiation so h1/h2/h3 are visually distinct.
 *
 * It runs at normal precedence so oneDark's colors still apply;
 * our rules only add properties oneDark doesn't set (fontSize,
 * backgroundColor) or target tags oneDark leaves unstyled.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const markdownHighlightStyle = HighlightStyle.define([
  // Heading size differentiation (oneDark already sets color + bold)
  { tag: tags.heading1, fontSize: "1.2em" },
  { tag: tags.heading2, fontSize: "1.1em" },

  // Inline code — not styled by oneDark
  { tag: tags.monospace, color: "#98c379", backgroundColor: "rgba(152, 195, 121, 0.1)" },

  // Blockquotes — not styled by oneDark
  { tag: tags.quote, color: "#7d8799", fontStyle: "italic" },

  // Horizontal rules — not styled by oneDark
  { tag: tags.contentSeparator, color: "#475569" },
]);

/** CodeMirror extension — markdown highlight supplement for oneDark gaps. */
export const markdownHighlight = syntaxHighlighting(markdownHighlightStyle);
