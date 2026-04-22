"use client";

import React, { useRef, useEffect, useCallback } from "react";
import { Marked } from "marked";
import markedShiki from "marked-shiki";
import remend from "remend";
import morphdom from "morphdom";
import DOMPurify from "dompurify";
import { createHighlighter, type Highlighter, bundledLanguages, type BundledLanguage } from "shiki";
import { cn } from "@/lib/utils";
import "./streaming-markdown.css";

// ═══════════════════════════════════════════════════════════════
// Shiki highlighter — lazy singleton, loads languages on demand
// ═══════════════════════════════════════════════════════════════

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["dark-plus"],
      langs: [],
    });
  }
  return highlighterPromise;
}

// ═══════════════════════════════════════════════════════════════
// Marked instance — configured once with async shiki highlighting
// ═══════════════════════════════════════════════════════════════

const md = new Marked();

md.use({
  gfm: true,
  breaks: false,
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${href}"${titleAttr} class="md-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

md.use(
  markedShiki({
    async highlight(code, lang) {
      const hl = await getHighlighter();
      let language = lang || "text";
      if (!(language in bundledLanguages)) {
        language = "text";
      }
      if (!hl.getLoadedLanguages().includes(language)) {
        try {
          await hl.loadLanguage(language as BundledLanguage);
        } catch {
          language = "text";
        }
      }
      return hl.codeToHtml(code, { lang: language, theme: "dark-plus" });
    },
  }),
);

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════════════════════
// DOMPurify configuration
// ═══════════════════════════════════════════════════════════════

const purifyConfig = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style"] as string[],
  FORBID_CONTENTS: ["style", "script"] as string[],
};

function sanitize(html: string): string {
  if (typeof window === "undefined") return html;
  return DOMPurify.sanitize(html, purifyConfig);
}

// ═══════════════════════════════════════════════════════════════
// Copy button decoration — vanilla DOM, event delegation
// ═══════════════════════════════════════════════════════════════

const COPY_BUTTON_ATTR = "data-md-copy";

function decorateCopyButtons(root: HTMLDivElement) {
  const pres = root.querySelectorAll("pre");
  for (const pre of pres) {
    // Skip if already wrapped
    if (pre.parentElement?.hasAttribute(COPY_BUTTON_ATTR)) continue;

    const wrapper = document.createElement("div");
    wrapper.setAttribute(COPY_BUTTON_ATTR, "");
    wrapper.className = "md-code-block";

    // Extract language from shiki output or code class
    const code = pre.querySelector("code");
    const langClass = code?.className?.match(/language-(\w+)/)?.[1];
    const shikiLang = pre.getAttribute("data-language");
    const language = shikiLang || langClass || "";

    // Header with language label and copy button
    const header = document.createElement("div");
    header.className = "md-code-header";
    header.innerHTML = `
      <span class="md-code-lang">${escapeHtml(language || "plain text")}</span>
      <button type="button" class="md-copy-btn" title="Copy code">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-copy-icon"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-check-icon"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    `;

    pre.parentNode!.replaceChild(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  }
}

// ═══════════════════════════════════════════════════════════════
// Click handler for copy buttons — uses event delegation on root
// ═══════════════════════════════════════════════════════════════

function handleCopyClick(e: MouseEvent) {
  const target = e.target;
  if (!(target instanceof Element)) return;

  const btn = target.closest(".md-copy-btn");
  if (!(btn instanceof HTMLButtonElement)) return;

  const block = btn.closest(".md-code-block");
  const code = block?.querySelector("pre code") ?? block?.querySelector("pre");
  const text = code?.textContent ?? "";
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 2000);
  });
}

// ═══════════════════════════════════════════════════════════════
// Parse markdown to sanitized HTML
// ═══════════════════════════════════════════════════════════════

async function parseMarkdown(content: string, streaming: boolean): Promise<string> {
  const src = streaming ? remend(content, { linkMode: "text-only" }) : content;
  try {
    const raw = await md.parse(src);
    return sanitize(raw);
  } catch {
    return sanitize(`<p>${escapeHtml(content)}</p>`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  /**
   * "thinking" = muted, compact style (for intermediate content)
   * "final" = full prose style with code highlighting (for final answers)
   * "user" = compact style inheriting parent text color (for user message bubbles)
   */
  variant?: "thinking" | "final" | "user";
  className?: string;
}

/**
 * Renders markdown content using marked + morphdom for efficient DOM updates.
 *
 * Works for both streaming and static content. During streaming, `remend`
 * heals incomplete markdown (closes unclosed emphasis, removes broken links)
 * before parsing. `morphdom` patches only changed DOM nodes instead of
 * replacing innerHTML, avoiding layout thrash.
 *
 * Code highlighting is done async via shiki (loads languages on demand).
 * Copy buttons are added via vanilla DOM decoration with event delegation.
 */
export function MarkdownRenderer({
  content,
  isStreaming,
  variant = "final",
  className,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Monotonic counter to ensure only the latest parse result is applied.
  // During rapid streaming, many parses may be in-flight concurrently;
  // we only want the most recently *requested* one to patch the DOM.
  const parseSeqRef = useRef(0);
  // Track last applied sequence to skip out-of-order resolutions
  const appliedSeqRef = useRef(0);

  const patchDom = useCallback((html: string) => {
    const container = containerRef.current;
    if (!container) return;

    if (!html) {
      container.innerHTML = "";
      return;
    }

    // Build temp element, decorate, then morph
    const temp = document.createElement("div");
    temp.innerHTML = html;
    decorateCopyButtons(temp);

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated(fromEl, toEl) {
        // Preserve copy button "copied" state
        if (
          fromEl instanceof HTMLButtonElement &&
          toEl instanceof HTMLButtonElement &&
          fromEl.classList.contains("md-copy-btn") &&
          fromEl.classList.contains("copied")
        ) {
          toEl.classList.add("copied");
        }
        // Skip unchanged subtrees
        if (fromEl.isEqualNode(toEl)) return false;
        return true;
      },
    });

    // Set up event delegation once
    if (!cleanupRef.current) {
      container.addEventListener("click", handleCopyClick);
      cleanupRef.current = () => container.removeEventListener("click", handleCopyClick);
    }
  }, []);

  // Parse + morph on content changes
  useEffect(() => {
    if (!content) {
      const container = containerRef.current;
      if (container) container.innerHTML = "";
      return;
    }

    // Bump sequence — this parse is now the "latest requested"
    const seq = ++parseSeqRef.current;

    parseMarkdown(content, !!isStreaming).then((html) => {
      // Only apply if this is still the latest parse (or newer than last applied).
      // During rapid streaming, earlier parses that resolve late are skipped,
      // but the latest one always applies regardless of whether content has
      // since advanced — the next event will trigger another parse anyway.
      if (seq < appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      patchDom(html);
    });
  }, [content, isStreaming, patchDom]);

  // Cleanup event listener on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  if (!content) return null;

  const variantClasses: Record<string, string> = {
    thinking: "md-thinking",
    final: "md-final",
    user: "md-user",
  };
  const variantClass = variantClasses[variant] || "md-final";

  return (
    <div
      ref={containerRef}
      className={cn("streaming-markdown", variantClass, className)}
    />
  );
}
