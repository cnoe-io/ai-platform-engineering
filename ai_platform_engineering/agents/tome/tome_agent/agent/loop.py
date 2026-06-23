"""Shared core for the agent container's chat and ingest surfaces.

Both call the same `build_agent_options()` factory; only the system
prompt and the seed message differ.

- `cwd` is the container-local mount `/project` (env `TTT_PROJECT_ROOT`).
- The persist hook POSTs to `ttt-backend/internal/projects/{id}/pages`
  via `http_client.write_page` — sqlite is unreachable from the container.
- Connectors are snapshot-driven and tokens come from env (the
  orchestrator injects them at container start).
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from typing import Any
from pathlib import Path
from uuid import UUID

from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

from tome_agent.agent import http_client
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.connectors.base import SourceItem

log = logging.getLogger("tome_agent.agent.loop")

WIKI_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"]
WEB_TOOLS = ["WebFetch", "WebSearch"]


def project_base() -> Path:
    """Base dir for per-project working copies inside the (multi-project)
    container. `TTT_PROJECT_ROOT` is now the BASE, not a single project's dir."""
    return Path(os.environ.get("TTT_PROJECT_ROOT", "/project"))


def project_root(project_id: str) -> Path:
    """This request's wiki working copy: `<base>/<project_id>`. Scoping the dir
    to the request's project is what keeps one project's ingest from writing
    into another's (the cause of the cfn→tome-smoke bug)."""
    return project_base() / project_id


def _rehydrate_project(pdir: Path, project_id: str) -> None:
    """Refresh the project working copy from the backend (source of truth)
    at the start of each run, so the agent's Read/Glob/Grep tools never see
    stale content after UI edits or prior-turn agent writes. Best-effort: on
    failure we keep whatever is already on disk."""
    try:
        pages = http_client.fetch_all_pages_sync(project_id=project_id)
    except Exception:
        log.warning("project rehydrate failed; using existing working copy", exc_info=True)
        return
    for path, md in pages.items():
        try:
            fp = pdir / path
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(md)
        except OSError:
            log.warning("rehydrate: could not write %s", path, exc_info=True)


def _normalize_repo_slug(repo: str) -> str | None:
    """`https://github.com/foo/bar.git` → `foo/bar`. None on garbage input."""
    s = repo.strip().rstrip("/")
    for prefix in ("https://github.com/", "github.com/"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    if s.endswith(".git"):
        s = s[: -len(".git")]
    parts = s.split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return None
    return f"{parts[0]}/{parts[1]}"


def build_citation_guidance(repos: list[str]) -> str:
    canonical = [r for r in (_normalize_repo_slug(r) for r in repos) if r]
    if not canonical:
        return (
            "CITATION FORMAT: When you cite a commit, issue, or PR, use a normal "
            "markdown link like `[commit `a1b2c3d`](URL)` so the renderer makes "
            "it clickable. If you don't know the canonical URL, leave the "
            "citation as plain text in brackets — the renderer has a fallback."
        )

    primary = canonical[0]
    examples = [
        f"`[commit `a1b2c3d`](https://github.com/{primary}/commit/a1b2c3d)`",
        f"`[issue #142](https://github.com/{primary}/issues/142)`",
        f"`[PR #99](https://github.com/{primary}/pull/99)`",
        "`[@alice](https://github.com/alice)` for people (or just write `@alice` — the renderer resolves it)",
    ]

    repo_list = "\n".join(f"  - https://github.com/{r}" for r in canonical)
    return (
        "CITATION FORMAT: When you cite something, use a markdown link so the "
        "renderer makes it clickable.\n\n"
        f"Project repos:\n{repo_list}\n\n"
        "Examples (use the repo the item lives in — don't guess across repos):\n"
        + "\n".join(f"  - {e}" for e in examples)
        + "\n\nIf you don't know the canonical URL for a citation, leave it as plain "
        "bracketed text (e.g. `[commit a1b2c3d]`) — there's a renderer-side "
        "fallback that resolves common patterns."
    )


def make_deny_unsafe_tools_hook():
    """PreToolUse hook that hard-denies tools that bypass the persist hook
    or grant arbitrary code execution (Bash can `cat > path` past the
    Edit/Write persist hook, desyncing the FS cache from sqlite)."""
    DENIED = {"Bash", "BashOutput", "KillShell", "AskUserQuestion"}

    async def deny(input_data, _tool_use_id, _context):
        tool_name = input_data.get("tool_name", "")
        if tool_name in DENIED:
            reason = (
                f"{tool_name} is not available to TTT agents. There is no "
                "interactive user — you cannot ask questions or run shells. "
                "Use Edit / Write for file changes (so the persist hook records "
                "them in sqlite). For code-level repo inspection, use the github "
                "MCP tools (github_get_file, github_list_dir)."
            )
            log.warning(
                "denied unsafe tool call: %s (input: %.200s)",
                tool_name,
                str(input_data.get("tool_input", {})),
            )
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        return {}

    return deny


def make_constrain_writes_hook(project_dir: Path):
    """PreToolUse hook denying Write/Edit calls outside `project_dir`.

    SDK's `cwd` is a hint; this hook is the actual sandbox. Inside the
    agent container `/project` is bind-mounted, so paths outside it
    would mean the model is trying to write to its own image — refuse."""
    project_dir_resolved = project_dir.resolve()

    async def constrain(input_data, _tool_use_id, _context):
        tool_name = input_data.get("tool_name", "")
        if tool_name not in {"Edit", "Write"}:
            return {}
        tool_input = input_data.get("tool_input") or {}
        file_path = tool_input.get("file_path") or tool_input.get("path")
        if not file_path:
            return {}
        try:
            abs_path = Path(file_path).resolve()
            abs_path.relative_to(project_dir_resolved)
        except (ValueError, OSError):
            log.warning("denied %s outside project dir: %s", tool_name, file_path)
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{tool_name} target {file_path!r} is outside the project's "
                        f"wiki directory ({project_dir_resolved}). All wiki pages must "
                        "be written under your cwd as relative paths (e.g. "
                        "`overview.md`, `repos/<slug>/status.md`)."
                    ),
                }
            }
        return {}

    return constrain


def make_constrain_reads_hook(project_dir: Path):
    """PreToolUse hook denying file-reading tools outside `project_dir`.

    The write hook confines Edit/Write; this confines Read/Glob/Grep so the
    agent cannot read arbitrary host files. Critical when the agent runs
    natively (not in a container) — its cwd is one project's wiki dir and it
    has no business reading anything outside it. Source data comes from the
    connector MCPs (github/confluence/webex), never the local filesystem.

    Glob/Grep accept an optional `path` search root; when omitted they default
    to cwd (safe) so we only reject an explicit out-of-tree `path`."""
    project_dir_resolved = project_dir.resolve()
    READ_TOOLS = {"Read", "Glob", "Grep", "NotebookRead"}

    async def constrain(input_data, _tool_use_id, _context):
        tool_name = input_data.get("tool_name", "")
        if tool_name not in READ_TOOLS:
            return {}
        tool_input = input_data.get("tool_input") or {}
        target = tool_input.get("file_path") or tool_input.get("path")
        if not target:
            # Glob/Grep with no path → search root defaults to cwd. Allowed.
            return {}
        try:
            Path(target).resolve().relative_to(project_dir_resolved)
        except (ValueError, OSError):
            log.warning("denied %s outside project dir: %s", tool_name, target)
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{tool_name} target {target!r} is outside your wiki "
                        f"directory ({project_dir_resolved}). The wiki IS your cwd — "
                        "use relative paths (e.g. `overview.md`, "
                        "`repos/<slug>/status.md`). Source data (repos, Confluence, "
                        "Webex) comes from the MCP tools, not the local filesystem."
                    ),
                }
            }
        return {}

    return constrain


def make_persist_hook(
    *,
    author: str,
    report_id: UUID | None,
    project_dir: Path,
    project_id: str,
    on_write: Callable[[str, int], Any] | None = None,
):
    """PostToolUse hook that POSTs every Edit/Write of a file under
    `project_dir` to `ttt-backend/internal/projects/{project_id}/pages`.

    `project_dir`/`project_id` are captured at build time (when this request's
    project scope is known) and passed explicitly to the backend write, so a
    write can never be misrouted to another project even if the SDK runs the
    hook outside the request's context.

    `report_id` tags the revision with the ingest run's Report (None for
    chat edits). `on_write(page_path, byte_count)` runs after a
    successful POST — the ingest agent uses it to emit a log SSE event."""
    pdir = project_dir.resolve()

    async def persist(input_data, _tool_use_id, _context):
        tool_name = input_data.get("tool_name", "")
        if tool_name not in {"Edit", "Write"}:
            return {}
        tool_input = input_data.get("tool_input") or {}
        file_path = tool_input.get("file_path") or tool_input.get("path")
        log.debug("persist hook fired: tool=%s path=%s", tool_name, file_path)
        if not file_path:
            return {}
        try:
            abs_path = Path(file_path).resolve()
            rel = abs_path.relative_to(pdir)
        except (ValueError, OSError):
            return {}
        if not abs_path.exists():
            return {}
        try:
            content = abs_path.read_text()
            page_path = str(rel).replace("\\", "/")
            await http_client.write_page(
                page_path=page_path,
                body=content,
                message=f"{author}: {page_path}",
                author=author,
                report_id=report_id,
                project_id=project_id,
            )
            log.info("agent persisted %s (report_id=%s)", page_path, report_id)
            if on_write is not None:
                try:
                    res = on_write(page_path, len(content))
                    if asyncio.iscoroutine(res):
                        await res
                except Exception:
                    log.exception("on_write callback raised; ignoring")
        except Exception:
            log.exception("agent persist failed for %s", file_path)
        return {}

    return persist


def sources_to_items(snapshot_sources, *, kind: str) -> list[SourceItem]:
    """Translate `ProjectSnapshot.{repos,webex_rooms,confluence_spaces}` →
    connector-friendly `SourceItem`s. Each connector cares about
    different fields, so the kind tag picks the right projection."""
    if kind == "repos":
        return [
            SourceItem(slug=r.slug, display_name=r.url, extra={"url": r.url})
            for r in snapshot_sources
        ]
    if kind == "webex_rooms":
        return [
            SourceItem(slug=r.slug, display_name=r.name, extra={"room_id": r.room_id})
            for r in snapshot_sources
        ]
    if kind == "confluence_spaces":
        return [
            SourceItem(
                slug=s.slug,
                display_name=s.name,
                extra={"space_key": s.space_key, "base_url": s.base_url},
            )
            for s in snapshot_sources
        ]
    raise ValueError(f"unknown source kind: {kind}")


def sources_for_connector(snapshot, connector) -> list[SourceItem]:
    """Map a connector slug to the right snapshot field."""
    if connector.slug == "github":
        return sources_to_items(snapshot.repos, kind="repos")
    if connector.slug == "webex":
        return sources_to_items(snapshot.webex_rooms, kind="webex_rooms")
    if connector.slug == "confluence":
        return sources_to_items(snapshot.confluence_spaces, kind="confluence_spaces")
    return []


def log_pre_tool(input_data, _tool_use_id, _context):
    """Triggered right BEFORE the agent executes a tool."""
    log.info(
        f"🤖 Agent invoking tool: '{input_data.get('tool_name')}' | "
        f"Arguments: {input_data.get('tool_input')} | "
        f"Session ID: {_context.get('session_id')}"
    )


def log_post_tool(input_data, _tool_use_id, _context):
    """Triggered right AFTER the tool finishes executing."""
    # Truncate output if it's too massive for standard logs
    preview_result = str(input_data.get("result"))[:200]
    if len(str(input_data.get("result"))) > 200:
        preview_result += "... [truncated]"

    log.info(
        f"✅ Tool '{input_data.get('tool_name')}' finished | "
        f"Status: {'Success' if not input_data.get('is_error') else 'Error'} | "
        f"Result Preview: {preview_result}"
    )


def build_agent_options(
    *,
    system_prompt: str,
    model: str,
    max_turns: int,
    persist_author: str,
    snapshot,
    report_id: UUID | None = None,
    resume: str | None = None,
    include_partial_messages: bool = False,
    on_write: Callable[[str, int], Any] | None = None,
) -> ClaudeAgentOptions:
    """Compose ClaudeAgentOptions for chat and ingest in the agent
    container. MCP servers are scoped to the snapshot's sources."""

    agent_role = os.environ.get("TTT_AGENT_ROLE", "editor")

    # Scope this run to the request's project: a per-project working dir and
    # backend callbacks keyed by the same id. Without this the container's env
    # `TTT_PROJECT_ID` would route every project's writes to one project.
    project_id = snapshot.project_id
    http_client.set_active_project_id(project_id)

    pdir = project_root(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    _rehydrate_project(pdir, project_id)

    mcp_servers: dict = {}
    # Viewer containers have no write tools — Edit and Write are excluded
    # from the allowed list so the SDK never offers them to Claude.
    if agent_role == "viewer":
        allowed = ["Read", "Glob", "Grep", *WEB_TOOLS]
    else:
        allowed = [*WIKI_TOOLS, *WEB_TOOLS]

    for connector in REGISTRY:
        token = _connector_token(connector.slug)
        if not connector.is_enabled(token):
            continue
        sources = sources_for_connector(snapshot, connector)
        mcp_servers[connector.slug] = connector.build_mcp(token=token, sources=sources)
        allowed.extend(connector.mcp_tools)

    claude_agent_env = {
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
        **(
            {"ANTHROPIC_API_KEY": os.environ["ANTHROPIC_API_KEY"]}
            if os.environ.get("ANTHROPIC_API_KEY")
            else {}
        ),
        **(
            {"ANTHROPIC_AUTH_TOKEN": os.environ["ANTHROPIC_AUTH_TOKEN"]}
            if os.environ.get("ANTHROPIC_AUTH_TOKEN")
            else {}
        ),
        **(
            {"ANTHROPIC_BASE_URL": os.environ["ANTHROPIC_BASE_URL"]}
            if os.environ.get("ANTHROPIC_BASE_URL")
            else {}
        ),
    }
    if "bedrock" in model:
        claude_agent_env["CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"] = "1"

    return ClaudeAgentOptions(
        cwd=str(pdir),
        allowed_tools=allowed,
        permission_mode="acceptEdits",
        system_prompt=system_prompt,
        model=model,
        resume=resume,
        setting_sources=["project","local"], # ignore user
        skills="all",
        session_store=None,  # don't persist sessions
        mcp_servers=mcp_servers,
        env=claude_agent_env,
        debug_stderr=True,
        include_partial_messages=include_partial_messages,
        max_turns=max_turns,
        hooks={
            "PreToolUse": [
                HookMatcher(
                    matcher="Bash|BashOutput|KillShell|AskUserQuestion",
                    hooks=[make_deny_unsafe_tools_hook()],
                ),
                HookMatcher(
                    matcher="Edit|Write",
                    hooks=[make_constrain_writes_hook(pdir)],
                ),
                HookMatcher(
                    matcher="Read|Glob|Grep|NotebookRead",
                    hooks=[make_constrain_reads_hook(pdir)],
                ),
                HookMatcher(
                    matcher="*",
                    hooks=[log_pre_tool],
                ),
            ],
            "PostToolUse": [
                HookMatcher(
                    matcher="Edit|Write",
                    hooks=[
                        make_persist_hook(
                            author=persist_author,
                            report_id=report_id,
                            project_dir=pdir,
                            project_id=project_id,
                            on_write=on_write,
                        )
                    ],
                ),
                HookMatcher(
                    matcher="*",
                    hooks=[log_post_tool],
                ),
            ],
        },
    )


def _connector_token(slug: str) -> str:
    """Resolve this request's token for a connector.

    The only path: the caller forwarded an OAuth access token in the request
    body (`credentials[<provider>]["access_token"]`) and `set_active_credentials`
    stashed it in a task-local ContextVar at request entry. The agent stores
    nothing and has no ambient authority — no env-var fallback. A missing
    token returns "", `is_enabled` returns False, and the connector's MCP is
    simply not built; an empty / expired / wrong token surfaces as a clear
    auth error from the MCP tool result.

    The provider slug for Confluence in our connector REGISTRY is `confluence`,
    but the upstream credential provider is `atlassian` — translate here.
    """
    creds_provider = "atlassian" if slug == "confluence" else slug
    creds = http_client.get_active_credentials().get(creds_provider) or {}
    return creds.get("access_token", "")
