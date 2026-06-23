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
  confluence_get_page_content(page_id)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_confluence_mcp(
    token: str = "",
    cloud_id: str = "",
    site_url: str = "",
    allowed_space_keys: list[str] | None = None,
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
            out.append({
                "key": key,
                "name": sp.get("name") or r.get("title"),
                "type": sp.get("type"),
            })
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
        limit = args.get("limit") or 25
        cql = f'space="{_cql_quote(space_key)}" and type=page order by lastmodified desc'
        try:
            data = await _get("/search", {"cql": cql, "limit": limit})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = []
        for r in (data.get("results") or []):
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
            return _err(f"HTTP {e.response.status_code} fetching page: {e.response.text[:200]}")

        results = data.get("results") or []
        if not results:
            return _err(f"page {page_id} not found or not accessible")
        result = results[0]
        content = result.get("content") or {}
        # A page id isn't space-scoped on its own; enforce scope on the page's
        # own space before returning any body.
        page_space = (content.get("space") or {}).get("key") or (result.get("space") or {}).get("key") or ""
        if not _in_scope(page_space):
            return _err(
                f"page {page_id!r} belongs to space {page_space!r}, not attached to "
                f"this project; out of scope."
            )
        body = (content.get("body") or {}).get("storage", {}).get("value", "")
        version = content.get("version") or {}
        resolved_id = content.get("id") or page_id
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
        version="0.2.0",
        tools=[list_spaces, get_pages, get_page_content],
    )
