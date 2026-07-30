"""In-process MCP server exposing Confluence to the agents.

Implemented on the Confluence **v1** REST API (`/wiki/rest/api/...`), driven by
CQL. The v2 API (`/wiki/api/v2`) requires *granular* OAuth scopes
(`read:space:confluence`, `read:page:confluence`, …); CAIPE's Atlassian
connections are granted *classic* scopes (`read:confluence-content.all`,
`read:confluence-space.summary`, `search:confluence`), under which every v2
call 401s. v1 CQL search works under those scopes — and, crucially, supports
`ORDER BY lastmodified DESC`, so the ingest agent can prioritize recently
edited pages instead of an arbitrary order.

Note: some v1 endpoints are gone (HTTP 410 — e.g. `/rest/api/space` and
`GET /rest/api/content/{id}`). We therefore route everything through
`/rest/api/search` (CQL), which is still live: page listing via a space+type
query ordered by recency, and page bodies via `cql=id=<id>` with
`expand=content.body.storage`.

Tools returned by `build_confluence_mcp(token, cloud_id)`:
  confluence_list_spaces()
  confluence_get_pages(space_key, limit?)   — newest-edited first
  confluence_get_page_tree(page_id)         — compact root + all descendants
  confluence_get_page_content(page_id)
"""

from __future__ import annotations

import asyncio
import json
from html.parser import HTMLParser
from typing import Any, ClassVar
from urllib.parse import parse_qsl, urlsplit

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool

_TREE_PAGE_LIMIT = 500
_TREE_CONTENT_BUDGET_CHARS = 32_000
_TREE_MAX_BODY_CHARS_PER_PAGE = 4_000
_TREE_RESULT_FIELDS = (
    "id",
    "title",
    "parent_id",
    "depth",
    "last_modified",
    "body",
    "body_truncated",
)


class _StorageTextExtractor(HTMLParser):
    """Small dependency-free Confluence storage-format text extractor."""

    _BLOCK_TAGS: ClassVar[frozenset[str]] = frozenset(
        {
            "br",
            "div",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "li",
            "p",
            "table",
            "td",
            "th",
            "tr",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _storage_to_text(storage: str) -> str:
    """Convert storage XHTML into compact readable text for model context."""
    if not storage:
        return ""
    parser = _StorageTextExtractor()
    try:
        parser.feed(storage)
        parser.close()
    except (AssertionError, ValueError):
        return " ".join(storage.split())
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    return "\n".join(line for line in lines if line)


def _search_page_params(
    *,
    cql: str,
    expand: str,
    limit: int,
    next_link: str | None = None,
) -> dict[str, Any]:
    """Follow Confluence's returned cursor URL without rebuilding pagination."""
    params = dict(parse_qsl(urlsplit(next_link).query)) if next_link else {}
    params.setdefault("cql", cql)
    params.setdefault("expand", expand)
    params.setdefault("limit", limit)
    return params


def _bound_tree_page_bodies(
    pages: list[dict[str, Any]],
    *,
    total_budget: int = _TREE_CONTENT_BUDGET_CHARS,
    per_page_limit: int = _TREE_MAX_BODY_CHARS_PER_PAGE,
) -> tuple[int, int]:
    """Bound a tree result while preserving content from every page.

    An unbounded subtree can overflow the ingest model's context and cause the
    entire source read to be discarded. Divide one fixed character budget
    fairly across all returned pages and mark partial bodies explicitly.
    Returns `(included_chars, truncated_page_count)` for result metadata.
    """
    if not pages:
        return 0, 0
    fair_share = max(1, total_budget // len(pages))
    body_limit = min(per_page_limit, fair_share)
    included_chars = 0
    truncated_pages = 0
    for page in pages:
        body = page.get("body")
        if not isinstance(body, str):
            body = ""
        if len(body) > body_limit:
            page["body"] = body[:body_limit]
            page["body_truncated"] = True
            truncated_pages += 1
        else:
            page["body"] = body
            page["body_truncated"] = False
        included_chars += len(page["body"])
    return included_chars, truncated_pages


def _ok(payload: Any, *, compact: bool = False) -> dict[str, Any]:
    text = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if compact
        else json.dumps(payload, indent=2)
    )
    return {"content": [{"type": "text", "text": text}]}


def _tree_result(
    *,
    space_key: str,
    root_page_id: str,
    pages: list[dict[str, Any]],
    tree_truncated: bool,
    site_url: str = "",
) -> dict[str, Any]:
    """Return the complete tree in one compact, bounded result.

    The model proved unreliable at following a continuation cursor even when
    the prompt called it mandatory. A columnar row representation removes
    repeated JSON keys, keeping all pages in one inline tool result so no
    model-controlled pagination step can drop the remainder of the tree.
    """
    compact_pages = [dict(page) for page in pages]
    included_chars, truncated_pages = _bound_tree_page_bodies(compact_pages)
    rows = [
        [page.get(field) for field in _TREE_RESULT_FIELDS] for page in compact_pages
    ]
    return _ok(
        {
            "space_key": space_key,
            "root_page_id": root_page_id,
            "page_fields": list(_TREE_RESULT_FIELDS),
            "pages": rows,
            "total_pages": len(pages),
            "tree_truncated": tree_truncated,
            "content_included": True,
            "body_format": "plain_text_excerpt",
            "page_url_template": (
                f"{site_url.rstrip('/')}/wiki/pages/{{id}}" if site_url else None
            ),
            "content_budget_chars": _TREE_CONTENT_BUDGET_CHARS,
            "included_body_chars": included_chars,
            "body_truncated_pages": truncated_pages,
        },
        compact=True,
    )


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_confluence_mcp(
    token: str = "",
    cloud_id: str = "",
    site_url: str = "",
    allowed_space_keys: list[str] | None = None,
    page_scoped_space_keys: list[str] | None = None,
    selected_root_page_ids: list[str] | None = None,
):
    """Create the MCP server for Confluence API calls (v1 / CQL).

    `site_url` is the Confluence site origin (e.g. `https://cisco-eti.atlassian.net`).
    When provided, page results include a `url` field for citation links.

    `allowed_space_keys` is the project's attached-space allowlist. Space-scoped
    tools refuse any space outside it (mirrors the GitHub MCP's repo allowlist),
    so the agent can only read the spaces this project declares — not every
    space the user's token can reach. Comparison is case-insensitive (Confluence
    keys are conventionally upper-case but referenced inconsistently).
    """

    base_url = f"https://api.atlassian.com/ex/confluence/{cloud_id}/wiki/rest/api"
    _site_url = site_url.rstrip("/") if site_url else ""
    _allowed = {k.upper() for k in (allowed_space_keys or []) if k}
    _page_scoped = {k.upper() for k in (page_scoped_space_keys or []) if k}
    _selected_roots = {
        str(page_id) for page_id in (selected_root_page_ids or []) if page_id
    }
    _discovered_page_ids = set(_selected_roots)

    def _in_scope(space_key: str) -> bool:
        return bool(space_key) and space_key.upper() in _allowed

    def _headers() -> dict[str, str]:
        h = {"Accept": "application/json", "User-Agent": "ttt-ingest-agent"}
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.get(f"{base_url}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    def _cql_quote(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    @tool(
        "confluence_list_spaces",
        "List Confluence spaces accessible to the connected account. Returns "
        "key, name, and type for each space. Use a space's `key` with "
        "confluence_get_pages.",
        {},
    )
    async def list_spaces(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        try:
            data = await _get("/search", {"cql": "type=space", "limit": 100})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = []
        for r in data.get("results") or []:
            sp = r.get("space") or {}
            key = sp.get("key")
            if not key:
                continue
            # Scope: only surface spaces attached to this project.
            if not _in_scope(key):
                continue
            out.append(
                {
                    "key": key,
                    "name": sp.get("name") or r.get("title"),
                    "type": sp.get("type"),
                }
            )
        return _ok(out)

    @tool(
        "confluence_get_pages",
        "List pages in a Confluence space, MOST RECENTLY EDITED FIRST. "
        "`space_key` is required (e.g. 'ENG'). Returns id, title, and "
        "last_modified (ISO 8601) for each page so you can focus on what "
        "changed recently. Optional `limit` (default 25).",
        {"space_key": str, "limit": int},
    )
    async def get_pages(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        space_key = (args.get("space_key") or "").strip()
        if not space_key:
            return _err("space_key is required")
        if not _in_scope(space_key):
            return _err(
                f"space {space_key!r} is not attached to this project. "
                f"Only this project's spaces are in scope."
            )
        if space_key.upper() in _page_scoped:
            return _err(
                f"space {space_key!r} has selected page roots. Generic space "
                "listing is disabled for this project; use "
                "confluence_get_page_tree for each selected root."
            )
        limit = args.get("limit") or 25
        cql = (
            f'space="{_cql_quote(space_key)}" and type=page order by lastmodified desc'
        )
        try:
            data = await _get("/search", {"cql": cql, "limit": limit})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = []
        for r in data.get("results") or []:
            content = r.get("content") or {}
            page_id = content.get("id")
            entry: dict[str, Any] = {
                "id": page_id,
                "title": r.get("title") or content.get("title"),
                "last_modified": r.get("lastModified"),
                "friendly_last_modified": r.get("friendlyLastModified"),
            }
            if page_id and _site_url:
                entry["url"] = f"{_site_url}/wiki/pages/{page_id}"
            out.append(entry)
        return _ok(out)

    @tool(
        "confluence_get_page_tree",
        "Return a selected Confluence page and all descendants in one compact "
        "result. `page_fields` names the columns in every `pages` row. The "
        "result includes a bounded body excerpt for every page, so no "
        "continuation call is needed. `page_id` is the selected root page.",
        {"page_id": str},
    )
    async def get_page_tree(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        page_id = (args.get("page_id") or "").strip()
        if not page_id or not page_id.isdigit():
            return _err("page_id is required and must be numeric")
        if _selected_roots and page_id not in _selected_roots:
            return _err(
                f"page {page_id!r} is not one of this project's selected "
                "Confluence page roots."
            )
        limit = _TREE_PAGE_LIMIT

        try:
            root_data = await _get(
                "/search",
                {
                    "cql": f"id={page_id}",
                    "expand": (
                        "content.space,content.ancestors,content.body.storage,"
                        "content.version,content.history.lastUpdated"
                    ),
                    "limit": 1,
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(
                f"HTTP {e.response.status_code} fetching page tree root: "
                f"{e.response.text[:200]}"
            )
        root_results = root_data.get("results") or []
        if not root_results:
            return _err(f"page {page_id} not found or not accessible")
        root_result = root_results[0]
        root_content = root_result.get("content") or {}
        root_id = str(root_content.get("id") or page_id)
        root_space = (
            (root_content.get("space") or {}).get("key")
            or (root_result.get("space") or {}).get("key")
            or ""
        )
        if not _in_scope(root_space):
            return _err(
                f"page {page_id!r} belongs to space {root_space!r}, not attached "
                "to this project; out of scope."
            )

        root: dict[str, Any] = {
            "id": root_id,
            "title": root_content.get("title") or root_result.get("title"),
            "parent_id": None,
            "depth": 0,
            "body": _storage_to_text(
                (root_content.get("body") or {}).get("storage", {}).get("value", "")
            ),
            "last_modified": (
                root_result.get("lastModified")
                or (root_content.get("version") or {}).get("when")
                or ((root_content.get("history") or {}).get("lastUpdated") or {}).get(
                    "when"
                )
            ),
        }
        if _site_url:
            root["url"] = f"{_site_url}/wiki/pages/{root_id}"

        descendants: list[dict[str, Any]] = []
        seen_page_ids: set[str] = set()
        seen_next_links: set[str] = set()
        next_link: str | None = None
        tree_truncated = False
        # Confluence caps expanded CQL results at 50 and now paginates search
        # with an opaque cursor. Follow `_links.next`; constructing numeric
        # `start` offsets can repeatedly return the first page of results.
        page_size = min(50, limit)
        while len(descendants) < limit:
            try:
                data = await _get(
                    "/search",
                    _search_page_params(
                        cql=f"ancestor={root_id} and type=page",
                        expand=(
                            "content.space,content.ancestors,content.body.storage,"
                            "content.version,content.history.lastUpdated"
                        ),
                        limit=min(page_size, limit - len(descendants)),
                        next_link=next_link,
                    ),
                )
            except httpx.HTTPStatusError as e:
                return _err(
                    f"HTTP {e.response.status_code} fetching descendants: "
                    f"{e.response.text[:200]}"
                )
            batch = data.get("results") or []
            for result in batch:
                content = result.get("content") or {}
                child_id = str(content.get("id") or "")
                child_space = (
                    (content.get("space") or {}).get("key")
                    or (result.get("space") or {}).get("key")
                    or ""
                )
                if (
                    not child_id
                    or child_id in seen_page_ids
                    or child_space.upper() != root_space.upper()
                ):
                    continue
                ancestors = content.get("ancestors") or []
                root_index = next(
                    (
                        index
                        for index, ancestor in enumerate(ancestors)
                        if str(ancestor.get("id") or "") == root_id
                    ),
                    -1,
                )
                if root_index < 0:
                    continue
                seen_page_ids.add(child_id)
                parent_id = next(
                    (
                        str(ancestor.get("id"))
                        for ancestor in reversed(ancestors)
                        if ancestor.get("id")
                    ),
                    root_id,
                )
                child: dict[str, Any] = {
                    "id": child_id,
                    "title": content.get("title") or result.get("title"),
                    "parent_id": parent_id,
                    "depth": len(ancestors) - root_index,
                    "body": _storage_to_text(
                        (content.get("body") or {}).get("storage", {}).get("value", "")
                    ),
                    "last_modified": (
                        result.get("lastModified")
                        or (content.get("version") or {}).get("when")
                        or (
                            (content.get("history") or {}).get("lastUpdated") or {}
                        ).get("when")
                    ),
                }
                if _site_url:
                    child["url"] = f"{_site_url}/wiki/pages/{child_id}"
                descendants.append(child)
                if len(descendants) >= limit:
                    break

            returned_next = (data.get("_links") or {}).get("next")
            if not returned_next:
                next_link = None
                break
            if returned_next in seen_next_links:
                tree_truncated = True
                next_link = None
                break
            seen_next_links.add(returned_next)
            next_link = returned_next
            if len(descendants) >= limit:
                tree_truncated = True

        known_ids = {root_id, *(page["id"] for page in descendants)}
        children_by_parent: dict[str, list[dict[str, Any]]] = {}
        for page in descendants:
            parent_id = page["parent_id"]
            if parent_id not in known_ids:
                parent_id = root_id
            children_by_parent.setdefault(parent_id, []).append(page)
        for siblings in children_by_parent.values():
            siblings.sort(key=lambda page: (page.get("title") or "").casefold())

        ordered = [root]

        def append_children(parent_id: str, depth: int) -> None:
            for page in children_by_parent.get(parent_id, []):
                page["depth"] = depth
                ordered.append(page)
                append_children(page["id"], depth + 1)

        append_children(root_id, 1)
        _discovered_page_ids.update(page["id"] for page in ordered)
        return _tree_result(
            space_key=root_space,
            root_page_id=root_id,
            pages=ordered,
            tree_truncated=tree_truncated,
            site_url=_site_url,
        )

    @tool(
        "confluence_get_page_content",
        "Get the full content of a Confluence page. `page_id` is required. "
        "Returns the title, body (storage format), version number, and "
        "last-modified time.",
        {"page_id": str},
    )
    async def get_page_content(args: dict) -> dict[str, Any]:
        if not token or not cloud_id:
            return _err("confluence is not configured (missing token or cloud_id)")
        page_id = (args.get("page_id") or "").strip()
        if not page_id:
            return _err("page_id is required")
        # GET /rest/api/content/{id} is gone (410); fetch the body by searching
        # for the id and expanding the content body — works under classic scopes.
        try:
            data = await _get(
                "/search",
                {
                    "cql": f"id={page_id}",
                    "expand": "content.body.storage,content.version,content.history.lastUpdated,content.space",
                    "limit": 1,
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(
                f"HTTP {e.response.status_code} fetching page: {e.response.text[:200]}"
            )

        results = data.get("results") or []
        if not results:
            return _err(f"page {page_id} not found or not accessible")
        result = results[0]
        content = result.get("content") or {}
        # A page id isn't space-scoped on its own; enforce scope on the page's
        # own space before returning any body.
        page_space = (
            (content.get("space") or {}).get("key")
            or (result.get("space") or {}).get("key")
            or ""
        )
        if not _in_scope(page_space):
            return _err(
                f"page {page_id!r} belongs to space {page_space!r}, not attached to "
                f"this project; out of scope."
            )
        body = (content.get("body") or {}).get("storage", {}).get("value", "")
        version = content.get("version") or {}
        resolved_id = content.get("id") or page_id
        if (
            page_space.upper() in _page_scoped
            and str(resolved_id) not in _discovered_page_ids
        ):
            return _err(
                f"page {resolved_id!r} is outside the selected Confluence "
                "page trees for this project."
            )
        out: dict[str, Any] = {
            "id": resolved_id,
            "title": content.get("title") or result.get("title"),
            "body": body,
            "version": version.get("number"),
            "last_modified": result.get("lastModified") or version.get("when"),
        }
        if resolved_id and _site_url:
            out["url"] = f"{_site_url}/wiki/pages/{resolved_id}"
        return _ok(out)

    return create_sdk_mcp_server(
        name="confluence",
        version="0.7.0",
        tools=[list_spaces, get_pages, get_page_tree, get_page_content],
    )
