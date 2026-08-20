"""Wiki page schema + frontmatter helpers.

A report version is a tree of markdown pages, addressable by path under
`<project_id>/`. Each page declares its `kind` (stable | dynamic) in YAML
frontmatter. Stable pages are agent-drafted once at founding, then human-owned
— the autonomous ingest loop only preserves them; humans edit them directly or
via chat. Dynamic pages are agent-rewritten every ingest.
"""

from __future__ import annotations

import contextvars
import logging
import re
from dataclasses import dataclass, field, replace
from typing import Any, Literal, cast, get_args

log = logging.getLogger("tome_agent.reports.schema")

PageKind = Literal["stable", "dynamic", "hidden", "report"]
_PAGE_KINDS: tuple[str, ...] = get_args(PageKind)
# Sidebar-only marker: a synthetic non-clickable folder header rendered when
# nested children exist without a real `<dir>.md` parent page.
NodeKind = Literal["stable", "dynamic", "hidden", "report", "folder"]


@dataclass(frozen=True)
class PageSpec:
    path: str
    kind: PageKind
    title: str
    order: int
    # When False, the page is excluded from seeding and the ingest prompt —
    # templating for it is turned off without deleting the row.
    enabled: bool = True


# Top-level seed pages for a Project — these describe the strategic effort
# as a whole, cross-cutting across all attached Repos / WebexRooms /
# ConfluenceSpaces. Per-source detail lives under `repos/<slug>/...`,
# `webex/<slug>/...`, `confluence/<slug>/...` (see templates below).
#
# Order is sidebar order at the same depth; nesting is path-derived
# (`a/b.md` is a child of `a.md`).
#
# `charter.md` / `roadmap.md` / `team-assignments.md` seed as `kind=stable`:
# the agent drafts them once at founding (from the charter field + sources),
# then the autonomous ingest loop only preserves them — only human-directed
# edits (Crepe or chat) change them thereafter.
# Unfilled sections render as "answer this" cards in the UI, so seeding them
# for every project costs nothing when a team hasn't filled them in yet.
DEFAULT_PAGES: tuple[PageSpec, ...] = (
    PageSpec("standup.md",           "report",  "The Standup",     -10),
    # 3 stable — human-curated beliefs & commitments.
    PageSpec("charter.md",           "stable",  "Charter",          -5),
    PageSpec("roadmap.md",           "stable",  "Roadmap",          -4),
    PageSpec("team-assignments.md",  "stable",  "Team Assignment",  -3),
    # 2 dynamic flat pages (glossary is a directory, agent-maintained per term).
    PageSpec("activity.md",         "dynamic", "Activity",           0),
    PageSpec("architecture.md",     "dynamic", "Architecture",      10),
    PageSpec("memory.md",           "hidden",  "Memory",           100),
)


# Founding templates for the stable pages. The greenfield agent fills these
# from the charter field + sources where it can, and leaves genuinely
# human-only sections as the prompt text (the frontend renders an empty
# section as an "answer this" card; humans own the page after founding).
# The `##` section headers are the contract the structured surfaces and the
# ingest prompt both rely on — keep them in sync.
# This charter applies at BHAG, Area, or T3 level — write each section at the
# scope of THIS entity (broad and durable for a BHAG, concrete and specific
# for a T3). The parent Area/BHAG is stored as system metadata and is NOT
# restated in the body.
_CHARTER_BODY = """## Problem Statement
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
"""

# This roadmap applies at BHAG, Area, or T3 level — write each section at the
# scope of THIS entity: a BHAG/Area roadmap leans on the Milestones +
# goal-level success signals; a T3 roadmap leans on the Delivery Plan table
# with concrete dates and release types. The parent Area/BHAG is stored as
# system metadata and is NOT restated in the body. Time axis convention: the
# fiscal year runs Aug 1 - Jul 31. Quarters map as: Q1 = Aug-Oct, Q2 = Nov-Jan,
# Q3 = Feb-Apr, Q4 = May-Jul. FY numbering follows the ending calendar year
# (e.g., FY26 = Aug'25-Jul'26, so Q4 FY26 = May-Jul'26 and Q1 FY27 =
# Aug-Oct'26). Decompose to months where useful (e.g., "Jul'26"). Roadmap and
# execution-plan content may live in GitHub (e.g., ROADMAP.md / PLAN.md,
# wiki, docs/, project boards, milestones, issues) as well as in Confluence
# and Webex -- treat GitHub as a first-class roadmap source, not only a
# source of code artifacts.
_ROADMAP_BODY = """## Intent
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
"""

# This page applies at BHAG, Area, or T3 level — write each section at the
# scope of THIS entity: at T3 level the roster is the 1-5 accountable members
# plus lead and advisors; at Area level the "team" is the Context Leader pod
# (Product, Engineering, Ops, Marketing, Biz Dev, Design, with the P-E pair
# holding decision responsibility); at BHAG level it is the four-function pod
# (Product, Engineering, Ops, Marketing, no explicit pod lead). The parent
# Area/BHAG (and any category grouping) is stored as system metadata and is
# NOT restated in the body. Assignment to a venture is not a reporting line
# -- people keep their functional homes for people leadership, coaching, and
# development; this page captures venture roles, not org structure.
_TEAM_ASSIGNMENTS_BODY = """## Roster
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
"""

STABLE_SEED_BODIES: dict[str, str] = {
    "charter.md": _CHARTER_BODY,
    "roadmap.md": _ROADMAP_BODY,
    "team-assignments.md": _TEAM_ASSIGNMENTS_BODY,
}


# Per-source page templates. Materialized into actual page paths by the
# ingest agent — e.g. for a Repo with slug `mycelium`, REPO_TEMPLATE expands
# into pages at `repos/mycelium/overview.md`, `repos/mycelium/status.md`, etc.

REPO_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("activity.md",       "dynamic", "Activity",       10),
    PageSpec("architecture.md",   "dynamic", "Architecture",   20),
    PageSpec("status.md",         "dynamic", "Status",         30),
    PageSpec("conversations.md",  "dynamic", "Conversations",  40),
)

WEBEX_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("actions.md",        "dynamic", "Actions",        10),
    PageSpec("activity.md",       "dynamic", "Activity",       20),
)

CONFLUENCE_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("activity.md",       "dynamic", "Activity",       10),
    PageSpec("references.md",     "dynamic", "References",      20),
)


# ---------------------------------------------------------------------------
# Live template overrides (DB-backed config, fetched per ingest run).
#
# The constants above (DEFAULT_PAGES / *_TEMPLATE) are the hardcoded fallback.
# When a run fetches the admin-editable config from the backend, it calls
# `set_template_overrides()` with the parsed scopes; the accessors below then
# prefer that config. Task-local so concurrent runs can't clobber each other,
# and so a run that never sets overrides transparently gets the constants.
# ---------------------------------------------------------------------------

# Scope keys mirror the backend's TEMPLATE_SCOPES.
SCOPE_TOP_LEVEL = "top-level"
SCOPE_GITHUB = "github"
SCOPE_CONFLUENCE = "confluence"
SCOPE_WEBEX = "webex"

_template_overrides: contextvars.ContextVar[dict[str, tuple[PageSpec, ...]] | None] = (
    contextvars.ContextVar("tome_template_overrides", default=None)
)

# Raw fetched page dicts (path/kind/title/order/enabled/body), kept alongside
# the parsed PageSpec overrides above. PageSpec has no `body` field — it's
# built for structural things (sort order, kind-based preserve/rewrite rules)
# that never needed seed content — so the full per-page body/guidance text
# would otherwise be discarded the moment `set_template_overrides()` parses
# it. `full_template_snapshot()` is the one place that surfaces it.
_raw_template_overrides: contextvars.ContextVar[dict[str, list[dict[str, Any]]] | None] = (
    contextvars.ContextVar("tome_raw_template_overrides", default=None)
)

# Per-scope `PageTemplateDoc.version` for the live config, set alongside
# `_raw_template_overrides`. 0 (the default when unset) matches the store's
# own "still shipped defaults, never admin-edited" semantics. Used to stamp
# `template_version` onto pages at write time (see #488).
_template_versions: contextvars.ContextVar[dict[str, int] | None] = (
    contextvars.ContextVar("tome_template_versions", default=None)
)


def _spec_from_dict(raw: dict[str, Any]) -> PageSpec | None:
    """Parse one page dict from the config API into a PageSpec, or None if it
    is malformed (missing path/kind/title) so one bad row can't break a run."""
    path = raw.get("path")
    kind = raw.get("kind")
    title = raw.get("title")
    if not isinstance(path, str) or not path or kind not in _PAGE_KINDS:
        return None
    order = raw.get("order")
    return PageSpec(
        path=path,
        kind=cast(PageKind, kind),
        title=str(title) if title else path,
        order=int(order) if isinstance(order, (int, float)) else 0,
        enabled=raw.get("enabled") is not False,
    )


def set_template_overrides(
    by_scope: dict[str, list[dict[str, Any]]] | None,
    versions: dict[str, int] | None = None,
) -> None:
    """Install per-run template config fetched from the backend. Silently keeps
    the hardcoded fallback for any scope that is absent or fails to parse."""
    _raw_template_overrides.set(by_scope or None)
    _template_versions.set(versions or None)
    if not by_scope:
        _template_overrides.set(None)
        return
    parsed: dict[str, tuple[PageSpec, ...]] = {}
    for scope, pages in by_scope.items():
        if not isinstance(pages, list):
            continue
        # Drop disabled pages here so every consumer (prompt + seeding) honors
        # the toggle without repeating the filter.
        specs = tuple(
            s
            for s in (_spec_from_dict(p) for p in pages)
            if s is not None and s.enabled
        )
        if specs:
            parsed[scope] = specs
    _template_overrides.set(parsed or None)


def _override(scope: str) -> tuple[PageSpec, ...] | None:
    overrides = _template_overrides.get()
    return overrides.get(scope) if overrides else None


def default_pages() -> tuple[PageSpec, ...]:
    """Top-level project pages — config override if set, else DEFAULT_PAGES."""
    return _override(SCOPE_TOP_LEVEL) or DEFAULT_PAGES


def repo_template() -> tuple[PageSpec, ...]:
    return _override(SCOPE_GITHUB) or REPO_TEMPLATE


def webex_template() -> tuple[PageSpec, ...]:
    return _override(SCOPE_WEBEX) or WEBEX_TEMPLATE


def confluence_template() -> tuple[PageSpec, ...]:
    return _override(SCOPE_CONFLUENCE) or CONFLUENCE_TEMPLATE


def _fallback_template_snapshot() -> dict[str, list[dict[str, Any]]]:
    """Build the full-content snapshot shape from the hardcoded constants, for
    when no run has fetched the live config (or the fetch failed). Dynamic
    pages get `body: ""` here — there's no Python-side equivalent of the
    TS DEFAULT_GUIDANCE map, matching today's degraded-mode behavior."""
    by_scope: dict[str, tuple[PageSpec, ...]] = {
        SCOPE_TOP_LEVEL: DEFAULT_PAGES,
        SCOPE_GITHUB: REPO_TEMPLATE,
        SCOPE_CONFLUENCE: CONFLUENCE_TEMPLATE,
        SCOPE_WEBEX: WEBEX_TEMPLATE,
    }
    return {
        scope: [
            {
                "path": spec.path,
                "kind": spec.kind,
                "title": spec.title,
                "order": spec.order,
                "enabled": spec.enabled,
                "body": STABLE_SEED_BODIES.get(spec.path, ""),
            }
            for spec in specs
        ]
        for scope, specs in by_scope.items()
    }


def full_template_snapshot() -> dict[str, list[dict[str, Any]]]:
    """The full page-template config — every page's path/kind/title/order/
    enabled AND seed body/guidance content, by scope. Unlike `default_pages()`/
    `repo_template()`/etc. (which return `PageSpec`, with no `body` field),
    this is the one accessor that preserves what a run actually fetched from
    the backend. Falls back to the hardcoded constants when no run has
    fetched live config yet."""
    raw = _raw_template_overrides.get()
    return raw if raw is not None else _fallback_template_snapshot()


def template_version_for(scope: str) -> int:
    """The live `PageTemplateDoc.version` for `scope`, or 0 (never
    admin-edited / no run has fetched live config) when unknown."""
    versions = _template_versions.get()
    return versions.get(scope, 0) if versions else 0


def expand_template(prefix: str, template: tuple[PageSpec, ...]) -> tuple[PageSpec, ...]:
    """Materialize a per-source template under `<prefix>/`. Used to build the
    full page enumeration shown to the ingest agent."""
    return tuple(
        replace(spec, path=f"{prefix}/{spec.path}") for spec in template
    )


# Connector `source_prefix` -> template scope. Mirrors the backend's
# TEMPLATE_SCOPES; kept here (rather than on each Connector) since schema.py
# has no connector import to avoid a cycle.
SOURCE_PREFIX_SCOPE: dict[str, str] = {
    "repos": SCOPE_GITHUB,
    "confluence": SCOPE_CONFLUENCE,
    "webex": SCOPE_WEBEX,
}


def expected_template_pages(
    top_level: tuple[PageSpec, ...],
    per_source: dict[str, tuple[PageSpec, ...]],
) -> dict[str, PageSpec]:
    """Build `{path: PageSpec}` for every page the live template config
    currently expects to exist — top-level pages plus each `<prefix>/<slug>/`
    per-source template, expanded. `per_source` is `{"<prefix>/<slug>": template}`
    for each attached source. Shared by `_template_change_note` (drift-lite
    today) and the persist-hook binding stamp (#488)."""
    expected: dict[str, PageSpec] = {spec.path: spec for spec in top_level}
    for prefix_slug, template in per_source.items():
        for spec in expand_template(prefix_slug, template):
            expected[spec.path] = spec
    return expected


def template_binding_for(
    page_path: str, expected: dict[str, PageSpec]
) -> tuple[str, str] | None:
    """`(scope, template_path)` for `page_path` if it is a page the live
    template config currently expects, else None (not a templated page —
    e.g. a user-added page, or a per-source subpage the agent created that
    isn't part of the seed template). `template_path` is scope-relative:
    the top-level path unchanged, or the per-source path with the
    `<prefix>/<slug>/` stripped."""
    if page_path not in expected:
        return None
    if page_path in {p.path for p in default_pages()}:
        return SCOPE_TOP_LEVEL, page_path
    for prefix, scope in SOURCE_PREFIX_SCOPE.items():
        marker = f"{prefix}/"
        if not page_path.startswith(marker):
            continue
        rest = page_path[len(marker) :]
        _, _, template_path = rest.partition("/")
        if template_path:
            return scope, template_path
    return None


# Seed body for hidden memory pages. Static: not LLM-generated. The agent
# can append to it on subsequent ingests / chats to accumulate cross-ingest
# context the user shouldn't see in the wiki.
MEMORY_SEED = """# Memory

_Agent-only notes. Hidden from the wiki by default. Toggle via the eye icon at the bottom of the sidebar to see / edit. The agent reads this on every ingest and may append observations it wants to remember._

## Notes
- _(none yet — populated as the agent works)_
"""

# Pages that surface as their own UI element (rendered above the wiki, not in
# the sidebar tree). The sidebar tree should filter these out.
SURFACE_PATHS: frozenset[str] = frozenset({"standup.md"})

REQUIRED_PATHS: frozenset[str] = frozenset(p.path for p in DEFAULT_PAGES)
SPEC_BY_PATH: dict[str, PageSpec] = {p.path: p for p in DEFAULT_PAGES}

EMPTY_PAGE_PLACEHOLDER = "_(no content yet)_"

# ---------------------------------------------------------------------------
# Frontmatter field registry — single source of truth for field names.
#
# Standard fields appear on every page (written by page_with_frontmatter /
# read by parse_frontmatter). Source-specific extras appear only on
# per-source pages written by the ingest agent at runtime.
# ---------------------------------------------------------------------------

# Standard fields
FM_TITLE = "title"
FM_KIND = "kind"
FM_ORDER = "order"

# Template binding (#488) — which template page (if any) this page was seeded
# from, and at what version. Code-stamped only (`stamp_template_binding`,
# called from the persist hook), never agent-authored: same reasoning as
# `_verbatim_page_frontmatter` — structural/versioning metadata needs to be
# ground truth for #507's drift detection to mean anything, not an LLM's
# approximation of what it wrote. `template_scope: null` (explicit, not
# absent) marks a page intentionally outside the template flow.
FM_TEMPLATE_SCOPE = "template_scope"
FM_TEMPLATE_PATH = "template_path"
FM_TEMPLATE_VERSION = "template_version"

# `type` marks a structured entry whose body is preceded by typed frontmatter
# the UI renders as a form (e.g. glossary terms). Distinct from `kind` (the page
# lifecycle: stable/dynamic/hidden/report).
FM_TYPE = "type"

# Glossary term entries (type: glossary) — see GLOSSARY_* below
FM_TERM = "term"
FM_EXPANSION = "expansion"
FM_SCOPE = "scope"
FM_ALIASES = "aliases"
FM_TERM_KIND = "term_kind"
FM_STATUS = "status"

# Webex meeting pages
FM_MEETING_ID = "meeting_id"
FM_DATE = "date"

# Confluence source pages
FM_CONFLUENCE_PAGE_ID = "confluence_page_id"
FM_SPACE_KEY = "space_key"

# Per-source frontmatter shapes — used to generate agent prompt instructions
# and as documentation of what fields each page type carries.
WEBEX_MEETING_FRONTMATTER: dict[str, str] = {
    FM_KIND: "dynamic",
    FM_TITLE: "<Meeting Title>",
    FM_MEETING_ID: "<id>",
    FM_DATE: "<YYYY-MM-DD>",
}

CONFLUENCE_PAGE_FRONTMATTER: dict[str, str] = {
    FM_KIND: "dynamic",
    FM_TITLE: "<Page Title>",
    FM_CONFLUENCE_PAGE_ID: "<page_id>",
    FM_SPACE_KEY: "<space key>",
}


# ---------------------------------------------------------------------------
# Glossary — a project-level collection of term entries, one file per term at
# `glossary/<slug>.md`. Each entry carries `type: glossary` + typed frontmatter
# so the UI renders a structured editor (dropdowns) above the prose body.
#
# One file per entry with typed frontmatter; other structured entry types can
# reuse the same shape with a different `type`.
#
# Glossary lives at the PROJECT level only — there is no per-repo glossary. The
# `scope` field carries the cross-cutting meaning (org-wide vs this project vs a
# BHAG/swimlane), independent of where the file physically sits.
# ---------------------------------------------------------------------------

GLOSSARY_DIR = "glossary"
GLOSSARY_TYPE = "glossary"

# Controlled vocabularies (permissive — unknown values are tolerated, the UI
# just falls back to the first option). Keep in sync with ui/src/lib/tome/schema.ts.
GLOSSARY_SCOPES: tuple[str, ...] = ("org", "project", "bhag", "swimlane")
GLOSSARY_TERM_KINDS: tuple[str, ...] = ("acronym", "term")
GLOSSARY_STATUSES: tuple[str, ...] = ("current", "deprecated")

# Permissive floor: a glossary entry is valid with only `type` + `term`. The
# rest are recommended. `kind: dynamic` keeps the agent maintaining the entry on
# ingest; a steward flips it to `stable` to pin curated wording.
GLOSSARY_TERM_FRONTMATTER: dict[str, str] = {
    FM_TYPE: GLOSSARY_TYPE,
    FM_TITLE: "<Term>",
    FM_KIND: "dynamic",
    FM_TERM: "<Term>",
    FM_EXPANSION: "<full expansion if an acronym; omit otherwise>",
    FM_SCOPE: "project",
    FM_ALIASES: "[alias1, alias2]",
    FM_TERM_KIND: "acronym | term",
    FM_STATUS: "current",
}


def glossary_term_path(slug: str) -> str:
    """Path for a glossary term file given its slug, e.g. `tome` → `glossary/tome.md`."""
    return f"{GLOSSARY_DIR}/{slug}.md"


def glossary_slug(term: str) -> str:
    """Derive a filename slug from a term: lowercase, non-alphanumerics → `-`."""
    s = re.sub(r"[^a-z0-9]+", "-", term.strip().lower()).strip("-")
    return s or "term"


# ---------------------------------------------------------------------------
# Edges — cross-project (or in-project) relationships as first-class,
# evidenced documents. Same one-file-per-entry primitive as the glossary
# above: one file per edge at `edges/<slug>.md`, `type: edge` + typed
# frontmatter, prose body. Keep in sync with ui/src/lib/tome/schema.ts (EDGE_*).
#
# Storage decision (option A): an edge is authored into its SOURCE
# project's `edges/` dir. The target project sees it via the backlink index
# (ui/src/lib/tome/edges-index.ts) built from writes to `edges/*.md` across
# all projects, keyed by the edge's resolved target project — not a copy in
# the target's own tree.
# ---------------------------------------------------------------------------

EDGES_DIR = "edges"
EDGE_TYPE = "edge"

FM_RELATION = "relation"
FM_SOURCE = "source"
FM_TARGET = "target"
FM_CONFIDENCE = "confidence"
FM_EVIDENCE = "evidence"
# FM_STATUS (above) is reused; EDGE_STATUSES is the vocabulary that applies
# when the entry's `type` is "edge" (distinct from the glossary's).

EDGE_RELATIONS: tuple[str, ...] = (
    "blocks",
    "depends-on",
    "supersedes",
    "duplicates",
    "contradicts",
    "relates-to",
)
EDGE_CONFIDENCES: tuple[str, ...] = ("high", "medium", "low")
EDGE_STATUSES: tuple[str, ...] = ("active", "resolved", "stale")

# Permissive floor: an edge is valid with only `type` + `relation` + `source` +
# `target`. `confidence`/`evidence`/`status` are recommended, not required.
EDGE_FRONTMATTER: dict[str, str] = {
    FM_TYPE: EDGE_TYPE,
    FM_TITLE: "<short label, e.g. X pivot blocks Y Q3>",
    FM_KIND: "dynamic",
    FM_RELATION: "blocks | depends-on | supersedes | duplicates | contradicts | relates-to",
    FM_SOURCE: "tome://<path> or tome://@<project>/<path>",
    FM_TARGET: "tome://@<project>/<path>",
    FM_CONFIDENCE: "high | medium | low",
    FM_EVIDENCE: "[tome://<ref>, tome://@<project>/<ref>]",
    FM_STATUS: "active",
}


def edge_path(slug: str) -> str:
    """Path for an edge file given its slug, e.g. `x-pivot-blocks-y-q3` -> `edges/x-pivot-blocks-y-q3.md`."""
    return f"{EDGES_DIR}/{slug}.md"


def edge_slug(label: str) -> str:
    """Derive a filename slug from a short edge label (same rule as glossary_slug)."""
    s = re.sub(r"[^a-z0-9]+", "-", label.strip().lower()).strip("-")
    return s or "edge"


# ---------------------------------------------------------------------------
# Tracked entities — Issues, Decisions, Suggestions (#157). Same one-file-per-
# entry structured primitive as the glossary and edges: one file per entry
# under `<dir>/<slug>.md` with `type` + `status` frontmatter and a prose body.
# Keep vocabularies in sync with ui/src/lib/tome/schema.ts.
# ---------------------------------------------------------------------------

ISSUES_DIR = "issues"
ISSUE_TYPE = "issue"
ISSUE_STATUSES: tuple[str, ...] = ("open", "in_progress", "resolved")

DECISIONS_DIR = "decisions"
DECISION_TYPE = "decision"
DECISION_STATUSES: tuple[str, ...] = ("proposed", "accepted", "rejected")

SUGGESTIONS_DIR = "suggestions"
SUGGESTION_TYPE = "suggestion"
SUGGESTION_STATUSES: tuple[str, ...] = ("proposed", "accepted", "rejected")

# Shared frontmatter keys for tracked entities (FM_STATUS is reused).
FM_OWNER = "owner"
FM_OPENED = "opened"
FM_CLOSED = "closed"
FM_PRIORITY = "priority"
TRACKED_ENTITY_PRIORITIES: tuple[str, ...] = ("critical", "high", "medium", "low")

# Per-type frontmatter shapes — used to generate agent prompt instructions.
ISSUE_FRONTMATTER: dict[str, str] = {
    FM_TYPE: ISSUE_TYPE,
    FM_TITLE: "<short issue title>",
    FM_KIND: "dynamic",
    FM_STATUS: "open | in_progress | resolved",
    FM_OWNER: "<who owns it, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
    FM_CLOSED: "<YYYY-MM-DD when resolved; omit while active>",
    FM_PRIORITY: "critical | high | medium | low",
    FM_TARGET: "tome://@<project>/overview.md (optional roll-up target)",
}
DECISION_FRONTMATTER: dict[str, str] = {
    FM_TYPE: DECISION_TYPE,
    FM_TITLE: "<short decision title>",
    FM_KIND: "dynamic",
    FM_STATUS: "proposed | accepted | rejected",
    FM_OWNER: "<decision owner, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
    FM_CLOSED: "<YYYY-MM-DD when decided; omit while proposed>",
    FM_PRIORITY: "critical | high | medium | low",
    FM_TARGET: "tome://@<project>/overview.md (optional roll-up target)",
}
SUGGESTION_FRONTMATTER: dict[str, str] = {
    FM_TYPE: SUGGESTION_TYPE,
    FM_TITLE: "<short suggestion title>",
    FM_KIND: "dynamic",
    FM_STATUS: "proposed | accepted | rejected",
    FM_OWNER: "<who raised it, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
    FM_CLOSED: "<YYYY-MM-DD when decided; omit while proposed>",
    FM_PRIORITY: "critical | high | medium | low",
    FM_TARGET: "tome://@<project>/overview.md (optional roll-up target)",
}

_TRACKED_ENTITY_TYPES: frozenset[str] = frozenset(
    {ISSUE_TYPE, DECISION_TYPE, SUGGESTION_TYPE}
)


def is_tracked_entity(fm: dict[str, object]) -> bool:
    """True when a page's frontmatter marks it as a tracked entity."""
    return str(fm.get(FM_TYPE, "")).lower() in _TRACKED_ENTITY_TYPES


def tracked_entity_path(dir_name: str, slug: str) -> str:
    """Path for a tracked-entity file, e.g. `issues/<slug>.md`."""
    return f"{dir_name}/{slug}.md"


def tracked_entity_slug(title: str) -> str:
    """Derive a filename slug from a short entity title (glossary rule)."""
    s = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")
    return s or "entry"


def frontmatter_example(fields: dict[str, str]) -> str:
    """Render a frontmatter shape as a YAML example block for agent prompts."""
    lines = ["---"]
    for key, example in fields.items():
        lines.append(f"{key}: {example}")
    lines.append("---")
    return "\n".join(lines)


# ---------- Default-list helpers (seed-only) ----------
#
# These iterate DEFAULT_PAGES — the *seed* list written on greenfield. They
# are NOT authoritative at runtime: a user can create custom pages and flip
# kinds via the UI, after which the file's YAML frontmatter is the source of
# truth. Code that decides "what to preserve / rewrite on incremental" must
# call `kinds_from_pages(prior_pages)`, not these.


def default_stable_paths() -> list[str]:
    return [p.path for p in DEFAULT_PAGES if p.kind == "stable"]


def default_dynamic_paths() -> list[str]:
    return [p.path for p in DEFAULT_PAGES if p.kind == "dynamic"]


def default_report_paths() -> list[str]:
    return [p.path for p in DEFAULT_PAGES if p.kind == "report"]


def default_hidden_paths() -> list[str]:
    return [p.path for p in DEFAULT_PAGES if p.kind == "hidden"]


# Pages the founding synthesizer is responsible for filling in on greenfield
# (overview / team / architecture): its prompt knows how to derive identity
# content from raw deltas.
FOUNDING_PATHS: tuple[str, ...] = (
    "overview.md",
    "team.md",
    "architecture.md",
)


def validate_pages(pages: dict[str, str]) -> list[str]:
    """Return a list of missing required page paths. Empty list = valid."""
    return sorted(REQUIRED_PATHS - pages.keys())


# ---------- Runtime kind discovery (frontmatter is authoritative) ----------


def kinds_from_pages(pages: dict[str, str]) -> dict[str, PageKind]:
    """Read each page's frontmatter `kind` field; default to 'stable' when
    the page lacks frontmatter or has an unknown kind."""
    out: dict[str, PageKind] = {}
    for path, md in pages.items():
        fm, _ = parse_frontmatter(md)
        raw = str(fm.get("kind") or "").lower()
        if raw in _PAGE_KINDS:
            out[path] = cast(PageKind, raw)
        else:
            out[path] = "stable"
    return out


def paths_with_kind(pages: dict[str, str], kind: PageKind) -> list[str]:
    return [p for p, k in kinds_from_pages(pages).items() if k == kind]


def stable_paths_in(pages: dict[str, str]) -> list[str]:
    """Paths in `pages` whose frontmatter says they're stable (or hidden —
    same preserve-on-incremental semantics). Authoritative for runtime."""
    kinds = kinds_from_pages(pages)
    return [p for p, k in kinds.items() if k in ("stable", "hidden")]


def _kind_from_md(md: str) -> str:
    fm, _ = parse_frontmatter(md)
    return str(fm.get("kind") or "stable").lower()


def deletion_block_reason(path: str, md: str) -> str | None:
    """Why the agent must NOT tombstone `path`, or None if deletion is allowed.

    Protected (structurally undeletable): the founding/template seed pages (the
    wiki's skeleton) and any page whose frontmatter marks it `stable` or
    `hidden`. Allowed: non-founding `dynamic`/`report` pages, per-source subtree
    pages, and collection entries like glossary terms (`glossary/<term>.md`)."""
    if path in {p.path for p in DEFAULT_PAGES}:
        return (
            f"`{path}` is a founding template page — part of the wiki's skeleton. "
            "Rewrite or blank it with Edit instead; it cannot be deleted."
        )
    kind = _kind_from_md(md)
    if kind in ("stable", "hidden"):
        return (
            f"`{path}` is a {kind} page ("
            + ("human-owned" if kind == "stable" else "agent-only working memory")
            + f"). {kind.capitalize()} pages are protected from deletion."
        )
    return None


# ---------- Frontmatter ----------

_FENCE = "---\n"


_BLOCK_LIST_ITEM = re.compile(r"^\s+-\s*(.*)$")


def parse_frontmatter(markdown: str) -> tuple[dict[str, object], str]:
    """Return ({key: value}, body). YAML-lite: top-level scalar `key: value`
    pairs, inline `key: [a, b]` arrays, AND multi-line block-list arrays —
    `key:` followed by `  - item` lines — since agent-authored frontmatter
    (Claude writing plain YAML, not going through `serialize_frontmatter`)
    uses the block-list form for arrays, not the inline bracket form."""
    if not markdown.startswith(_FENCE):
        return {}, markdown
    end = markdown.find(f"\n{_FENCE}", len(_FENCE))
    if end == -1:
        return {}, markdown
    block = markdown[len(_FENCE) : end + 1]  # include trailing newline
    rest = markdown[end + len(_FENCE) + 1 :]
    fm: dict[str, object] = {}
    lines = block.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        if not raw.strip() or raw.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in raw:
            i += 1
            continue
        k, _, v = raw.partition(":")
        k, v = k.strip(), v.strip()
        if not v:
            items: list[str] = []
            j = i + 1
            while j < len(lines):
                m = _BLOCK_LIST_ITEM.match(lines[j])
                if not m:
                    break
                items.append(m.group(1).strip().strip("'\""))
                j += 1
            if items:
                fm[k] = items
                i = j
                continue
        fm[k] = _coerce(v)
        i += 1
    return fm, rest


def serialize_frontmatter(fm: dict[str, object], body: str) -> str:
    if not fm:
        return body
    lines = ["---"]
    for k, v in fm.items():
        lines.append(f"{k}: {_dump(v)}")
    lines.append("---")
    return "\n".join(lines) + "\n" + body.lstrip("\n")


def stamp_template_binding(
    page_path: str, markdown: str, expected: dict[str, PageSpec]
) -> str:
    """Overwrite `template_scope`/`template_path`/`template_version` in
    `markdown`'s frontmatter with the code-computed binding, discarding
    whatever the agent wrote for these three keys (see #488). Call this on
    every page write, right before persisting — never let the agent's own
    output be the source of truth for the binding."""
    fm, body = parse_frontmatter(markdown)
    binding = template_binding_for(page_path, expected)
    if binding is None:
        fm[FM_TEMPLATE_SCOPE] = None
        fm.pop(FM_TEMPLATE_PATH, None)
        fm.pop(FM_TEMPLATE_VERSION, None)
    else:
        scope, template_path = binding
        fm[FM_TEMPLATE_SCOPE] = scope
        fm[FM_TEMPLATE_PATH] = template_path
        fm[FM_TEMPLATE_VERSION] = template_version_for(scope)
    return serialize_frontmatter(fm, body)


def reconcile_template_bindings(
    existing_pages: dict[str, str],
    expected: dict[str, PageSpec],
) -> dict[str, str]:
    """Deterministically stamp `template_scope`/`template_path`/
    `template_version` onto every page that has no `template_scope`
    frontmatter at all yet (#488) — pure, no I/O. Returns only the pages
    that changed, as `{path: new_markdown}`.

    This exists because the persist hook only stamps a page when the agent
    actually calls Edit/Write on it this run — reactive, not deterministic.
    A page the agent decides needs no content change never gets touched, so
    it would sit unbound indefinitely even though the binding is meant to
    be code-owned end-to-end, the same way `.tome/pages/*.md` mirrors are
    written directly by code regardless of what the agent does. Callers
    (the ingest loop, the one-time backfill script) run this unconditionally
    every time, exactly like `write_verbatim_pages`.

    `template_version` is set to 0 (the baseline), not the scope's current
    live version: this function has no way to know whether the page's
    content actually reflects the current template, only that it now has
    *a* binding. Assuming 0 means the next drift check surfaces real
    version-behind/content drift rather than silently hiding it — see
    `scripts/backfill_template_bindings.py`'s docstring for the same
    reasoning applied to the one-time migration."""
    changed: dict[str, str] = {}
    for path, markdown in existing_pages.items():
        fm, body = parse_frontmatter(markdown)
        if FM_TEMPLATE_SCOPE in fm:
            continue
        binding = template_binding_for(path, expected)
        if binding is None:
            fm[FM_TEMPLATE_SCOPE] = None
        else:
            scope, template_path = binding
            fm[FM_TEMPLATE_SCOPE] = scope
            fm[FM_TEMPLATE_PATH] = template_path
            fm[FM_TEMPLATE_VERSION] = 0
        changed[path] = serialize_frontmatter(fm, body)
    return changed


def page_with_frontmatter(spec: PageSpec, body: str) -> str:
    fm: dict[str, object] = {
        "title": spec.title,
        "kind": spec.kind,
        "order": spec.order,
    }
    return serialize_frontmatter(fm, body)


def stable_seed_page(path: str) -> str | None:
    """Full founding markdown (frontmatter + template body) for a stable seed
    page, or None if `path` isn't one. Gives the greenfield agent the exact
    section structure to fill from the charter + sources."""
    spec = SPEC_BY_PATH.get(path)
    body = STABLE_SEED_BODIES.get(path)
    if spec is None or body is None:
        return None
    return page_with_frontmatter(spec, body)


def stable_seed_templates() -> dict[str, str]:
    """`{path: founding markdown}` for every stable seed page. Fed into the
    greenfield prompt so the agent writes the agreed `##` sections."""
    out: dict[str, str] = {}
    for spec in DEFAULT_PAGES:
        page = stable_seed_page(spec.path)
        if page is not None:
            out[spec.path] = page
    return out


def _coerce(v: str) -> object:
    s = v.strip()
    if not s:
        return ""
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1].strip()
        if not inner:
            return []
        return [x.strip().strip("'\"") for x in inner.split(",")]
    if s.lower() in {"true", "false"}:
        return s.lower() == "true"
    if s.lower() == "null":
        return None
    if s.lstrip("-").isdigit():
        return int(s)
    return s.strip("'\"")


def _dump(v: object) -> str:
    if v is None:
        return "null"
    if isinstance(v, list):
        return "[" + ", ".join(str(x) for x in v) + "]"
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


# ---------- Page tree (for sidebar nav) ----------

@dataclass
class PageNode:
    path: str
    title: str
    kind: NodeKind
    order: int
    children: list[PageNode] = field(default_factory=list)


def build_tree(pages: dict[str, str]) -> list[PageNode]:
    """Build a hierarchical tree from `{path: markdown}`. Root pages have no parent.

    `kind: report` pages (e.g. `standup.md`) are excluded — they have their own
    UI surface, not a sidebar entry. `kind: hidden` pages ARE included; the
    frontend chooses whether to render them (cmd-shift-. style toggle).

    When a nested page like `repos/mycelium/overview.md` has no real
    `repos/mycelium.md` parent, this function synthesizes a non-clickable
    `kind: folder` node at `repos/mycelium` so the sidebar still nests it
    properly. Folder nodes have `path` without `.md` to distinguish them
    from real pages — the frontend treats them as headers.
    """
    nodes: dict[str, PageNode] = {}
    for path, md in pages.items():
        fm_kind = _kind_from_md(md)
        if fm_kind == "report":
            continue
        if path in SURFACE_PATHS:
            continue
        fm, _ = parse_frontmatter(md)
        spec = SPEC_BY_PATH.get(path)
        title = str(fm.get("title") or (spec.title if spec else path_to_title(path)))
        raw_kind = fm.get("kind")
        kind: NodeKind = (
            cast(NodeKind, raw_kind)
            if raw_kind in _PAGE_KINDS
            else (spec.kind if spec else "stable")
        )
        raw_order = fm.get("order")
        order = raw_order if isinstance(raw_order, int) else (spec.order if spec else 999)
        nodes[path] = PageNode(path=path, title=title, kind=kind, order=order)

    # First pass: synthesize folder nodes for any nested page whose ancestor
    # `<dir>.md` doesn't exist as a real page. Walk every dir component in
    # every nested page's path; ensure each missing ancestor has a folder node.
    folders: dict[str, PageNode] = {}
    for path in list(nodes.keys()):
        if "/" not in path:
            continue
        parts = path.split("/")[:-1]  # drop the leaf .md
        for i in range(1, len(parts) + 1):
            dir_path = "/".join(parts[:i])
            page_anchor = f"{dir_path}.md"
            if page_anchor in nodes or dir_path in folders:
                continue
            # Structured-entry directories (glossary, edges) sort above
            # per-source connector folders (repos/webex/confluence/etc.) --
            # vocabulary and relationships are cross-cutting reference
            # material, not one more source among sources.
            folder_order = 900 if dir_path in (GLOSSARY_DIR, EDGES_DIR) else 999
            folders[dir_path] = PageNode(
                path=dir_path,
                title=path_to_title(dir_path),
                kind="folder",
                order=folder_order,
            )

    roots: list[PageNode] = []
    all_nodes: dict[str, PageNode] = {**nodes, **folders}

    for path, node in sorted(
        all_nodes.items(), key=lambda kv: (_depth_for_node(kv[0]), all_nodes[kv[0]].order, kv[0])
    ):
        parent = _resolve_parent(path, all_nodes)
        if parent is not None:
            parent.children.append(node)
        else:
            roots.append(node)

    # Folders (synthesized connector-group headers, e.g. `repos/`, `glossary/`)
    # always sort after real pages regardless of `order` -- they have no
    # meaningful order of their own (every folder ties at 999) and would
    # otherwise interleave with untemplated pages via alphabetical tie-break.
    def _sort(node_list: list[PageNode]) -> None:
        node_list.sort(key=lambda n: (1 if n.kind == "folder" else 0, n.order, n.path))
        for n in node_list:
            _sort(n.children)
    _sort(roots)
    return roots


def _resolve_parent(path: str, all_nodes: dict[str, PageNode]) -> PageNode | None:
    """Walk up the path looking for the nearest existing parent — either a
    real `<dir>.md` page or a synthesized folder at `<dir>`."""
    if "/" not in path:
        return None
    leaf = path.rsplit("/", 1)[0]
    page_parent = f"{leaf}.md"
    if page_parent in all_nodes:
        return all_nodes[page_parent]
    if leaf in all_nodes:
        return all_nodes[leaf]
    return None


def _depth_for_node(path: str) -> int:
    """Sort key — folder paths (no `.md`) and page paths share depth by slash count."""
    return path.count("/")


def path_to_title(path: str) -> str:
    leaf = path.rsplit("/", 1)[-1].removesuffix(".md")
    return leaf.replace("-", " ").replace("_", " ").title()
