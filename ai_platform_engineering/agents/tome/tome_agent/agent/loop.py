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
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher

from tome_agent.agent import http_client
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.connectors.base import SourceItem
from tome_agent.agent.mcp_mycelium import build_mycelium_mcp
from tome_agent.agent.mcp_tome import build_tome_mcp

log = logging.getLogger("tome_agent.agent.loop")

WIKI_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"]
WEB_TOOLS = ["WebFetch", "WebSearch"]


def project_base() -> Path:
    """Base dir for per-project working copies inside the (multi-project)
    container. `TTT_PROJECT_ROOT` is the BASE, not a single project's dir."""
    return Path(os.environ.get("TTT_PROJECT_ROOT", "/project"))


def project_root(project_id: str) -> Path:
    """This request's wiki working copy: `<base>/<project_id>`. Scoping the dir
    to the request's project keeps one project's ingest from writing into
    another's."""
    return project_base() / project_id


def _normalize_repo_slug(repo: str) -> str | None:
    """`https://github.com/foo/bar.git` → `foo/bar`. None on garbage input."""
    s = repo.strip().rstrip("/")
    for prefix in ("https://github.com/", "github.com/"):
        s = s.removeprefix(prefix)
    s = s.removesuffix(".git")
    parts = s.split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return None
    return f"{parts[0]}/{parts[1]}"


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


READ_SANDBOX_OVERRIDE_MARKER = "/__TOME_AGENT_OVERRIDE_BLOCK_1__"
"""Prefix an agent can put on a Read/Glob/Grep path to force it through the
sandbox despite being outside the wiki dir (e.g. recovering a large MCP
response the SDK externalized to a tool-results file it can't otherwise
reach, see #295). Not a real env var — Read/Glob/Grep tool schemas are fixed
by the SDK, so there's no separate field to carry an override flag; the
marker rides on the one string field these tools do take, the same way a
shell command can be prefixed with `VAR=1 &&`. Deliberately narrow: only
widens the READ sandbox, never the separate Write/Edit/Bash restrictions
(Bash stays banned outright — see `make_deny_unsafe_tools_hook` for why).

MUST start with `/`: the model/CLI resolves a relative-looking file_path
against cwd before our hook ever sees it (confirmed in production — a
non-`/`-prefixed marker arrived at the hook already rejoined onto the
project dir, e.g. `/project/<id>/TOME_AGENT_OVERRIDE_BLOCK=1::/etc/hostname`,
which silently passed the sandbox check as a bogus in-tree path and 404'd
on the real Read instead of ever exercising the override). Keeping the
marker itself absolute means `{MARKER}{real_absolute_path}` is still one
valid absolute string end to end, so it survives untouched until our hook
strips it."""


def make_constrain_reads_hook(project_dir: Path, extra_dirs: list[Path] | None = None):
    """PreToolUse hook denying file-reading tools outside `project_dir`,
    with a two-step override: the first attempt is denied with instructions
    on how to force it through (`READ_SANDBOX_OVERRIDE_MARKER`); every
    override actually exercised is logged loudly, never silent.

    The write hook confines Edit/Write; this confines Read/Glob/Grep so the
    agent cannot read arbitrary host files. Critical when the agent runs
    natively (not in a container) — its cwd is one project's wiki dir and it
    has no business reading anything outside it. Source data comes from the
    connector MCPs (github/confluence/webex), never the local filesystem.

    `extra_dirs` widens the allowed read roots beyond cwd. Used for a BHAG
    ingest: the agent's cwd is the BHAG's own wiki, but it must also READ (never
    write) the on-disk wikis of its child projects to synthesize the BHAG wiki.

    Glob/Grep accept an optional `path` search root; when omitted they default
    to cwd (safe) so we only reject an explicit out-of-tree `path`."""
    allowed_roots = [project_dir.resolve()] + [d.resolve() for d in (extra_dirs or [])]
    READ_TOOLS = {"Read", "Glob", "Grep", "NotebookRead"}

    def _within_allowed(target: str) -> bool:
        resolved = Path(target).resolve()
        for root in allowed_roots:
            try:
                resolved.relative_to(root)
                return True
            except (ValueError, OSError):
                continue
        return False

    async def constrain(input_data, _tool_use_id, _context):
        tool_name = input_data.get("tool_name", "")
        if tool_name not in READ_TOOLS:
            return {}
        tool_input = input_data.get("tool_input") or {}
        key = "file_path" if "file_path" in tool_input else "path"
        target = tool_input.get(key)
        if not target:
            # Glob/Grep with no path → search root defaults to cwd. Allowed.
            return {}
        target = str(target)

        if target.startswith(READ_SANDBOX_OVERRIDE_MARKER):
            real_target = target[len(READ_SANDBOX_OVERRIDE_MARKER):]
            log.warning(
                "READ SANDBOX OVERRIDE exercised: %s on %r (outside %s)",
                tool_name,
                real_target,
                allowed_roots[0],
            )
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "updatedInput": {**tool_input, key: real_target},
                }
            }

        if not _within_allowed(target):
            log.warning("denied %s outside allowed dirs: %s", tool_name, target)
            extra_hint = (
                " You may also read the child project wikis listed in your prompt."
                if extra_dirs
                else ""
            )
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"{tool_name} target {target!r} is outside your wiki "
                        f"directory ({allowed_roots[0]}). The wiki IS your cwd — "
                        "use relative paths (e.g. `overview.md`, "
                        "`repos/<slug>/status.md`). Source data (repos, Confluence, "
                        "Webex) comes from the MCP tools, not the local filesystem."
                        + extra_hint
                        + " If you are certain you need this exact path anyway (e.g. "
                        "recovering a large MCP response that got truncated to a "
                        "tool-results file), retry with the path prefixed by "
                        f"`{READ_SANDBOX_OVERRIDE_MARKER}` — e.g. "
                        f"`{READ_SANDBOX_OVERRIDE_MARKER}{target}`. This will be "
                        "allowed, but is logged and should be rare."
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
        except httpx.HTTPStatusError as exc:
            log.warning(
                "agent persist rejected for %s: %s %s",
                file_path,
                exc.response.status_code,
                exc.response.text[:500],
            )
            if exc.response.status_code == 403:
                context = (
                    f"Your edit to {rel} was NOT saved. The backend rejected it: "
                    "only this project's data steward or a Tome admin may edit pages "
                    "via chat. Tell the user their edit needs a data steward, or ask "
                    "them to make the change themselves."
                )
            else:
                context = (
                    f"Your edit to {rel} was NOT saved — the backend rejected the "
                    f"write ({exc.response.status_code}). Do not tell the user the "
                    "page was updated."
                )
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": context,
                }
            }
        except Exception:
            log.exception("agent persist failed for %s", file_path)
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": (
                        f"Your edit to {rel} was NOT saved due to an internal error. "
                        "Do not tell the user the page was updated."
                    ),
                }
            }
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
                extra={
                    "space_key": s.space_key,
                    "base_url": s.base_url,
                    "root_page_id": s.root_page_id,
                    "root_page_title": s.root_page_title,
                    "include_descendants": s.include_descendants,
                    "page_scopes": [
                        scope.model_dump() for scope in s.page_scopes
                    ],
                },
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


async def log_pre_tool(
    input_data: dict[str, Any],
    _tool_use_id: str | None,
    _context: dict[str, Any],
) -> dict[str, Any]:
    """Triggered right BEFORE the agent executes a tool.

    The SDK awaits every hook callback and converts its mapping result for the
    CLI. Returning None either breaks the await or the mapping conversion and
    eventually wedges the CLI's stream reader."""
    log.info(
        f"🤖 Agent invoking tool: '{input_data.get('tool_name')}' | "
        f"Arguments: {input_data.get('tool_input')} | "
        f"Session ID: {_context.get('session_id')}"
    )
    return {}


async def log_post_tool(
    input_data: dict[str, Any],
    _tool_use_id: str | None,
    _context: dict[str, Any],
) -> dict[str, Any]:
    """Triggered right AFTER the tool finishes executing.

    Async and mapping-returning for the same SDK contract as log_pre_tool."""
    # Truncate output if it's too massive for standard logs
    preview_result = str(input_data.get("result"))[:200]
    if len(str(input_data.get("result"))) > 200:
        preview_result += "... [truncated]"

    log.info(
        f"✅ Tool '{input_data.get('tool_name')}' finished | "
        f"Status: {'Success' if not input_data.get('is_error') else 'Error'} | "
        f"Result Preview: {preview_result}"
    )
    return {}


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
    extra_read_dirs: list[Path] | None = None,
    offline: bool = False,
    max_budget_usd: float | None = None,
) -> ClaudeAgentOptions:
    """Compose ClaudeAgentOptions for chat and ingest in the agent
    container. MCP servers are scoped to the snapshot's sources.

    `extra_read_dirs` widens the read fence beyond cwd (writes stay confined to
    cwd). Used by the BHAG synthesis agent to read its child projects' wikis."""

    agent_role = os.environ.get("TTT_AGENT_ROLE", "editor")

    # Scope this run to the request's project: a per-project working dir and
    # backend callbacks keyed by the same id. Without this the container's env
    # `TTT_PROJECT_ID` would route every project's writes to one project.
    project_id = snapshot.project_id
    http_client.set_active_project_id(project_id)

    # The working copy is materialized & kept fresh by the persistent-workspace
    # loader/sync (and refreshed under lock before an ingest), so there's no
    # per-request rehydrate here. Just ensure the dir exists.
    pdir = project_root(project_id)
    pdir.mkdir(parents=True, exist_ok=True)

    mcp_servers: dict = {}
    # The tome MCP server is built for both roles — get_page_templates is
    # read-only and safe for a viewer session too. Viewer containers still
    # have no write tools — Edit and Write are excluded from the allowed
    # list so the SDK never offers them to Claude; the same restriction
    # keeps delete_page and the cross-project lookups editor-only below.
    if not offline:
        mcp_servers["tome"] = build_tome_mcp(
            project_id=project_id,
            project_dir=pdir,
            author=persist_author,
            readable_projects=snapshot.readable_projects,
        )
    if offline:
        # Frozen experiments may read and edit only the materialized bundle.
        # No WebFetch, connector MCP, cross-project lookup, or live template
        # call can make the two candidates observe different evidence.
        allowed = list(WIKI_TOOLS)
    elif agent_role == "viewer":
        allowed = [
            "Read",
            "Glob",
            "Grep",
            *WEB_TOOLS,
            "mcp__tome__get_page_templates",
            "mcp__tome__list_gists",
            "mcp__tome__get_gist",
        ]
    else:
        allowed = [*WIKI_TOOLS, *WEB_TOOLS]
        # Editors get the Bash-free tombstone tool for curating collections
        # (e.g. pruning glossary entries). It structurally refuses stable /
        # hidden / founding-template pages, so no unsafe delete path exists.
        allowed.extend(
            [
                "mcp__tome__get_page_templates",
                "mcp__tome__delete_page",
                # Cross-project lookups for authoring edges — read-only.
                "mcp__tome__list_projects",
                "mcp__tome__list_project_pages",
                "mcp__tome__read_project_page",
                "mcp__tome__list_gists",
                "mcp__tome__get_gist",
            ]
        )

    for connector in (() if offline else REGISTRY):
        token = _connector_token(connector.slug)
        if not connector.is_enabled(token):
            continue
        sources = sources_for_connector(snapshot, connector)
        mcp_servers[connector.slug] = connector.build_mcp(token=token, sources=sources)
        allowed.extend(connector.mcp_tools)

    # Feed: the project's own Mycelium room, keyed by slug. Reading is
    # available to both chat and ingest when the hub is configured, so the
    # agent can fold recent discussion (decisions, open questions) into its
    # answers and the wiki. No attached "sources" — it's the project's own
    # conversation. Promoting (a write) is editor-only, same gate as the
    # other write tools above.
    if not offline and os.environ.get("MYCELIUM_URL", "").strip() and snapshot.slug:
        mcp_servers["mycelium"] = build_mycelium_mcp(snapshot.slug)
        allowed.append("mcp__mycelium__feed_read_messages")
        if agent_role != "viewer":
            allowed.append("mcp__mycelium__feed_promote")

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
        max_budget_usd=max_budget_usd,
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
                    hooks=[make_constrain_reads_hook(pdir, extra_dirs=extra_read_dirs)],
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
