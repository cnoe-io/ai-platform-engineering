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
# `charter.md` / `objectives.md` / `roadmap.md` seed as `kind=stable`: the
# agent drafts them once at founding (from the charter field + sources), then
# the autonomous ingest loop only preserves them — only human-directed edits
# (Crepe or chat) change them thereafter.
# Unfilled sections render as "answer this" cards in the UI, so seeding them
# for every project costs nothing when a team hasn't filled them in yet.
DEFAULT_PAGES: tuple[PageSpec, ...] = (
    PageSpec("standup.md",        "report",  "The Standup",   -10),
    # 5 stable — human-curated beliefs & commitments.
    PageSpec("charter.md",        "stable",  "Charter",        -5),
    PageSpec("objectives.md",     "stable",  "Objectives",     -4),
    PageSpec("roadmap.md",        "stable",  "Roadmap",        -3),
    PageSpec("commitments.md",    "stable",  "Commitments",    -2),
    PageSpec("agreements.md",     "stable",  "Agreements",     -1),
    # 9 dynamic flat pages (glossary is a directory, agent-maintained per term).
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("status.md",         "dynamic", "Status",         10),
    PageSpec("activity.md",       "dynamic", "Activity",       20),
    PageSpec("architecture.md",   "dynamic", "Architecture",   30),
    PageSpec("discovery.md",      "dynamic", "Discovery",      40),
    PageSpec("design.md",         "dynamic", "Design",         50),
    PageSpec("market.md",         "dynamic", "Market",         60),
    PageSpec("campaigns.md",      "dynamic", "Campaigns",      70),
    PageSpec("actions.md",        "dynamic", "Actions",        80),
    PageSpec("memory.md",         "hidden",  "Memory",        100),
)


# Founding templates for the stable pages. The greenfield agent fills these
# from the charter field + sources where it can, and leaves genuinely
# human-only sections as the prompt text (the frontend renders an empty
# section as an "answer this" card; humans own the page after founding).
# The `##` section headers are the contract the structured surfaces and the
# ingest prompt both rely on — keep them in sync.
_CHARTER_BODY = """## What we're building
_One or two sentences: what this is, and who it's for._

## Why it matters
_Why this is worth doing — and why now._

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
"""

_OBJECTIVES_BODY = """## North-star metric
_The single number that best captures progress — what it is, and why it's the one that matters._

## Objectives
_What we're driving toward, and how we'll measure it._

| Objective | Metric | Target | Timeframe |
| --- | --- | --- | --- |
|  |  |  |  |

## How this ladders to org OKRs
_Which org-level OKR(s) these advance, and how._
"""

_ROADMAP_BODY = """## Now
_What we're actively building this horizon._

## Next
_Near-term bets, roughly in priority order. Themes, not dates._

## Later
_Directions we believe in but aren't committing to yet._

## Explicitly deprioritized
_What we chose not to do — and what would make us revisit._

| What | Why deprioritized | Revisit when |
| --- | --- | --- |
|  |  |  |
"""

_COMMITMENTS_BODY = """## What we've promised
_What was promised, to whom, by when, and who owns it. The commitments this effort is accountable to._

| Commitment | To whom | By when | Owner | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |
"""

_AGREEMENTS_BODY = """## How we work
_Decision rights, cadences, and the definition of done. The operating agreements the team holds each other to._

## Decision rights
_Who decides what, and who is consulted or informed._

## Cadences
_Standing rhythms: standups, reviews, planning, retros._

## Definition of done
_What "done" means here, so nothing ships half-finished._
"""

STABLE_SEED_BODIES: dict[str, str] = {
    "charter.md": _CHARTER_BODY,
    "objectives.md": _OBJECTIVES_BODY,
    "roadmap.md": _ROADMAP_BODY,
    "commitments.md": _COMMITMENTS_BODY,
    "agreements.md": _AGREEMENTS_BODY,
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


def set_template_overrides(by_scope: dict[str, list[dict[str, Any]]] | None) -> None:
    """Install per-run template config fetched from the backend. Silently keeps
    the hardcoded fallback for any scope that is absent or fails to parse."""
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


def expand_template(prefix: str, template: tuple[PageSpec, ...]) -> tuple[PageSpec, ...]:
    """Materialize a per-source template under `<prefix>/`. Used to build the
    full page enumeration shown to the ingest agent."""
    return tuple(
        replace(spec, path=f"{prefix}/{spec.path}") for spec in template
    )


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
# Doc/storage surface only; the MCP lifecycle tools land in a follow-up. Keep
# vocabularies in sync with ui/src/lib/tome/schema.ts.
# ---------------------------------------------------------------------------

ISSUES_DIR = "issues"
ISSUE_TYPE = "issue"
ISSUE_STATUSES: tuple[str, ...] = ("open", "resolved")

DECISIONS_DIR = "decisions"
DECISION_TYPE = "decision"
DECISION_STATUSES: tuple[str, ...] = ("proposed", "accepted", "rejected")

SUGGESTIONS_DIR = "suggestions"
SUGGESTION_TYPE = "suggestion"
SUGGESTION_STATUSES: tuple[str, ...] = ("proposed", "accepted", "rejected")

# Shared frontmatter keys for tracked entities (FM_STATUS is reused).
FM_OWNER = "owner"
FM_OPENED = "opened"

# Per-type frontmatter shapes — used to generate agent prompt instructions.
ISSUE_FRONTMATTER: dict[str, str] = {
    FM_TYPE: ISSUE_TYPE,
    FM_TITLE: "<short issue title>",
    FM_KIND: "dynamic",
    FM_STATUS: "open | resolved",
    FM_OWNER: "<who owns it, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
}
DECISION_FRONTMATTER: dict[str, str] = {
    FM_TYPE: DECISION_TYPE,
    FM_TITLE: "<short decision title>",
    FM_KIND: "dynamic",
    FM_STATUS: "proposed | accepted | rejected",
    FM_OWNER: "<decision owner, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
}
SUGGESTION_FRONTMATTER: dict[str, str] = {
    FM_TYPE: SUGGESTION_TYPE,
    FM_TITLE: "<short suggestion title>",
    FM_KIND: "dynamic",
    FM_STATUS: "proposed | accepted | rejected",
    FM_OWNER: "<who raised it, if known>",
    FM_OPENED: "<YYYY-MM-DD>",
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
# (overview / team / architecture). These were the original
# "stable" set; they're now kind=dynamic by default but the static path's
# greenfield still routes them through the founding synthesizer because that
# prompt knows how to derive identity content from raw deltas.
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
    if s.lstrip("-").isdigit():
        return int(s)
    return s.strip("'\"")


def _dump(v: object) -> str:
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
    children: list["PageNode"] = field(default_factory=list)


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
        title = str(fm.get("title") or (spec.title if spec else _path_to_title(path)))
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
            folders[dir_path] = PageNode(
                path=dir_path,
                title=_path_to_title(dir_path),
                kind="folder",
                order=999,
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

    def _sort(node_list: list[PageNode]) -> None:
        node_list.sort(key=lambda n: (n.order, n.path))
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


def _path_to_title(path: str) -> str:
    leaf = path.rsplit("/", 1)[-1].removesuffix(".md")
    return leaf.replace("-", " ").replace("_", " ").title()
