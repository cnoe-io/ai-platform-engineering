/**
 * Wiki page schema + frontmatter helpers.
 *
 * Pure functions only — no I/O, no Mongo, safe to import anywhere.
 *
 * A report version is a tree of markdown pages, addressable by path under
 * `<project_id>/`. Each page declares its `kind` (stable | dynamic | hidden |
 * report) in YAML frontmatter. Stable pages are agent-drafted once at founding,
 * then human-owned — the autonomous ingest loop only preserves them. Dynamic
 * pages are agent-rewritten every ingest.
 */

import type { PageKind, NodeKind } from "@/types/tome";
import { PAGE_KINDS } from "@/types/tome";

export interface PageSpec {
  path: string;
  kind: PageKind;
  title: string;
  order: number;
}

function spec(
  path: string,
  kind: PageKind,
  title: string,
  order: number,
): PageSpec {
  return { path, kind, title, order };
}

/**
 * Top-level seed pages for a Project — these describe the strategic effort as
 * a whole, cross-cutting across all attached sources. Per-source detail lives
 * under `repos/<slug>/...` etc. (see templates below).
 *
 * Order is sidebar order at the same depth; nesting is path-derived
 * (`a/b.md` is a child of `a.md`).
 *
 * `charter.md` / `roadmap.md` / `team-assignments.md` seed as `kind=stable`:
 * the agent drafts them once at founding (from the charter field + sources),
 * then the autonomous ingest loop only preserves them. Dynamic pages are
 * grounded by them.
 */
export const DEFAULT_PAGES: readonly PageSpec[] = [
  spec("standup.md", "report", "The Standup", -10),
  // 3 stable — human-curated beliefs & commitments.
  spec("charter.md", "stable", "Charter", -5),
  spec("roadmap.md", "stable", "Roadmap", -4),
  spec("team-assignments.md", "stable", "Team Assignment", -3),
  // 2 dynamic flat pages (glossary is a directory, agent-maintained per term).
  spec("activity.md", "dynamic", "Activity", 0),
  spec("architecture.md", "dynamic", "Architecture", 10),
  spec("memory.md", "hidden", "Memory", 100),
];

// Founding templates for the stable pages. The greenfield agent fills these
// from the charter field + sources where it can, and leaves genuinely
// human-only sections as the prompt text. The `##` section headers are the
// contract the structured surfaces and the ingest prompt both rely on.
// This charter applies at BHAG, Area, or T3 level — write each section at the
// scope of THIS entity (broad and durable for a BHAG, concrete and specific
// for a T3). The parent Area/BHAG is stored as system metadata and is NOT
// restated in the body.
const CHARTER_BODY = `## Problem Statement
_The core customer problem, in 2-4 sentences: what pain exists, for whom, and why it is unsolved or poorly solved today. Include a short profile of who has this problem._
<!-- Confluence project/venture space -> overview, brief, or kickoff page. Fallback: GitHub repo README (top section) or Webex space pinned messages / early discussion. If not found, output "TBD -- problem statement not located in sources." -->

## Why Now
_Why this is worth doing at this moment: the timing driver (industry shift, technology maturity, competitive window, or pull from a BU/customer). One short paragraph._
<!-- Confluence brief/kickoff or a strategy/thesis page; Webex space discussion of rationale. If not found, output "TBD -- timing rationale not captured." -->

## Alignment
_How this work advances its parent, and which delivery window it serves._

- _Alignment rationale: how this contributes to the Area and BHAG it belongs to (draw the parent names from system metadata; explain the fit, do not just restate the linkage)._
- _Window: is this Market Making (Why/What, ~9+ months out) or Market Serving (How/When, ~6 months out), or a mix? State which, and briefly why._
<!-- Parent Area/BHAG names come from system metadata. Alignment reasoning and MM/MS designation: Confluence strategy page or venture proposal; Webex leadership/CL discussion. If not found, output "TBD -- alignment rationale not captured" and "Window: TBD (MM / MS / mixed)." -->

## Scope, Assumptions & Boundaries
_What this effort covers, what it assumes to be true, and where its edges are._

- _In scope: the problems, deliverables, or capabilities this effort owns._
- _Out of scope: what is deliberately NOT being built or addressed. Be explicit -- this prevents drift and wrong assumptions._
- _Assumptions & boundaries: what is currently believed about the problem, the environment, and this entity's autonomy -- the conditions under which the charter holds._
<!-- Confluence charter/proposal page; T3 proposal fields (problem, assumptions + boundaries). GitHub milestones/issues can indicate in-scope work. If not found, output "TBD" under each of the three bullets. -->

## Ideal Customer Profile (ICP)
_Who this is for and what is understood about their world._

- _Target personas: roles and their demographic / technographic profile (e.g., "service-provider network engineer", "healthcare IT lead")._
- _Current market understanding: the state of the space and where it is heading._
- _Use cases: the concrete situations in which the ICP would adopt or benefit._
- _Customer research insights: what has been learned directly from design partners or prospects._
<!-- Confluence research/ICP pages, design-partner notes; Webex design-partner channels for research insights. At BHAG level this is broad; at T3 level it is specific. If not found, output "TBD" per bullet. -->

## Goals
_What success looks like, as concrete outcomes rather than activities. What state of the world means this effort has won._
<!-- Confluence charter/OKR page; venture proposal "outcome / exit condition". If not found, output "TBD -- success outcomes not defined." -->

## KPIs
_The measurable indicators for the goals above. For each: metric, target value, and time frame. Include a baseline (before value) where known._

| Metric | Baseline | Target | Time frame |
| --- | --- | --- | --- |
|  |  |  |  |
<!-- Confluence metrics/OKR page or venture proposal ("quantitative metrics and KPIs, before and after"). Live values may come from dashboards linked in Confluence/GitHub. If none found, keep the header row and one empty row, and output "TBD -- KPIs not defined." -->
`;

// This roadmap applies at BHAG, Area, or T3 level — write each section at the
// scope of THIS entity: a BHAG/Area roadmap leans on the Milestones +
// goal-level success signals; a T3 roadmap leans on the Delivery Plan table
// with concrete dates and release types. The parent Area/BHAG is stored as
// system metadata and is NOT restated in the body. Time axis convention: the
// fiscal year runs Aug 1 - Jul 31. Quarters map as: Q1 = Aug-Oct, Q2 = Nov-Jan,
// Q3 = Feb-Apr, Q4 = May-Jul. FY numbering follows the ending calendar year
// (e.g., FY26 = Aug'25-Jul'26, so Q4 FY26 = May-Jul'26 and Q1 FY27 =
// Aug-Oct'26). Decompose to months where useful (e.g., "Jul'26"). Roadmap and
// execution-plan content may live in GitHub (e.g., ROADMAP.md / PLAN.md,
// wiki, docs/, project boards, milestones, issues) as well as in Confluence
// and Webex -- treat GitHub as a first-class roadmap source, not only a
// source of code artifacts.
const ROADMAP_BODY = `## Intent
_Two to three sentences: what this roadmap covers, the period it spans, and the single headline goal for that period._
<!-- Confluence roadmap/wiki page header; GitHub roadmap or execution-plan docs (e.g., ROADMAP.md, PLAN.md, docs/ or wiki, project board description); Webex planning discussion. If not found, output "TBD -- roadmap intent not captured." -->

## Milestones
_The dated outcomes that define progress, ordered by target date. Each milestone is an outcome or goal (not a task), tied to a time window, with the signal that proves it was met. Include the delivery window (Market Making or Market Serving) and current status._

| Milestone | Target (Qtr / Month) | Outcome & Success Signal | MM/MS | Owner | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |
<!-- Confluence roadmap page and quarterly-goals ("Broad Roadmap Intent") pages; GitHub milestones for dates and completion state; Webex planning threads. MM/MS designation should match the charter's Alignment section. Status: derive "Done"/"In progress" from GitHub milestone completion where linked. Status is one of: Not started / In progress / At risk / Blocked / Done. If none found, keep the header row and one empty row, and output "TBD -- milestones not defined." -->

## Delivery Plan
_The concrete deliverables that ladder up to the milestones above, grouped by workstream/component. For each: what it is, which milestone it supports, its target date, its release type, owner, and status. This is the detailed layer -- expect it to be rich at T3 level and lighter at BHAG/Area level._

| Deliverable | Workstream | Target Date | Release Type | Supports Milestone | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |
<!-- GitHub (release tags, milestones, issues, project boards) for deliverables, dates, and status; Confluence deliverables/wiki pages. Release Type is one of: OSS (open source) / CSS (closed source) / Prototype / Paper / Demo / Spec. Status is one of: Not started / In progress / At risk / Blocked / Done -- put an ETA in the status cell for in-progress items. If none found, keep the header row and one empty row, and output "TBD -- deliverables not defined." -->

## Progress Summary
_A short narrative of current health: what has shipped since the last update, what is on track, what has slipped or is at risk (and why), and any change in dates. Two to five sentences._
<!-- Compare current status against the previous roadmap version; GitHub closed vs. open milestones/issues since last update; Webex status updates. If no prior state exists, summarize current status from the tables above. If nothing found, output "TBD -- no progress data available." -->

## Dependencies & Open Questions
_Cross-team or external dependencies that gate this roadmap, and the unresolved questions that could change it. State each dependency as "X depends on Y" and each question with why it matters and who owns the answer._
<!-- Confluence roadmap notes; Webex planning discussions; GitHub issues labeled dependency/blocked. If not found, output "None identified." -->
`;

// This page applies at BHAG, Area, or T3 level — write each section at the
// scope of THIS entity: at T3 level the roster is the 1-5 accountable members
// plus lead and advisors; at Area level the "team" is the Context Leader pod
// (Product, Engineering, Ops, Marketing, Biz Dev, Design, with the P-E pair
// holding decision responsibility); at BHAG level it is the four-function pod
// (Product, Engineering, Ops, Marketing, no explicit pod lead). The parent
// Area/BHAG (and any category grouping) is stored as system metadata and is
// NOT restated in the body. Assignment to a venture is not a reporting line
// -- people keep their functional homes for people leadership, coaching, and
// development; this page captures venture roles, not org structure.
const TEAM_ASSIGNMENTS_BODY = `## Roster
_The accountable members of this team. For each: name, primary function, whether they lead or are a member, and what they specifically own within the team. Keep to the people accountable for delivery; advisors go in their own section below._

| Name | Function | Assignment | Responsibilities |
| --- | --- | --- | --- |
|  |  |  |  |
<!-- Member list, Roles and responsibilities: Confluence team/assignment pages; GitHub (CODEOWNERS, repo collaborators, commit history) for engineering ownership; Webex space membership. Function is one of: Product / Engineering / Ops / Marketing / Biz Dev / Design -- a team may be single-function or cross-functional. Assignment is one of: Lead / Member. If not found, keep the header row and one empty row, and output "TBD -- roster not defined." -->

## Leadership & Decision Responsibility
_Who leads this team and who carries decision responsibility. At Area level, name the P-E pair that holds decision responsibility within the pod. At BHAG level, note that there is no explicit pod lead and name the four functional owners. State each clearly as "Name -- role -- decides on X."_
<!-- Confluence CL/assignment pages; Webex leadership discussions. At Area/BHAG this is the Context Leader pod; the P-E pair has decision rights at the Area layer. If not found, output "TBD -- leadership not assigned." -->

## Advisors
_People who advise this team but are not accountable members and are not counted in the team's core size. For each: name and the area they advise on._
<!-- Confluence assignment pages (often written as "+ Name as advisor"); Webex. If none, output "None." -->

## External / Partner Engagement Owners
_The named owner for each external partner or design-partner engagement this team runs. One owner per partner; this is who fronts the relationship, not the partner's own staff._

| Partner / External Entity | Owner | Nature of Engagement |
| --- | --- | --- |
|  |  |  |
<!-- Confluence partner/engagement pages; Webex partner channels; Biz Dev records. Applies mainly to partner-facing teams -- many teams will have none. If none, keep the header row and one empty row, and output "None -- no external engagements." -->
`;

export const STABLE_SEED_BODIES: Record<string, string> = {
  "charter.md": CHARTER_BODY,
  "roadmap.md": ROADMAP_BODY,
  "team-assignments.md": TEAM_ASSIGNMENTS_BODY,
};

// Per-source page templates. Materialized into actual page paths by the ingest
// agent — e.g. for a Repo with slug `mycelium`, REPO_TEMPLATE expands into
// pages at `repos/mycelium/overview.md`, etc.
export const REPO_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
  spec("activity.md", "dynamic", "Activity", 10),
  spec("architecture.md", "dynamic", "Architecture", 20),
  spec("status.md", "dynamic", "Status", 30),
  spec("conversations.md", "dynamic", "Conversations", 40),
];

export const WEBEX_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
  spec("actions.md", "dynamic", "Actions", 10),
  spec("activity.md", "dynamic", "Activity", 20),
];

export const CONFLUENCE_TEMPLATE: readonly PageSpec[] = [
  spec("overview.md", "dynamic", "Overview", 0),
  spec("activity.md", "dynamic", "Activity", 10),
  spec("references.md", "dynamic", "References", 20),
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

export const GLOSSARY_SCOPES = ["org", "project", "bhag", "area"] as const;
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

// ---------------------------------------------------------------------------
// Tracked entities — Issues, Decisions, Suggestions (#157). Same one-file-per-
// entry structured primitive as the glossary and edges: one file per entry
// under `<dir>/<slug>.md` with `type` + `status` frontmatter and a prose body.
// This is the doc/storage surface only; the MCP lifecycle tools
// (tome_issue_mark_complete, etc.) land in a follow-up. Keep vocabularies in
// sync with reports/schema.py.
// ---------------------------------------------------------------------------

export const ISSUES_DIR = "issues";
export const ISSUE_TYPE = "issue";
export const ISSUE_STATUSES = ["open", "resolved"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const DECISIONS_DIR = "decisions";
export const DECISION_TYPE = "decision";
export const DECISION_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const SUGGESTIONS_DIR = "suggestions";
export const SUGGESTION_TYPE = "suggestion";
export const SUGGESTION_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

// Shared frontmatter keys for tracked entities (FM_STATUS is reused).
export const FM_OWNER = "owner";
export const FM_OPENED = "opened";

/** True when a page's frontmatter marks it as one of the tracked-entity types. */
export function isTrackedEntity(fm: Record<string, FrontmatterValue>): boolean {
  const t = String(fm[FM_TYPE] ?? "").toLowerCase();
  return t === ISSUE_TYPE || t === DECISION_TYPE || t === SUGGESTION_TYPE;
}

/** Derive a tracked-entity filename slug from a short title (glossary rule). */
export function trackedEntitySlug(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "entry";
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
