"use client";

/**
 * SkillMdPreview — read-only rendered view of a SKILL.md document.
 *
 * Used by `SkillMdEditor` to power the live "Preview" / "Split" modes
 * users had in the previous editor. The component:
 *   - Strips the YAML frontmatter so the preview matches what an LLM
 *     actually consumes as the skill body.
 *   - Renders the leading frontmatter as a small "Frontmatter" summary
 *     card so authors can still eyeball name/description/variables
 *     without flipping back to the source.
 *   - Highlights `{{variable}}` references so authors can spot ones
 *     they haven't bound to inputs yet (mirrors the lint in the editor).
 *
 * Heavy markdown deps (`react-markdown`, `remark-gfm`) are already
 * pulled in by `SkillFolderViewer`, so we don't add to the bundle.
 */

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export interface SkillMdPreviewProps {
  /** Raw SKILL.md source (frontmatter + body). */
  source: string;
  /** Names of declared input variables — used to highlight references. */
  declaredVariables?: { name: string }[];
  /** Optional className passthrough. */
  className?: string;
}

interface ParsedDoc {
  frontmatter: string | null;
  body: string;
}

/**
 * Split a SKILL.md document into (frontmatter, body). Mirrors the
 * frontmatter detection logic in the lint source — keep them in sync.
 */
function splitFrontmatter(source: string): ParsedDoc {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { frontmatter: null, body: source };
  }
  const closeIdx = source.indexOf("\n---", 4);
  if (closeIdx === -1) {
    return { frontmatter: null, body: source };
  }
  const frontmatter = source.slice(4, closeIdx).trim();
  // Skip the closing `---` line + the newline that follows.
  let bodyStart = closeIdx + 4;
  if (source[bodyStart] === "\r") bodyStart += 1;
  if (source[bodyStart] === "\n") bodyStart += 1;
  return { frontmatter, body: source.slice(bodyStart) };
}

/**
 * Highlight `{{variable}}` references inline. Declared variables get a
 * neutral pill; undeclared ones get an amber outline so the author
 * knows the body references something the metadata hasn't promised.
 *
 * We do this BEFORE handing the string to react-markdown by replacing
 * `{{var}}` with an HTML span — but react-markdown won't render raw
 * HTML by default (and turning that on opens an XSS surface for hub
 * skills). Instead, we walk the rendered tree via a `components`
 * override that scans text nodes.
 */
const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

function highlightVars(
  text: string,
  declared: Set<string>,
): React.ReactNode {
  if (!VAR_RE.test(text)) {
    VAR_RE.lastIndex = 0;
    return text;
  }
  VAR_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = VAR_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[1];
    const known = declared.has(name);
    out.push(
      <code
        key={`v-${key++}`}
        className={cn(
          "rounded px-1 py-0.5 text-[0.85em] font-mono not-prose border",
          known
            ? "bg-muted/60 text-foreground border-border/50"
            : "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40",
        )}
        title={known ? `Variable: ${name}` : `Undeclared variable: ${name}`}
      >
        {`{{${name}}}`}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function SkillMdPreview({
  source,
  declaredVariables,
  className,
}: SkillMdPreviewProps) {
  const { frontmatter, body } = useMemo(
    () => splitFrontmatter(source),
    [source],
  );

  const declared = useMemo(
    () => new Set((declaredVariables || []).map((v) => v.name)),
    [declaredVariables],
  );

  // We can't easily intercept text nodes inside paragraphs without a
  // remark plugin. Instead, override the leaf renderers that contain
  // user-facing text and wrap them with our highlighter. Code blocks
  // are intentionally NOT highlighted (a `{{var}}` in a code fence is
  // an example, not a reference).
  const components = useMemo(
    () => ({
      p: ({ children, ...rest }: { children?: React.ReactNode }) => (
        <p {...rest}>{walkChildren(children, declared)}</p>
      ),
      li: ({ children, ...rest }: { children?: React.ReactNode }) => (
        <li {...rest}>{walkChildren(children, declared)}</li>
      ),
      td: ({ children, ...rest }: { children?: React.ReactNode }) => (
        <td {...rest}>{walkChildren(children, declared)}</td>
      ),
      th: ({ children, ...rest }: { children?: React.ReactNode }) => (
        <th {...rest}>{walkChildren(children, declared)}</th>
      ),
    }),
    [declared],
  );

  const isEmpty = !source.trim();

  return (
    <div
      className={cn(
        "h-full overflow-auto bg-background",
        className,
      )}
      data-testid="skill-md-preview"
    >
      {frontmatter && (
        <div
          className="border-b border-border/60 bg-muted/30 px-5 py-3 text-xs"
          data-testid="skill-md-preview-frontmatter"
        >
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
            Frontmatter
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/80">
            {frontmatter}
          </pre>
        </div>
      )}

      {isEmpty ? (
        <div className="flex h-full items-center justify-center px-5 py-10 text-sm text-muted-foreground">
          Nothing to preview yet — write some markdown on the left.
        </div>
      ) : (
        <div
          className={cn(
            "prose prose-sm dark:prose-invert max-w-none px-5 py-4",
            // Tighten + boost contrast (mirrors SkillFolderViewer styling
            // so the preview matches the read-only viewer the runtime
            // actually serves).
            "prose-headings:text-foreground prose-headings:font-semibold",
            "prose-h1:text-2xl prose-h1:mt-0 prose-h1:mb-4 prose-h1:pb-2 prose-h1:border-b prose-h1:border-border/60",
            "prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3",
            "prose-h3:text-base prose-h3:mt-5 prose-h3:mb-2",
            "prose-p:text-foreground/85 prose-p:leading-relaxed",
            "prose-li:text-foreground/85 prose-li:my-0.5",
            "prose-strong:text-foreground prose-strong:font-semibold",
            "prose-a:text-primary prose-a:font-medium prose-a:no-underline hover:prose-a:underline",
            "prose-code:text-pink-600 dark:prose-code:text-pink-300 prose-code:bg-muted/60",
            "prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.85em]",
            "prose-code:before:content-none prose-code:after:content-none",
            "prose-pre:bg-muted/80 prose-pre:border prose-pre:border-border/60 prose-pre:text-foreground/90",
            "prose-blockquote:border-l-primary/40 prose-blockquote:text-foreground/75",
            "prose-hr:border-border/60",
            "prose-table:text-sm",
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {body}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * Walk a react children tree and run `highlightVars` on string leaves.
 * Preserves element children verbatim (so a `{{var}}` inside e.g. an
 * `<a>` link still gets highlighted).
 */
function walkChildren(
  children: React.ReactNode,
  declared: Set<string>,
): React.ReactNode {
  return React.Children.map(children, (child, i) => {
    if (typeof child === "string") {
      return (
        <React.Fragment key={`s-${i}`}>
          {highlightVars(child, declared)}
        </React.Fragment>
      );
    }
    return child;
  });
}
