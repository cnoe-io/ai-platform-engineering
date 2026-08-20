import { Marked } from "marked";

import {
  DEFAULT_PAGES,
  parseFrontmatter,
  SPEC_BY_PATH,
  type FrontmatterValue,
} from "@/lib/tome/schema";
import type { PageKind, PageTreeNode } from "@/types/tome";
import { parseTomeEmbed } from "@/lib/tome/embeds";

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const PAGE_KINDS = new Set<PageKind>(["stable", "dynamic", "hidden", "report"]);

export interface WikiExportPage {
  path: string;
  title: string;
  kind: PageKind;
  body: string;
  anchor: string;
}

export interface WikiExportDocument {
  projectName: string;
  exportedAt: Date;
  pages: WikiExportPage[];
}

/** Remove agent-only guidance before any export renderer sees page content. */
export function stripAgentHtmlComments(markdown: string): string {
  return markdown.replace(HTML_COMMENT_RE, "").trim();
}

function flattenTree(tree: PageTreeNode[]): string[] {
  const paths: string[] = [];
  const visit = (nodes: PageTreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "folder") paths.push(node.path);
      visit(node.children);
    }
  };
  visit(tree);
  return paths;
}

function orderedPaths(pages: Record<string, string>, tree: PageTreeNode[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (path: string): void => {
    if (pages[path] === undefined || seen.has(path)) return;
    seen.add(path);
    result.push(path);
  };

  // Report surfaces (notably standup.md) are intentionally absent from the
  // sidebar tree. Seed specs put those and the ordinary top-level pages into
  // their canonical relative positions before the rest of the sidebar order.
  [...DEFAULT_PAGES].sort((a, b) => a.order - b.order).forEach((page) => add(page.path));
  flattenTree(tree).forEach(add);
  Object.keys(pages).sort().forEach(add);
  return result;
}

function pageKind(path: string, frontmatter: Record<string, FrontmatterValue>): PageKind {
  const candidate = frontmatter.kind;
  if (typeof candidate === "string" && PAGE_KINDS.has(candidate as PageKind)) {
    return candidate as PageKind;
  }
  return SPEC_BY_PATH.get(path)?.kind ?? "stable";
}

function anchorBase(path: string): string {
  return `page-${path.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "wiki"}`;
}

/** Build the shared, sanitized model used by PDF, HTML, and Markdown exports. */
export function buildWikiExportDocument(input: {
  projectName: string;
  pages: Record<string, string>;
  tree: PageTreeNode[];
  exportedAt?: Date;
}): WikiExportDocument {
  const anchors = new Map<string, number>();
  const exportPages = orderedPaths(input.pages, input.tree).map((path) => {
    const [frontmatter, rawBody] = parseFrontmatter(input.pages[path]);
    const base = anchorBase(path);
    const duplicate = anchors.get(base) ?? 0;
    anchors.set(base, duplicate + 1);
    const anchor = duplicate === 0 ? base : `${base}-${duplicate + 1}`;
    const titleValue = frontmatter.title;

    return {
      path,
      title:
        typeof titleValue === "string" && titleValue.trim()
          ? titleValue.trim()
          : (SPEC_BY_PATH.get(path)?.title ?? path),
      kind: pageKind(path, frontmatter),
      body: stripAgentHtmlComments(rawBody),
      anchor,
    };
  });

  return {
    projectName: input.projectName.trim() || "Wiki",
    exportedAt: input.exportedAt ?? new Date(),
    pages: exportPages,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeExternalHref(href: string): string | null {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith("#")) return href;
  return null;
}

function formatExportDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(value);
}

function markdownRenderer(): Marked {
  return new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      code({ text, lang }) {
        const embed = parseTomeEmbed(lang ?? "", text);
        if (embed) {
          if (embed.ok) {
            return `<aside class="embed-link"><strong>${escapeHtml(embed.value.title)}</strong><a href="${escapeHtml(embed.value.watchUrl)}">${escapeHtml(embed.value.linkLabel)}</a></aside>`;
          }
        }
        const language = lang?.trim().match(/^[A-Za-z0-9_+-]+$/)?.[0];
        const className = language ? ` class="language-${language}"` : "";
        return `<pre><code${className}>${escapeHtml(text)}\n</code></pre>`;
      },
      // Raw HTML in a wiki page is displayed as source in exports. This keeps
      // downloaded HTML inert even when a page contains script/event markup.
      html({ text }) {
        return `<pre class="raw-html"><code>${escapeHtml(text)}</code></pre>`;
      },
      link({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        const safe = safeExternalHref(href);
        if (!safe) return label;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(safe)}"${titleAttr}>${label}</a>`;
      },
      image({ href, title, text }) {
        const safe = safeExternalHref(href);
        const label = escapeHtml(text || title || "Image");
        return safe
          ? `<a class="image-link" href="${escapeHtml(safe)}">Image: ${label}</a>`
          : `<span class="image-link">Image: ${label}</span>`;
      },
    },
  });
}

/** Render a self-contained, print-ready HTML download from the shared model. */
export function renderWikiHtml(document: WikiExportDocument): string {
  const renderer = markdownRenderer();
  const toc = document.pages
    .map(
      (page, index) =>
        `<li><a href="#${page.anchor}"><span class="toc-index">${String(index + 1).padStart(2, "0")}</span><span class="toc-label"><span class="toc-title">${escapeHtml(page.title)}</span><span class="toc-path">${escapeHtml(page.path)}</span></span></a></li>`,
    )
    .join("");
  const sections = document.pages
    .map((page, index) => {
      const rendered = page.body
        ? String(renderer.parse(page.body))
        : '<p class="empty">(no content)</p>';
      return `<section id="${page.anchor}" class="page">
  <header class="page-head">
    <div class="page-meta"><span class="page-number">${String(index + 1).padStart(2, "0")}</span><span class="page-path">${escapeHtml(page.path)}</span><span class="badge badge-${page.kind}">${page.kind}</span></div>
    <h1>${escapeHtml(page.title)}</h1>
  </header>
  <div class="page-body">${rendered}</div>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.projectName)} — Wiki export</title>
<style>
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: #eef2f7; color: #172033; font: 14px/1.6 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { width: min(960px, calc(100% - 32px)); margin: 32px auto 64px; }
.cover, .toc, .page { border: 1px solid #e4e7ec; background: #fff; box-shadow: 0 18px 45px rgba(16, 24, 40, .08); }
.cover { position: relative; min-height: 500px; display: flex; flex-direction: column; overflow: hidden; border-radius: 24px; padding: 64px; background: linear-gradient(145deg, #fff 45%, #eff6ff 100%); }
.cover::before { position: absolute; top: -180px; right: -150px; width: 430px; height: 430px; border: 70px solid rgba(23, 92, 211, .08); border-radius: 50%; content: ""; }
.cover-main { position: relative; margin: auto 0; max-width: 680px; }
.eyebrow, .toc-kicker { color: #175cd3; font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.cover h1 { max-width: 720px; margin: 12px 0 8px; color: #101828; font-size: clamp(38px, 6vw, 60px); line-height: 1.04; letter-spacing: -.035em; }
.cover .sub { color: #475467; font-size: 17px; }
.cover-footer { position: relative; display: grid; grid-template-columns: 120px 1fr; gap: 20px; align-items: center; margin-top: 48px; padding-top: 24px; border-top: 1px solid #d0d5dd; color: #667085; }
.cover-count strong { display: block; color: #175cd3; font-size: 30px; line-height: 1; }
.cover-count span, .cover-date span { display: block; margin-top: 6px; font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.cover-date strong { color: #344054; font-size: 13px; font-weight: 600; }
.toc { margin-top: 24px; border-radius: 18px; padding: 40px 44px; }
.toc h1 { margin: 5px 0 22px; color: #101828; font-size: 28px; line-height: 1.2; }
.toc ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.toc a { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; min-height: 58px; align-items: center; border: 1px solid #eaecf0; border-radius: 10px; padding: 9px 12px; color: inherit; text-decoration: none; transition: border-color .15s, transform .15s, box-shadow .15s; }
.toc a:hover { transform: translateY(-1px); border-color: #84adff; box-shadow: 0 7px 16px rgba(23, 92, 211, .09); }
.toc-index, .page-number { color: #175cd3; font-size: 11px; font-weight: 800; letter-spacing: .05em; }
.toc-label { min-width: 0; }
.toc-title { display: block; overflow: hidden; color: #101828; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.toc-path, .page-path { display: block; overflow: hidden; color: #667085; font: 10.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
.page { margin-top: 24px; border-radius: 18px; padding: 48px 56px 56px; scroll-margin-top: 24px; }
.page-head { margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #d0d5dd; }
.page-meta { display: flex; align-items: center; gap: 10px; }
.page-path { flex: 1; color: #175cd3; }
.page-head h1 { margin: 12px 0 0; color: #101828; font-size: 30px; line-height: 1.2; letter-spacing: -.02em; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 7px; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.badge-stable { background: #dbeafe; color: #1d4ed8; } .badge-dynamic { background: #d1fae5; color: #047857; }
.badge-hidden { background: #f2f4f7; color: #475467; } .badge-report { background: #fef0c7; color: #b54708; }
.page-body h1 { margin-top: 30px; font-size: 25px; } .page-body h2 { margin-top: 30px; padding-left: 11px; border-left: 3px solid #1570ef; color: #101828; font-size: 19px; }
.page-body h3 { margin-top: 24px; color: #101828; font-size: 16px; } .page-body p { margin: 9px 0; }
.page-body ul, .page-body ol { padding-left: 24px; } .page-body li + li { margin-top: 5px; }
.page-body code { border-radius: 3px; background: #f2f4f7; padding: 1px 4px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.page-body pre { overflow-x: auto; border: 1px solid #e4e7ec; border-radius: 8px; background: #f8fafc; padding: 14px 16px; line-height: 1.5; }
.page-body pre code { background: none; padding: 0; }
.page-body table { width: 100%; margin: 12px 0; border-collapse: collapse; font-size: 11.5px; }
.page-body th, .page-body td { border: 1px solid #d0d5dd; padding: 6px 8px; text-align: left; vertical-align: top; }
.page-body th { background: #f9fafb; } .page-body a { color: #175cd3; } .empty { color: #98a2b3; font-style: italic; }
.page-body blockquote { margin-left: 0; border-left: 3px solid #d0d5dd; padding-left: 12px; color: #475467; }
.raw-html { color: #475467; } .image-link { color: #175cd3; font-style: italic; }
.embed-link { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 14px 0; border: 1px solid #d0d5dd; border-radius: 8px; background: #f8fafc; padding: 14px 16px; }
.embed-link a { flex: none; }
@media (max-width: 680px) {
  main { width: min(100% - 20px, 960px); margin-top: 10px; }
  .cover { min-height: 440px; border-radius: 16px; padding: 38px 28px; }
  .cover-footer { grid-template-columns: 1fr; }
  .toc { border-radius: 14px; padding: 28px 22px; }
  .toc ul { grid-template-columns: 1fr; }
  .page { border-radius: 14px; padding: 32px 24px 40px; }
  .page-head h1 { font-size: 26px; }
}
@media print {
  body { background: #fff; color: #172033; font-size: 10pt; }
  main { width: auto; margin: 0; }
  .cover, .toc, .page { border: 0; border-radius: 0; box-shadow: none; }
  .cover { min-height: 250mm; padding: 18mm 0; background: #fff; page-break-after: always; }
  .cover::before { display: none; }
  .cover h1 { font-size: 34pt; }
  .toc { margin: 0; padding: 0; page-break-after: always; }
  .toc ul { grid-template-columns: 1fr; gap: 4px; }
  .toc a { min-height: 0; border-width: 0 0 1px; border-radius: 0; padding: 7px 0; }
  .page { margin: 0; padding: 0; page-break-before: always; }
  .page-head h1 { font-size: 22pt; }
  .page-body h1, .page-body h2, .page-body h3 { break-after: avoid; }
  .page-body pre { overflow-wrap: anywhere; white-space: pre-wrap; }
  .page-body tr, .page-body blockquote { break-inside: avoid; }
}
</style>
</head>
<body>
<main>
<section class="cover">
  <div class="cover-main">
    <div class="eyebrow">TOME / Wiki export</div>
    <h1>${escapeHtml(document.projectName)}</h1>
    <div class="sub">Project knowledge base</div>
  </div>
  <div class="cover-footer">
    <div class="cover-count"><strong>${document.pages.length}</strong><span>Wiki pages</span></div>
    <div class="cover-date"><strong>${escapeHtml(formatExportDate(document.exportedAt))}</strong><span>Exported</span></div>
  </div>
</section>
<nav class="toc" aria-label="Table of contents"><div class="toc-kicker">Document index</div><h1>Contents</h1><ul>${toc}</ul></nav>
${sections}
</main>
</body>
</html>`;
}

/** Render a portable single-file Markdown export. */
export function renderWikiMarkdown(
  document: WikiExportDocument,
  options: { pageScoped?: boolean } = {},
): string {
  if (options.pageScoped && document.pages.length === 1) {
    const page = document.pages[0];
    const body = page.body.trim();
    const startsWithTitle = new RegExp(
      `^#\\s+${page.title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`,
      "i",
    ).test(body);
    const lines = startsWithTitle ? [body] : [`# ${page.title}`, "", body || "_(no content)_"];
    return `${lines.join("\n").trim()}\n`;
  }

  const lines = [
    `# ${document.projectName}`,
    "",
    `> TOME wiki export · ${document.exportedAt.toISOString()} · ${document.pages.length} pages`,
    "",
    "## Contents",
    "",
    ...document.pages.map((page) => `- [\`${page.path}\` — ${page.title}](#${page.anchor})`),
  ];

  for (const page of document.pages) {
    lines.push(
      "",
      "---",
      "",
      `<a id="${page.anchor}"></a>`,
      `## ${page.title}`,
      "",
      `\`${page.path}\` · **${page.kind}**`,
      "",
      page.body || "_(no content)_",
    );
  }
  return `${lines.join("\n").trim()}\n`;
}
