"use client";

import { cn } from "@/lib/utils";
import {
  parseTomeHref,
  wikiRoute,
  type GlossaryPreview,
  type GlossaryResolver,
} from "@/lib/tome/tome-links";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import markedShiki from "marked-shiki";
import morphdom from "morphdom";
import { useCallback,useEffect,useRef } from "react";
import remend from "remend";
import { bundledLanguages,createHighlighter,type BundledLanguage,type Highlighter } from "shiki";
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
// Marked instances — full (with shiki) and fast (without)
// ═══════════════════════════════════════════════════════════════

const sharedMarkedOptions = {
  gfm: true,
  breaks: false,
  renderer: {
    link({ href, title, text }: { href: string; title?: string | null; text: string }) {
      const titleAttr = title ? ` title="${title}"` : "";
      // Internal wiki link (`tome://<path>` or bare `*.md`) → tag for click
      // routing instead of a (broken) browser navigation.
      const internal = parseTomeHref(href);
      if (internal) {
        const pathAttr = internal.path.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        // Glossary term link: inline reference + hover definition, click still
        // navigates to the term page. Distinct class from ordinary page links.
        if (internal.glossaryTerm) {
          const termAttr = internal.glossaryTerm.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          return `<a href="${href}" data-tome-path="${pathAttr}" data-glossary-term="${termAttr}"${titleAttr} class="md-link tome-glossary-link">${text}</a>`;
        }
        return `<a href="${href}" data-tome-path="${pathAttr}"${titleAttr} class="md-link tome-link">${text}</a>`;
      }
      const isRelative = href.startsWith("/") || href.startsWith("#");
      const targetAttr = isRelative ? "" : ' target="_blank" rel="noopener noreferrer"';
      return `<a href="${href}"${titleAttr} class="md-link"${targetAttr}>${text}</a>`;
    },
  },
};

/**
 * Fast synchronous Marked instance — no shiki.  Used during streaming
 * where code blocks are typically incomplete and 80-400ms shiki parses
 * would tank the frame rate.
 */
const mdFast = new Marked();
mdFast.use({ ...sharedMarkedOptions, async: false });

/** Full async Marked instance — with shiki syntax highlighting. */
const md = new Marked();

md.use(sharedMarkedOptions);

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
  // Allow the `tome:` scheme (internal wiki links) alongside DOMPurify's
  // defaults. Without this, DOMPurify drops the `tome://` href as an unknown
  // scheme, leaving the anchor unclickable (the click handler resolves the
  // route from the href). Data attributes survive sanitizing, the href doesn't.
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|tome):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
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
// Table decoration — wrap each table so wide tables scroll
// horizontally within the message instead of cramming its columns.
// ═══════════════════════════════════════════════════════════════

const TABLE_WRAP_ATTR = "data-md-table";

function decorateTables(root: HTMLElement) {
  const tables = root.querySelectorAll("table");
  for (const table of tables) {
    if (table.parentElement?.hasAttribute(TABLE_WRAP_ATTR)) continue;
    const wrapper = document.createElement("div");
    wrapper.setAttribute(TABLE_WRAP_ATTR, "");
    wrapper.className = "md-table-wrap";
    table.parentNode!.replaceChild(wrapper, table);
    wrapper.appendChild(table);
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
    // During streaming, use the fast synchronous parser (no shiki).
    // Shiki adds 80-400ms per parse which destroys frame rate.
    // Full highlighting is applied once when streaming ends.
    if (streaming) {
      const raw = mdFast.parse(src) as string;
      return sanitize(raw);
    }
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
  /**
   * Click handler for internal wiki links (`tome://<path>` / bare `*.md`). When
   * provided, such links route through this (SPA navigation) instead of a raw
   * browser href. External links are unaffected.
   */
  onInternalLink?: (path: string) => void;
  /** Resolve a glossary term slug to its definition for the hover card. */
  glossaryPreview?: GlossaryResolver;
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
  onInternalLink,
  glossaryPreview,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Latest callbacks, read by the (set-up-once) delegated DOM handlers.
  const onInternalLinkRef = useRef(onInternalLink);
  useEffect(() => {
    onInternalLinkRef.current = onInternalLink;
  }, [onInternalLink]);
  const glossaryPreviewRef = useRef(glossaryPreview);
  useEffect(() => {
    glossaryPreviewRef.current = glossaryPreview;
  }, [glossaryPreview]);
  // Monotonic counter to ensure only the latest parse result is applied.
  // During rapid streaming, many parses may be in-flight concurrently;
  // we only want the most recently *requested* one to patch the DOM.
  const parseSeqRef = useRef(0);
  // Track last applied sequence to skip out-of-order resolutions
  const appliedSeqRef = useRef(0);
  // rAF-based throttle: store pending HTML and rAF handle so we patch
  // at most once per frame (~16ms / 60fps). No queue — always latest.
  const pendingHtmlRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);

  // Track streaming state for morphdom callbacks (avoids re-creating patchDom)
  const streamingRef = useRef(isStreaming);
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref with prop during render to avoid stale closure in patchDom callback
  streamingRef.current = isStreaming;

  /** Block-level tags that get the fade-in animation during streaming. */
  const BLOCK_TAGS = new Set(["P", "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "TABLE", "HR", "DIV"]);

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
    decorateTables(temp);

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
        // Preserve in-flight fade-in animation across morphdom patches.
        // Without this, the next token's morph strips the class before
        // the 200ms animation finishes.
        if (
          fromEl instanceof HTMLElement &&
          toEl instanceof HTMLElement &&
          fromEl.classList.contains("md-stream-in")
        ) {
          toEl.classList.add("md-stream-in");
        }
        // Skip unchanged subtrees
        if (fromEl.isEqualNode(toEl)) return false;
        return true;
      },
      onNodeAdded(node) {
        // Animate new block-level elements during streaming
        if (
          streamingRef.current &&
          node instanceof HTMLElement &&
          BLOCK_TAGS.has(node.tagName)
        ) {
          node.classList.add("md-stream-in");
          node.addEventListener("animationend", () => {
            node.classList.remove("md-stream-in");
          }, { once: true });
        }
        return node;
      },
    });

    // Set up event delegation once
    if (!cleanupRef.current) {
      const handleInternalLinkClick = (e: MouseEvent) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest("a.tome-link, a.tome-glossary-link");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const internal = parseTomeHref(anchor.getAttribute("href") || "");
        if (!internal) return;
        // Cross-project (@project) ref → navigate to that project's wiki route.
        if (internal.project) {
          e.preventDefault();
          window.location.assign(wikiRoute(internal.project, internal.path));
          return;
        }
        if (onInternalLinkRef.current) {
          e.preventDefault();
          onInternalLinkRef.current(internal.path);
        }
      };
      // Glossary hover card: look up the term's definition and float a card
      // below the link. The card markup + styles match the wiki body surface.
      let card: HTMLDivElement | null = null;
      const cache = new Map<string, GlossaryPreview | null>();
      const hideCard = () => {
        card?.remove();
        card = null;
      };
      const floatCard = (anchor: HTMLAnchorElement, build: (c: HTMLDivElement) => void) => {
        hideCard();
        card = document.createElement("div");
        card.className = "tome-glossary-card";
        build(card);
        document.body.appendChild(card);
        const r = anchor.getBoundingClientRect();
        const w = card.offsetWidth;
        card.style.top = `${r.bottom + 6}px`;
        card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
      };
      const renderCard = (anchor: HTMLAnchorElement, p: GlossaryPreview) =>
        floatCard(anchor, (c) => {
          const head = document.createElement("div");
          head.className = "tome-glossary-card-term";
          head.textContent = p.expansion ? `${p.term}: ${p.expansion}` : p.term;
          const def = document.createElement("div");
          def.className = "tome-glossary-card-def";
          def.textContent = p.definition || "No definition yet.";
          c.append(head, def);
        });
      const renderUnresolved = (anchor: HTMLAnchorElement) =>
        floatCard(anchor, (c) => {
          c.classList.add("tome-glossary-card-unresolved");
          const head = document.createElement("div");
          head.className = "tome-glossary-card-term";
          head.textContent = "Unresolved reference";
          const def = document.createElement("div");
          def.className = "tome-glossary-card-def";
          def.textContent =
            "This term doesn't resolve here. The link may point at the wrong project or a term that no longer exists.";
          c.append(head, def);
        });
      const markDangling = (href: string) => {
        container.querySelectorAll<HTMLAnchorElement>("a.tome-glossary-link").forEach((a) => {
          if (a.getAttribute("href") === href) a.classList.add("tome-glossary-dangling");
        });
      };
      const handleGlossaryOver = (e: MouseEvent) => {
        const anchor = (e.target as HTMLElement | null)?.closest?.(
          "a.tome-glossary-link",
        ) as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute("href") || "";
        const fn = glossaryPreviewRef.current;
        if (!fn) return;
        if (cache.has(href)) {
          const p = cache.get(href);
          if (p) renderCard(anchor, p);
          else renderUnresolved(anchor);
          return;
        }
        Promise.resolve(fn(href))
          .then((p) => {
            cache.set(href, p ?? null);
            if (p === null) markDangling(href);
            if (!anchor.matches(":hover")) return;
            if (p) renderCard(anchor, p);
            else renderUnresolved(anchor);
          })
          .catch(() => {});
      };
      const handleGlossaryOut = (e: MouseEvent) => {
        const anchor = (e.target as HTMLElement | null)?.closest?.(
          "a.tome-glossary-link",
        ) as HTMLAnchorElement | null;
        if (anchor) hideCard();
      };
      container.addEventListener("click", handleCopyClick);
      container.addEventListener("click", handleInternalLinkClick);
      container.addEventListener("mouseover", handleGlossaryOver);
      container.addEventListener("mouseout", handleGlossaryOut);
      cleanupRef.current = () => {
        container.removeEventListener("click", handleCopyClick);
        container.removeEventListener("click", handleInternalLinkClick);
        container.removeEventListener("mouseover", handleGlossaryOver);
        container.removeEventListener("mouseout", handleGlossaryOut);
        hideCard();
      };
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
      if (seq < appliedSeqRef.current) return;
      appliedSeqRef.current = seq;

      if (isStreaming) {
        // Coalesce to one patch per animation frame (~16ms / 60fps).
        // If a rAF is already pending, just update the HTML it will apply.
        pendingHtmlRef.current = html;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const pending = pendingHtmlRef.current;
            pendingHtmlRef.current = null;
            if (pending !== null) patchDom(pending);
          });
        }
      } else {
        // Not streaming — apply immediately (final render with shiki)
        patchDom(html);
      }
    });
  }, [content, isStreaming, patchDom]);

  // Cleanup event listener and pending rAF on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
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
      className={cn("streaming-markdown", variantClass, isStreaming && "md-streaming", className)}
    />
  );
}
