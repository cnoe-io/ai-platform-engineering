"""In-process MCP server exposing wiki-maintenance tools to the editor agent.

Tools:
- `delete_page`: a Bash-free tombstone. Agents have Read/Edit/Write/Glob/Grep
  and Bash is hard-denied, so before this the only way to "remove" a page was
  to blank it with Edit — the page lingered. Curating a collection (an
  overgrown glossary, obsolete/duplicate entries, orphaned source subtrees)
  needs real removal.
- `list_projects` / `list_project_pages` / `read_project_page`: cross-project
  lookups for authoring edges. An agent's filesystem tools (Read/Glob)
  are fenced to its own project's working copy — necessarily, since that's
  the run it's actually maintaining — so it has no way to discover what other
  projects exist, or to check that a `target`/`evidence` ref it wants to cite
  actually resolves, without a tool that reaches outside that fence. These
  three are read-only, backend-authoritative (same agent-token-authed
  internal API the persistent workspace sync already uses — see
  `http_client.fetch_all_projects` / `fetch_all_pages_sync`), and don't widen
  what the agent can Read/Write on disk.
- `get_page_templates`: the full admin-editable page-template config —
  every page's path/kind/title AND its seed body / sourcing guidance, by
  scope (top-level, github, confluence, webex). Ingest already gets this
  forced into its system prompt every run; chat never fetches templates at
  all today, so this gives chat (and ingest, if it wants a second look) an
  on-demand way to answer "what does the current template look like" instead
  of only ever seeing a hardcoded page list. Read-only, no args.

Deletion is a TOMBSTONE, not an `rm`: the backend appends a deleted revision
(reversible, history preserved) — no filesystem delete that could desync the
working copy from the source of truth. Protected pages (stable, hidden, and the
founding template pages) are structurally refused by the tool, so the feared
"agent nuked a template/stable page" failure mode cannot happen.

Editor-only: attached in `build_agent_options` when the role isn't `viewer`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from tome_agent.agent import http_client
from tome_agent.reports import schema as report_schema

log = logging.getLogger("tome_agent.agent.mcp_tome")


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_tome_mcp(
    *,
    project_id: str,
    project_dir: Path,
    author: str,
    readable_projects: list[Any] | None = None,
):
    """Create the wiki-maintenance MCP server for one project run.

    `project_dir` is this run's working copy; the tool validates the target is
    inside it and reads its frontmatter to enforce the protected-class guard.
    `author` tags the tombstone revision.
    """
    pdir = Path(project_dir).resolve()
    allowed_projects = {
        str(getattr(project, "slug", "") or ""): {
            "project_id": str(getattr(project, "project_id", "") or ""),
            "slug": str(getattr(project, "slug", "") or ""),
            "name": str(getattr(project, "name", "") or ""),
        }
        for project in (readable_projects or [])
        if getattr(project, "slug", "")
    }

    @tool(
        "delete_page",
        "Remove a wiki page you own by TOMBSTONING it (reversible; history is "
        "kept). Use this to curate collections — prune duplicate, obsolete, or "
        "low-value entries (e.g. glossary terms under `glossary/`, or resolved/"
        "stale edges under `edges/`), or drop an "
        "orphaned per-source page. This does NOT blank the page; it removes it. "
        "PROTECTED and refused: `stable` and `hidden` pages, and the founding "
        "template pages (overview.md, charter.md, standup.md, etc.) — blank or "
        "rewrite those with Edit instead. `path` is the wiki-relative page path "
        "(e.g. `glossary/tome.md`). `reason` is a short rationale, logged with "
        "the deletion — always give one.",
        {"path": str, "reason": str},
    )
    async def delete_page(args: dict) -> dict[str, Any]:
        raw = str(args.get("path") or "").strip().lstrip("/")
        reason = str(args.get("reason") or "").strip()
        if not raw:
            return _err("`path` is required.")
        if not reason:
            return _err("`reason` is required — say why this page should be removed.")
        if not raw.endswith(".md"):
            return _err(f"`{raw}` is not a `.md` page path.")
        try:
            abs_path = (pdir / raw).resolve()
            abs_path.relative_to(pdir)
        except (ValueError, OSError):
            return _err(f"`{raw}` is outside the wiki directory.")
        if not abs_path.exists():
            return _err(f"`{raw}` does not exist (already deleted?).")

        blocked = report_schema.deletion_block_reason(raw, abs_path.read_text())
        if blocked:
            return _err(blocked)

        try:
            await http_client.delete_page(
                page_path=raw,
                author=author,
                message=f"{author} deleted {raw}: {reason}",
                project_id=project_id,
            )
        except Exception as e:
            log.exception("delete_page backend call failed for %s", raw)
            return _err(f"backend delete failed: {type(e).__name__}: {e}")

        # Keep the working copy in step with the tombstone; the workspace sync
        # would reconcile it anyway, so a failed unlink is non-fatal.
        try:
            abs_path.unlink()
        except OSError:
            log.warning("could not unlink %s after tombstone; sync will reconcile", raw)

        log.info("agent tombstoned %s: %s", raw, reason)
        return _ok({"deleted": raw, "reason": reason})

    @tool(
        "get_page_templates",
        "The full admin-editable page-template config, by scope (`top-level`, "
        "`github`, `confluence`, `webex`). Each page includes its path, kind, "
        "title, order, enabled flag, AND its seed body — the actual `## section` "
        "scaffold for stable pages, or the sourcing guidance for dynamic pages "
        "(an admin edits this in the template editor; it's what a fresh page is "
        "founded with). Use this to check what the CURRENT template looks like "
        "before answering questions about page structure or sourcing guidance — "
        "the page list you were told about elsewhere may be stale if an admin "
        "edited the template since.",
        {},
    )
    async def get_page_templates(_args: dict) -> dict[str, Any]:
        try:
            snapshot = report_schema.full_template_snapshot()
        except Exception as e:
            log.warning("get_page_templates failed", exc_info=True)
            return _err(f"could not load page templates: {type(e).__name__}: {e}")
        return _ok(snapshot)

    @tool(
        "list_projects",
        "List every Project the backend knows about, as `[{project_slug, "
        "title}]`. Use this BEFORE citing another project in an edge's "
        "`target`/`source`/`evidence` — you need the exact slug for the "
        "`tome://@<project-slug>/<path>` form, and must not guess one.",
        {},
    )
    async def list_projects(_args: dict) -> dict[str, Any]:
        return _ok(
            [
                {
                    "project_slug": project["slug"],
                    "title": project["name"] or project["slug"],
                }
                for project in allowed_projects.values()
            ]
        )

    async def _resolve_slug(project_slug: str) -> str | None:
        project = allowed_projects.get(project_slug)
        return project["project_id"] if project else None

    @tool(
        "list_project_pages",
        "List the wiki page paths of another Project (by `project_slug`, from "
        "`list_projects`) — e.g. to see what a candidate edge `target` could "
        "point at before committing to a specific path. Returns paths + "
        "titles only, not page bodies; use `read_project_page` to read one.",
        {"project_slug": str},
    )
    async def list_project_pages(args: dict) -> dict[str, Any]:
        slug = str(args.get("project_slug") or "").strip()
        if not slug:
            return _err("`project_slug` is required.")
        target_id = await _resolve_slug(slug)
        if not target_id:
            return _err(f"no project with slug `{slug}`.")
        try:
            pages = await asyncio.to_thread(http_client.fetch_all_pages_sync, target_id)
        except Exception as e:
            log.warning("list_project_pages failed for %s", slug, exc_info=True)
            return _err(f"could not list pages for `{slug}`: {type(e).__name__}: {e}")
        out = []
        for path, md in pages.items():
            fm, _ = report_schema.parse_frontmatter(md)
            out.append({"path": path, "title": fm.get("title", "")})
        return _ok(sorted(out, key=lambda r: r["path"]))

    @tool(
        "read_project_page",
        "Read one page's full markdown (frontmatter + body) from another "
        "Project (by `project_slug` + `path`, e.g. `path=roadmap.md`). Use "
        "this to verify a cross-project `target`/`evidence` ref actually "
        "resolves, and to ground an edge's prose in what that page really "
        "says, before authoring it — never fabricate the other side.",
        {"project_slug": str, "path": str},
    )
    async def read_project_page(args: dict) -> dict[str, Any]:
        slug = str(args.get("project_slug") or "").strip()
        path = str(args.get("path") or "").strip().lstrip("/")
        if not slug or not path:
            return _err("`project_slug` and `path` are required.")
        target_id = await _resolve_slug(slug)
        if not target_id:
            return _err(f"no project with slug `{slug}`.")
        try:
            pages = await asyncio.to_thread(http_client.fetch_all_pages_sync, target_id)
        except Exception as e:
            log.warning("read_project_page failed for %s/%s", slug, path, exc_info=True)
            return _err(f"could not read `{slug}/{path}`: {type(e).__name__}: {e}")
        if path not in pages:
            return _err(f"`{path}` does not exist in project `{slug}`.")
        return _ok({"project_slug": slug, "path": path, "markdown": pages[path]})

    return create_sdk_mcp_server(
        name="tome",
        version="0.1.0",
        tools=[
            get_page_templates,
            delete_page,
            list_projects,
            list_project_pages,
            read_project_page,
        ],
    )
