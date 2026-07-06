/**
 * Wiki page schema + frontmatter helpers.
 *
 * Pure functions only — no I/O, no Mongo, safe to import anywhere.
 *
 * A report version is a tree of markdown pages, addressable by path under
 * `<project_id>/`. Each page declares its `kind` (stable | dynamic | hidden |
 * report) in YAML frontmatter. Stable pages are agent-drafted once at founding,
 * then human-owned — the autonomous ingest loop only preserves them. Dynamic
 * pages are agent-rewritten every ingest, grounded by the stable pages.
 */

import type { PageKind, NodeKind } from "@/types/tome";
import { PAGE_KINDS } from "@/types/tome";

export interface PageSpec {
  path: string;
  kind: PageKind;
  title: string;
  order: number;
  groundedBy: readonly string[];
}

function spec(
  path: string,
  kind: PageKind,
  title: string,
  order: number,
  groundedBy: readonly string[] = [],
): PageSpec {
  return { path, kind, title, order, groundedBy };
}

/**
 * Top-level seed pages for a Project — these describe the strategic effort as
 * a whole, cross-cutting across all attached sources. Per-source detail lives
 * under `repos/<slug>/...` etc. (see templates below).
 *
 * Order is sidebar order at the same depth; nesting is path-derived
 * (`a/b.md` is a child of `a.md`).
 *
 * `charter.md` / `objectives.md` / `roadmap.md` seed as `kind=stable`: the
 * agent drafts them once at founding (from the charter field + sources), then
 * the autonomous ingest loop only preserves them. Dynamic pages are grounded
 * by them.
 */
export const DEFAULT_PAGES: readonly PageSpec[] = [
  spec("standup.md", "report", "The Standup", -10, ["overview.md"]),
  spec("charter.md", "stable", "Charter", -5),
  spec("objectives.md", "stable", "Objectives", -4, ["charter.md"]),
  spec("roadmap.md", "stable", "Roadmap", -3, ["charter.md"]),
  spec("overview.md", "dynamic", "Overview", 0, ["charter.md"]),
  spec("architecture.md", "dynamic", "Architecture", 20, ["charter.md"]),
  spec("marketing.md", "dynamic", "Marketing", 30, ["charter.md"]),
  spec("conversations.md", "dynamic", "Conversations", 40, ["overview.md"]),
  spec("memory.md", "hidden", "Memory", 100),
];

// Founding templates for the stable pages. The greenfield agent fills these
// from the charter field + sources where it can, and leaves genuinely
// human-only sections as the prompt text. The `##` section headers are the
// contract the structured surfaces and the ingest prompt both rely on.
const CHARTER_BODY = `## What we're building
_One or two sentences: what this is, and who it's for._

## Why it matters
_Why this is worth doing. Why now._

## What success looks like
_The concrete outcome that means we won._

## Out of scope
_What we are deliberately NOT building. Prevents drift and wrong assumptions._

-

## Confidence on key bets
_The beliefs this effort rests on, and how sure we are of each. Tiers: hypothesis · testing · validated · committed._

| Bet | Confidence | Evidence |
| --- | --- | --- |
|  |  |  |
`;

const OBJECTIVES_BODY = `## North-star metric
_The single number that best captures progress: what it is, and why it's the one that matters._

## Objectives
_What we're driving toward, and how we'll measure it._

| Objective | Metric | Target | Timeframe |
| --- | --- | --- | --- |
|  |  |  |  |

## How this ladders to org OKRs
_Which org-level OKR(s) these advance, and how._
`;

const ROADMAP_BODY = `## Now
_What we're actively building this horizon._

## Next
_Near-term bets, roughly in priority order. Themes, not dates._

## Later
_Directions we believe in but aren't committing to yet._

## Explicitly deprioritized
_What we chose not to do, and what would make us revisit._

| What | Why deprioritized | Revisit when |
| --- | --- | --- |
|  |  |  |
`;

export const STABLE_SEED_BODIES: Record<string, string> = {
  "charter.md": CHARTER_BODY,
  "objectives.md": OBJECTIVES_BODY,
  "roadmap.md": ROADMAP_BODY,
};

// Per-source page templates. Materialized into actual page paths by the ingest
// agent — e.g. for a Repo with slug `mycelium`, REPO_TEMPLATE expands into
// pages at `repos/mycelium/overview.md`, etc.
export const REPO_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
  spec("team.md", "dynamic", "Team", 10),
  spec("architecture.md", "dynamic", "Architecture", 30),
  spec("status.md", "dynamic", "Status", 40),
  spec("activity.md", "dynamic", "Activity", 50),
  spec("conversations.md", "dynamic", "Conversations", 60),
];

export const WEBEX_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
  spec("activity.md", "dynamic", "Activity", 10),
];

export const CONFLUENCE_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
];

/**
 * Materialize a per-source template under `<prefix>/`. Used to build the full
 * page enumeration shown to the ingest agent.
 */
export function expandTemplate(
  prefix: string,
  template: readonly PageSpec[],
): PageSpec[] {
  return template.map((s) => ({ ...s, path: `${prefix}/${s.path}` }));
}

// Seed body for the hidden memory page. Static: not LLM-generated.
export const MEMORY_SEED = `# Memory

_Agent-only notes. Hidden from the wiki by default. Toggle via the eye icon at the bottom of the sidebar to see / edit. The agent reads this on every ingest and may append observations it wants to remember._

## Notes
- _(none yet, populated as the agent works)_
`;

/** Pages that surface as their own UI element (rendered above the wiki). */
export const SURFACE_PATHS: ReadonlySet<string> = new Set(["standup.md"]);

export const REQUIRED_PATHS: ReadonlySet<string> = new Set(
  DEFAULT_PAGES.map((p) => p.path),
);

export const SPEC_BY_PATH: ReadonlyMap<string, PageSpec> = new Map(
  DEFAULT_PAGES.map((p) => [p.path, p]),
);

export const EMPTY_PAGE_PLACEHOLDER = "_(no content yet)_";

// ---------------------------------------------------------------------------
// Frontmatter field registry
// ---------------------------------------------------------------------------

export const FM_TITLE = "title";
export const FM_KIND = "kind";
export const FM_ORDER = "order";
export const FM_GROUNDED_BY = "grounded_by";

// `type` marks a structured entry whose frontmatter the UI renders as a form
// (e.g. glossary terms). Distinct from `kind` (the page lifecycle:
// stable/dynamic/hidden/report).
export const FM_TYPE = "type";

// ---------------------------------------------------------------------------
// Glossary — a project-level collection of term entries, one file per term at
// `glossary/<slug>.md`, each with `type: glossary` + typed frontmatter. Keep
// these vocabularies in sync with reports/schema.py (GLOSSARY_*).
// ---------------------------------------------------------------------------

export const GLOSSARY_DIR = "glossary";
export const GLOSSARY_TYPE = "glossary";

export const FM_TERM = "term";
export const FM_EXPANSION = "expansion";
export const FM_SCOPE = "scope";
export const FM_ALIASES = "aliases";
export const FM_TERM_KIND = "term_kind";
export const FM_STATUS = "status";

export const GLOSSARY_SCOPES = ["org", "project", "bhag", "swimlane"] as const;
export const GLOSSARY_TERM_KINDS = ["acronym", "term"] as const;
export const GLOSSARY_STATUSES = ["current", "deprecated"] as const;

export type GlossaryScope = (typeof GLOSSARY_SCOPES)[number];
export type GlossaryTermKind = (typeof GLOSSARY_TERM_KINDS)[number];
export type GlossaryStatus = (typeof GLOSSARY_STATUSES)[number];

/** True when a page's frontmatter marks it as a glossary term entry. */
export function isGlossaryTerm(fm: Record<string, FrontmatterValue>): boolean {
  return String(fm[FM_TYPE] ?? "").toLowerCase() === GLOSSARY_TYPE;
}

/** Derive a glossary filename slug from a term: lowercase, non-alnum → `-`. */
export function glossarySlug(term: string): string {
  const s = term
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "term";
}

// ---------------------------------------------------------------------------
// Edges — cross-project (or in-project) relationships as first-class,
// evidenced documents. Same one-file-per-entry primitive as the glossary
// : one file per edge at `edges/<slug>.md`, `type: edge` + typed
// frontmatter, prose body. Keep in sync with reports/schema.py (EDGE_*).
//
// Storage decision (option A): an edge is authored into its SOURCE
// project's `edges/` dir. The target project doesn't own a copy — it sees the
// edge via the backlink index (see lib/tome/edges-index.ts), which is built by
// scanning writes to `edges/*.md` across all projects, keyed by the edge's
// resolved target project. This matches "edges live within projects" while
// still letting the target side see edges pointing at it.
// ---------------------------------------------------------------------------

export const EDGES_DIR = "edges";
export const EDGE_TYPE = "edge";

export const FM_RELATION = "relation";
export const FM_SOURCE = "source";
export const FM_TARGET = "target";
export const FM_CONFIDENCE = "confidence";
export const FM_EVIDENCE = "evidence";
// FM_STATUS is shared with the glossary (same "status" key); the vocabulary
// below (EDGE_STATUSES) is what applies when the entry's `type` is "edge".

export const EDGE_RELATIONS = [
  "blocks",
  "depends-on",
  "supersedes",
  "duplicates",
  "contradicts",
  "relates-to",
] as const;
export const EDGE_CONFIDENCES = ["high", "medium", "low"] as const;
export const EDGE_STATUSES = ["active", "resolved", "stale"] as const;

export type EdgeRelation = (typeof EDGE_RELATIONS)[number];
export type EdgeConfidence = (typeof EDGE_CONFIDENCES)[number];
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

/** True when a page's frontmatter marks it as an edge entry. */
export function isEdge(fm: Record<string, FrontmatterValue>): boolean {
  return String(fm[FM_TYPE] ?? "").toLowerCase() === EDGE_TYPE;
}

/** Derive an edge filename slug from its label, e.g. an author-chosen short
 * description like "x-pivot-blocks-y-q3" (same slugging rule as glossary). */
export function edgeSlug(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "edge";
}

// ---------- Default-list helpers (seed-only) ----------

export function defaultStablePaths(): string[] {
  return DEFAULT_PAGES.filter((p) => p.kind === "stable").map((p) => p.path);
}

export function defaultDynamicPaths(): string[] {
  return DEFAULT_PAGES.filter((p) => p.kind === "dynamic").map((p) => p.path);
}

/** Return missing required page paths. Empty array = valid. */
export function validatePages(pages: Record<string, string>): string[] {
  const have = new Set(Object.keys(pages));
  return [...REQUIRED_PATHS].filter((p) => !have.has(p)).sort();
}

// ---------- Runtime kind discovery (frontmatter is authoritative) ----------

/**
 * Read each page's frontmatter `kind`; default to 'stable' when the page lacks
 * frontmatter or has an unknown kind.
 */
export function kindsFromPages(
  pages: Record<string, string>,
): Record<string, PageKind> {
  const out: Record<string, PageKind> = {};
  for (const [path, md] of Object.entries(pages)) {
    const [fm] = parseFrontmatter(md);
    const raw = String(fm.kind ?? "").toLowerCase();
    out[path] = (PAGE_KINDS as readonly string[]).includes(raw)
      ? (raw as PageKind)
      : "stable";
  }
  return out;
}

export function pathsWithKind(
  pages: Record<string, string>,
  kind: PageKind,
): string[] {
  const kinds = kindsFromPages(pages);
  return Object.keys(kinds).filter((p) => kinds[p] === kind);
}

/**
 * Paths whose frontmatter says stable (or hidden — same preserve-on-incremental
 * semantics). Authoritative for runtime.
 */
export function stablePathsIn(pages: Record<string, string>): string[] {
  const kinds = kindsFromPages(pages);
  return Object.keys(kinds).filter(
    (p) => kinds[p] === "stable" || kinds[p] === "hidden",
  );
}

function kindFromMd(md: string): string {
  const [fm] = parseFrontmatter(md);
  return String(fm.kind ?? "stable").toLowerCase();
}

// ---------- Frontmatter ----------

const FENCE = "---\n";

export type FrontmatterValue = string | number | boolean | string[];

/**
 * Return [{key: value}, body]. YAML-lite: top-level scalar `key: value` pairs,
 * inline `key: [a, b]` arrays, AND multi-line block-list arrays —
 * ```
 * key:
 *   - a
 *   - b
 * ```
 * — since agent-authored frontmatter (Claude writing plain YAML, not going
 * through `serializeFrontmatter`) uses the block-list form for arrays, not
 * the inline bracket form.
 */
export function parseFrontmatter(
  markdown: string,
): [Record<string, FrontmatterValue>, string] {
  if (!markdown.startsWith(FENCE)) return [{}, markdown];
  const end = markdown.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return [{}, markdown];
  const block = markdown.slice(FENCE.length, end + 1); // include trailing newline
  const rest = markdown.slice(end + 1 + FENCE.length);
  const fm: Record<string, FrontmatterValue> = {};
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const idx = raw.indexOf(":");
    if (idx === -1) continue;
    const k = raw.slice(0, idx).trim();
    const v = raw.slice(idx + 1).trim();
    if (v === "") {
      // Possible block-list: consume following `  - item` lines.
      const items: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const m = lines[j].match(/^\s+-\s*(.*)$/);
        if (!m) break;
        items.push(m[1].trim().replace(/^['"]|['"]$/g, ""));
      }
      if (items.length > 0) {
        fm[k] = items;
        i = j - 1;
        continue;
      }
    }
    fm[k] = coerce(v);
  }
  return [fm, rest];
}

export function serializeFrontmatter(
  fm: Record<string, FrontmatterValue>,
  body: string,
): string {
  if (Object.keys(fm).length === 0) return body;
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${dump(v)}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n${body.replace(/^\n+/, "")}`;
}

export function pageWithFrontmatter(s: PageSpec, body: string): string {
  const fm: Record<string, FrontmatterValue> = {
    title: s.title,
    kind: s.kind,
    order: s.order,
  };
  if (s.groundedBy.length > 0) fm.grounded_by = [...s.groundedBy];
  return serializeFrontmatter(fm, body);
}

/**
 * Full founding markdown (frontmatter + template body) for a stable seed page,
 * or null if `path` isn't one.
 */
export function stableSeedPage(path: string): string | null {
  const s = SPEC_BY_PATH.get(path);
  const body = STABLE_SEED_BODIES[path];
  if (!s || body === undefined) return null;
  return pageWithFrontmatter(s, body);
}

/** `{path: founding markdown}` for every stable seed page. */
export function stableSeedTemplates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of DEFAULT_PAGES) {
    const page = stableSeedPage(s.path);
    if (page !== null) out[s.path] = page;
  }
  return out;
}

function coerce(v: string): FrontmatterValue {
  const s = v.trim();
  if (!s) return "";
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, ""));
  }
  const lower = s.toLowerCase();
  if (lower === "true" || lower === "false") return lower === "true";
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  return s.replace(/^['"]|['"]$/g, "");
}

function dump(v: FrontmatterValue): string {
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

// ---------- Page tree (for sidebar nav) ----------

export interface PageNode {
  path: string;
  title: string;
  kind: NodeKind;
  order: number;
  children: PageNode[];
}

/**
 * Build a hierarchical tree from `{path: markdown}`. Root pages have no parent.
 *
 * `kind: report` pages and SURFACE_PATHS are excluded (they have their own UI
 * surface). `kind: hidden` pages ARE included; the frontend chooses whether to
 * render them. Synthesizes `kind: folder` nodes for nested pages whose
 * `<dir>.md` parent doesn't exist.
 */
export function buildTree(pages: Record<string, string>): PageNode[] {
  const nodes = new Map<string, PageNode>();
  for (const [path, md] of Object.entries(pages)) {
    if (kindFromMd(md) === "report") continue;
    if (SURFACE_PATHS.has(path)) continue;
    const [fm] = parseFrontmatter(md);
    const s = SPEC_BY_PATH.get(path);
    const title = String(fm.title ?? (s ? s.title : pathToTitle(path)));
    const rawKind = fm.kind;
    const kind: NodeKind =
      typeof rawKind === "string" &&
      (PAGE_KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as NodeKind)
        : s
          ? s.kind
          : "stable";
    const rawOrder = fm.order;
    const order =
      typeof rawOrder === "number" ? rawOrder : s ? s.order : 999;
    nodes.set(path, { path, title, kind, order, children: [] });
  }

  // Synthesize folder nodes for nested pages whose ancestor `<dir>.md` is absent.
  const folders = new Map<string, PageNode>();
  for (const path of [...nodes.keys()]) {
    if (!path.includes("/")) continue;
    const parts = path.split("/").slice(0, -1); // drop the leaf .md
    for (let i = 1; i <= parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      const pageAnchor = `${dirPath}.md`;
      if (nodes.has(pageAnchor) || folders.has(dirPath)) continue;
      folders.set(dirPath, {
        path: dirPath,
        title: pathToTitle(dirPath),
        kind: "folder",
        order: 999,
        children: [],
      });
    }
  }

  const allNodes = new Map<string, PageNode>([...nodes, ...folders]);
  const roots: PageNode[] = [];

  const sorted = [...allNodes.entries()].sort((a, b) => {
    const da = depthForNode(a[0]);
    const db = depthForNode(b[0]);
    if (da !== db) return da - db;
    if (a[1].order !== b[1].order) return a[1].order - b[1].order;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  for (const [path, node] of sorted) {
    const parent = resolveParent(path, allNodes);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (list: PageNode[]): void => {
    list.sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.path < b.path ? -1 : 1,
    );
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function resolveParent(
  path: string,
  allNodes: Map<string, PageNode>,
): PageNode | null {
  if (!path.includes("/")) return null;
  const leaf = path.slice(0, path.lastIndexOf("/"));
  const pageParent = `${leaf}.md`;
  if (allNodes.has(pageParent)) return allNodes.get(pageParent)!;
  if (allNodes.has(leaf)) return allNodes.get(leaf)!;
  return null;
}

function depthForNode(path: string): number {
  return (path.match(/\//g) ?? []).length;
}

function pathToTitle(path: string): string {
  const leaf = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return leaf
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
