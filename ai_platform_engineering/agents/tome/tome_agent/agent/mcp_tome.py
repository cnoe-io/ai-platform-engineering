"""In-process MCP server exposing wiki-maintenance tools to the editor agent.

Today it exposes one tool: `delete_page`, a Bash-free tombstone. Agents have
Read/Edit/Write/Glob/Grep and Bash is hard-denied, so before this the only way
to "remove" a page was to blank it with Edit — the page lingered. Curating a
collection (an overgrown glossary, obsolete/duplicate entries, orphaned source
subtrees) needs real removal.

Deletion is a TOMBSTONE, not an `rm`: the backend appends a deleted revision
(reversible, history preserved) — no filesystem delete that could desync the
working copy from the source of truth. Protected pages (stable, hidden, and the
founding template pages) are structurally refused by the tool, so the feared
"agent nuked a template/stable page" failure mode cannot happen.

Editor-only: attached in `build_agent_options` when the role isn't `viewer`.
"""

from __future__ import annotations

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


def build_tome_mcp(*, project_id: str, project_dir: Path, author: str):
    """Create the wiki-maintenance MCP server for one project run.

    `project_dir` is this run's working copy; the tool validates the target is
    inside it and reads its frontmatter to enforce the protected-class guard.
    `author` tags the tombstone revision.
    """
    pdir = Path(project_dir).resolve()

    @tool(
        "delete_page",
        "Remove a wiki page you own by TOMBSTONING it (reversible; history is "
        "kept). Use this to curate collections — prune duplicate, obsolete, or "
        "low-value entries (e.g. glossary terms under `glossary/`), or drop an "
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

    return create_sdk_mcp_server(name="tome", version="0.1.0", tools=[delete_page])
