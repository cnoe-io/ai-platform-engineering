"""Wiki page schema + frontmatter helpers.

A report version is a tree of markdown pages, addressable by path under
`<project_id>/`. Each page declares its `kind` (stable | dynamic) in YAML
frontmatter. Stable pages are agent-drafted once at founding, then human-owned
— the autonomous ingest loop only preserves them; humans edit them directly or
via chat. Dynamic pages are agent-rewritten every ingest, grounded by the
stable pages.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, cast, get_args

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
    grounded_by: tuple[str, ...] = field(default_factory=tuple)


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
# (Crepe or chat) change them thereafter. Dynamic pages are grounded by them.
# Unfilled sections render as "answer this" cards in the UI, so seeding them
# for every project costs nothing when a team hasn't filled them in yet.
DEFAULT_PAGES: tuple[PageSpec, ...] = (
    PageSpec("standup.md",        "report",  "The Standup",   -10, ("overview.md",)),
    PageSpec("charter.md",        "stable",  "Charter",        -5),
    PageSpec("objectives.md",     "stable",  "Objectives",     -4, ("charter.md",)),
    PageSpec("roadmap.md",        "stable",  "Roadmap",        -3, ("charter.md",)),
    PageSpec("overview.md",       "dynamic", "Overview",        0, ("charter.md",)),
    PageSpec("architecture.md",   "dynamic", "Architecture",   20, ("charter.md",)),
    PageSpec("marketing.md",      "dynamic", "Marketing",      30, ("charter.md",)),
    PageSpec("conversations.md",  "dynamic", "Conversations",  40, ("overview.md",)),
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

STABLE_SEED_BODIES: dict[str, str] = {
    "charter.md": _CHARTER_BODY,
    "objectives.md": _OBJECTIVES_BODY,
    "roadmap.md": _ROADMAP_BODY,
}


# Per-source page templates. Materialized into actual page paths by the
# ingest agent — e.g. for a Repo with slug `mycelium`, REPO_TEMPLATE expands
# into pages at `repos/mycelium/overview.md`, `repos/mycelium/team.md`, etc.
#
# Templates are intentionally minimal at first; we'll grow them once we have
# a feel for what's useful per-source.

REPO_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("team.md",           "dynamic", "Team",           10),
    PageSpec("architecture.md",   "dynamic", "Architecture",   30),
    PageSpec("status.md",         "dynamic", "Status",         40),
    PageSpec("activity.md",       "dynamic", "Activity",       50),
    PageSpec("conversations.md",  "dynamic", "Conversations",  60),
)

WEBEX_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("activity.md",       "dynamic", "Activity",       10),
)

CONFLUENCE_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
)


def expand_template(prefix: str, template: tuple[PageSpec, ...]) -> tuple[PageSpec, ...]:
    """Materialize a per-source template under `<prefix>/`. Used to build the
    full page enumeration shown to the ingest agent."""
    return tuple(
        PageSpec(
            path=f"{prefix}/{spec.path}",
            kind=spec.kind,
            title=spec.title,
            order=spec.order,
            grounded_by=spec.grounded_by,
        )
        for spec in template
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
FM_GROUNDED_BY = "grounded_by"

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


# ---------- Frontmatter ----------

_FENCE = "---\n"


def parse_frontmatter(markdown: str) -> tuple[dict[str, object], str]:
    """Return ({key: value}, body). YAML-lite: only top-level scalar key:value pairs."""
    if not markdown.startswith(_FENCE):
        return {}, markdown
    end = markdown.find(f"\n{_FENCE}", len(_FENCE))
    if end == -1:
        return {}, markdown
    block = markdown[len(_FENCE) : end + 1]  # include trailing newline
    rest = markdown[end + len(_FENCE) + 1 :]
    fm: dict[str, object] = {}
    for raw in block.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if ":" not in raw:
            continue
        k, _, v = raw.partition(":")
        fm[k.strip()] = _coerce(v.strip())
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
    if spec.grounded_by:
        fm["grounded_by"] = list(spec.grounded_by)
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
