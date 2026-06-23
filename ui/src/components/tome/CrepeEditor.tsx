"use client";

// Thin wrapper around Milkdown's Crepe WYSIWYG editor. Client-only.

import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { linkAttr } from "@milkdown/kit/preset/commonmark";
import { replaceAll } from "@milkdown/utils";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { classifyCitationHref } from "@/lib/tome/citations";

export type CrepeEditorHandle = {
  getMarkdown: () => string;
  setMarkdown: (md: string) => void;
};

type Props = {
  initialMarkdown: string;
  readonly?: boolean;
  /**
   * When true, updates to `initialMarkdown` are applied to the live editor
   * (via Milkdown's replaceAll command) rather than ignored. Default false:
   * the wiki editor reads the value once at mount and remounts on key change
   * to avoid clobbering in-flight user edits. Streaming surfaces (chat) set
   * this to true so token-by-token updates flow into the same instance.
   */
  liveUpdate?: boolean;
};

/**
 * Thin wrapper around Crepe. Mounts on the host div, exposes a ref handle
 * the parent can call to read the current markdown out (for save).
 *
 * IMPORTANT: this component does not re-create the editor when
 * `initialMarkdown` changes — that would clobber unsaved edits. Parents
 * should remount (via `key` prop) if they want a hard reset.
 */
export const CrepeEditor = forwardRef<CrepeEditorHandle, Props>(function CrepeEditor(
  { initialMarkdown, readonly = false, liveUpdate = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const crepe = new Crepe({
      root: hostRef.current,
      defaultValue: initialMarkdown,
    });
    crepeRef.current = crepe;
    readyRef.current = false;

    // Tag citation-shaped link hrefs with a chip class. This is the proper
    // Milkdown extension point — `linkAttr` is invoked when the link mark
    // renders to DOM, returning extra attributes for the <a>. Standard
    // markdown links stay portable; visual styling is in CSS.
    crepe.editor.config((ctx) => {
      const prev = ctx.get(linkAttr.key);
      ctx.set(linkAttr.key, (mark) => {
        const base = prev ? prev(mark) : {};
        const href = (mark.attrs?.href as string | undefined) || "";
        const cite = classifyCitationHref(href);
        if (!cite) return base;
        const cls = [base.class, "md-citation", `md-citation-${cite.kind}`]
          .filter(Boolean)
          .join(" ");
        return {
          ...base,
          class: cls,
          "data-citation-kind": cite.kind,
          "data-citation-label": cite.label,
        };
      });
    });

    let cancelled = false;
    crepe.create().then(() => {
      if (cancelled) return;
      crepe.setReadonly(readonly);
      readyRef.current = true;
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      crepe.destroy();
      crepeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    crepeRef.current?.setReadonly(readonly);
  }, [readonly]);

  // Stream new content into the live editor when liveUpdate is on. We
  // dedupe against the editor's current markdown to avoid no-op replaceAll
  // calls during user-typed edits.
  useEffect(() => {
    if (!liveUpdate) return;
    const crepe = crepeRef.current;
    if (!crepe || !readyRef.current) return;
    const current = crepe.getMarkdown();
    if (current === initialMarkdown) return;
    crepe.editor.action(replaceAll(initialMarkdown));
  }, [initialMarkdown, liveUpdate]);

  // Force all rendered links to open in a new tab. Crepe's default behavior
  // hijacks anchor clicks (link preview popup in editable; same-tab navigate
  // in readonly). We catch on the capture phase so we win before Crepe.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(href, "_blank", "noopener,noreferrer");
    };
    host.addEventListener("click", onClick, true);
    return () => host.removeEventListener("click", onClick, true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () =>
        normalizeMarkdown(crepeRef.current?.getMarkdown() ?? initialMarkdown),
      setMarkdown: (md: string) => {
        const crepe = crepeRef.current;
        if (!crepe || !readyRef.current) return;
        crepe.editor.action(replaceAll(md));
      },
    }),
    [initialMarkdown],
  );

  return <div ref={hostRef} className="milkdown-host" />;
});

/**
 * Undo two over-eager round-trip artifacts from Milkdown's remark serializer:
 *
 *  1. **Setext → ATX heading conversion.** `## Heading` round-trips to
 *     `Heading\n--------`. We walk back to the previous blank line so
 *     multi-line setext headings split into ATX heading + paragraph body
 *     (ATX can't span lines).
 *  2. **Bracket escaping.** `[#213]` and `[commit abc]` round-trip to
 *     `\[#213]` and `\[commit abc\]` because remark sees `[…]` as
 *     potentially-link syntax. Our citations always use literal brackets,
 *     so unescape them.
 */
function normalizeMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const isSetextH1 = /^={3,}\s*$/.test(next);
    const isSetextH2 = /^-{3,}\s*$/.test(next);

    if ((isSetextH1 || isSetextH2) && line.trim()) {
      // Multi-line setext: pull all preceding non-blank lines off `out` to
      // assemble the full heading body, then split into ATX heading + paragraph.
      const headingLines: string[] = [line];
      while (out.length > 0 && out[out.length - 1].trim() !== "") {
        headingLines.unshift(out.pop() as string);
      }
      const prefix = isSetextH1 ? "# " : "## ";
      const headText = headingLines[0].replace(/\\$/, "").trim();
      out.push(prefix + headText);
      if (headingLines.length > 1) {
        out.push("");
        for (const l of headingLines.slice(1)) {
          out.push(l.replace(/\\$/, ""));
        }
      }
      i += 2;
      continue;
    }
    out.push(line);
    i += 1;
  }

  let result = out.join("\n");
  result = result.replace(/\\([[\]])/g, "$1");
  return result;
}
