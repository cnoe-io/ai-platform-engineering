"""Chat surface — wraps the Claude Agent SDK loop, streams ChatEvents
back as SSE.

The agent's `/chat` request handler builds a `ChatRequest` with the
backend-provided `ProjectSnapshot` + stable pages, calls
`stream_chat()`, and forwards each `ChatEventPayload` to the
HTTP response as `text/event-stream`. All project state is
snapshot-driven — no sqlite.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeSDKClient,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import StreamEvent

from tome_agent import prompts
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.loop import (
    build_agent_options,
    project_root,
    sources_for_connector,
)
from tome_agent.orchestrator.contract import ChatEventPayload, ProjectSnapshot
from tome_agent.reports import schema as report_schema

log = logging.getLogger("tome_agent.agent.chat")

CHAT_MODEL_DEFAULT = "claude-sonnet-4-6"
MAX_TURNS = 20


def _chat_model() -> str:
    return os.environ.get("TTT_CHAT_MODEL", CHAT_MODEL_DEFAULT)


_READ_ONLY_NOTICE = """\
READ-ONLY SESSION: You may read and analyse wiki pages and answer questions \
about this project. Edit and Write are not available to you — you cannot \
create or change pages. If the user asks you to make changes, explain that \
they need editor access to do so.\
"""


def build_system_prompt(
    snapshot: ProjectSnapshot,
    stable_pages: dict[str, str],
) -> str:
    def _strip(path: str) -> str:
        md = stable_pages.get(path, "")
        if not md:
            return "_(empty)_"
        _, body = report_schema.parse_frontmatter(md)
        return body.strip() or "_(empty)_"

    citation_guidance_blocks: list[str] = []
    deep_research_blocks: list[str] = []
    tree_lines: list[str] = [
        "- Top-level pages: `charter.md`, `roadmap.md`, `team-assignments.md` (stable, "
        "human-owned — edit only when the user asks; never rewrite unprompted), "
        "`activity.md`, `architecture.md` "
        "(dynamic, cross-cutting), `standup.md` (report card), `memory.md` (hidden agent notes).",
    ]
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        citation = connector.citation_guidance(sources)
        if citation:
            citation_guidance_blocks.append(citation)
        research = connector.deep_research_guidance(sources)
        if research:
            deep_research_blocks.append(research)
        if sources:
            def _label(s) -> str:
                # Surface the connector's stable identifier (e.g. Confluence
                # space key) so the agent can query the source directly instead
                # of trying to enumerate/guess it.
                key = s.extra.get("space_key")
                ident = f", key={key}" if key else ""
                return f"    - `{connector.source_prefix}/{s.slug}/` ({s.display_name}{ident})"

            source_lines = "\n".join(_label(s) for s in sources)
            tree_lines.append(
                f"- Per-{connector.name}-{connector.source_prefix.rstrip('s')} subtrees "
                f"under `{connector.source_prefix}/<slug>/`:\n{source_lines}"
            )
        else:
            tree_lines.append(
                f"- Per-{connector.name} subtrees under `{connector.source_prefix}/<slug>/` (none attached)."
            )

    wiki_tree = "\n".join(tree_lines)
    citation_section = "\n\n".join(citation_guidance_blocks)
    deep_research_section = "\n\n".join(deep_research_blocks)

    project_header = f"""PROJECT: "{snapshot.name}"
phase: {snapshot.phase or '(unset)'}    cadence: {snapshot.cadence or '(unset)'}"""

    if citation_section:
        project_header += f"\n\n{citation_section}"

    if deep_research_section:
        project_header += f"\n\n{deep_research_section}"

    write_root = project_root(snapshot.project_id)
    project_block = f"""{project_header}

WRITE ROOT: `{write_root}` (this is also your cwd). Every Write/Edit path must
be relative to this root (e.g. `overview.md`, `repos/<slug>/status.md`) —
never an absolute path, and never another project's directory.

WIKI TREE:
{wiki_tree}

Project anchor (top-level overview — read repo-specific overviews under `repos/<slug>/overview.md` for code-level detail):

# Overview

{_strip("overview.md")}"""

    # BHAG/Area: this project's "sources" are the wikis of its tagged child
    # projects, materialized read-only on disk. List them so chat can read
    # across them.
    children = snapshot.child_projects or []
    if children:
        entity_desc = (
            "an Area (a mid-tier grouping spanning the projects tagged to it)"
            if snapshot.project_type == "area"
            else "a BHAG (a strategic goal spanning the projects tagged to it)"
        )
        child_lines = "\n".join(
            f"    - `{project_root(c.project_id)}/` ({c.name})" for c in children
        )
        project_block += (
            f"\n\nCHILD PROJECT WIKIS — this is {entity_desc}. These are READ-ONLY "
            "reference material — read them with Read/Glob/Grep to answer "
            "cross-project questions, but NEVER write to them. Your own write root "
            f"is `{write_root}`, stated above; that is the only place you write:\n"
            f"{child_lines}"
        )

    base = f"{prompts.load('CHAT')}\n\n---\n\n{project_block}"
    if os.environ.get("TTT_AGENT_ROLE") == "viewer":
        return f"{_READ_ONLY_NOTICE}\n\n---\n\n{base}"
    return base


async def stream_chat(
    *,
    user_message: str,
    sdk_session_id: str | None,
    snapshot: ProjectSnapshot,
    stable_pages: dict[str, str],
    actor_email: str | None = None,
    is_compact: bool = False,
) -> AsyncIterator[ChatEventPayload]:
    """Run one chat turn against the SDK and yield ChatEventPayloads the
    agent's HTTP handler turns into SSE.

    `is_compact` sends the SDK's own `/compact` slash command instead of
    `user_message`, resuming `sdk_session_id` (required — compaction acts on
    an existing transcript, there is nothing to compact on a fresh session).
    The SDK replies with a `SystemMessage(subtype="compact_boundary")`,
    translated below into a `compact_boundary` event; no retry-on-fresh-session
    fallback applies here since a missing/dead session is a real failure, not
    one this call can recover from."""

    if is_compact and not sdk_session_id:
        yield ChatEventPayload(
            type="error",
            data={"message": "Cannot compact: no active session to compact."},
        )
        return

    prompt = "/compact" if is_compact else user_message
    system_prompt = build_system_prompt(snapshot, stable_pages)

    # BHAG chat reads its tagged children's on-disk wikis (kept fresh by the
    # workspace sync). Widen the read fence to them; writes stay confined to cwd.
    child_read_dirs = [project_root(c.project_id) for c in (snapshot.child_projects or [])]

    author = f"{actor_email} via tome-agent-chat" if actor_email else "tome-agent-chat"

    def _options(resume: str | None) -> Any:
        return build_agent_options(
            snapshot=snapshot,
            system_prompt=system_prompt,
            model=_chat_model(),
            max_turns=MAX_TURNS,
            persist_author=author,
            report_id=None,
            resume=resume,
            include_partial_messages=True,
            extra_read_dirs=child_read_dirs,
        )

    # One attempt. Records progress in `state` and captures (never raises) any
    # exception, so the caller can decide whether to fall back to a fresh
    # session. A fresh `init`/`done` event carries the new session_id back to
    # the client, so it stops reusing a dead id. Uses ClaudeSDKClient (not the
    # one-shot `query()`) so we can pull a live context-window snapshot via
    # `get_context_usage()` once the turn completes — same call the ingest
    # pane already surfaces (`run_stream.py`), giving chat the same visibility
    # (there's no other way to tell the user whether Compact will help at all).
    async def _attempt(resume: str | None, state: dict) -> AsyncIterator[ChatEventPayload]:
        try:
            async with ClaudeSDKClient(options=_options(resume)) as client:
                await client.query(prompt)
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage):
                        state["result_seen"] = True
                    async for event in _translate(message):
                        state["emitted"] = True
                        yield event
                try:
                    ctx = await client.get_context_usage()
                    yield ChatEventPayload(
                        type="context_usage",
                        data={
                            "percentage": ctx.get("percentage"),
                            "total_tokens": ctx.get("totalTokens"),
                            "max_tokens": ctx.get("maxTokens"),
                        },
                    )
                except Exception:
                    log.debug("get_context_usage failed after chat turn", exc_info=True)
        except Exception as e:  # noqa: BLE001 — surfaced/handled by the caller
            state["error"] = e

    state: dict = {"emitted": False, "result_seen": False, "error": None}
    async for event in _attempt(sdk_session_id, state):
        yield event

    err = state["error"]
    if err is None:
        return
    if state["result_seen"]:
        # Error after a successful result is a known SDK skill tool-deny
        # artifact — the turn already produced its answer; ignore it.
        log.warning("chat stream raised after ResultMessage (ignoring)", exc_info=err)
        return

    # Resume failed before producing anything — almost always a lost/evicted
    # transcript ("No conversation found with session ID"; the SDK's on-disk
    # session store isn't persisted across agent container recreates). For
    # compact this is the only way a resume can fail before emitting anything,
    # so report it as such instead of the raw ProcessError repr.
    if is_compact and sdk_session_id and not state["emitted"]:
        log.warning(
            "compact failed to resume session %s (%s) — likely an evicted transcript",
            sdk_session_id,
            type(err).__name__,
        )
        yield ChatEventPayload(
            type="error",
            data={
                "message": (
                    "This session's history is no longer available, so there's "
                    "nothing to compact. Send a message to continue, or use Clear "
                    "to start over."
                )
            },
        )
        return

    # Retry once on a fresh session so chat self-heals instead of staying
    # wedged on a dead id. Never for compact: a fresh session has nothing to
    # compact, so surface the failure instead of silently starting over
    # (handled above).
    if sdk_session_id and not state["emitted"] and not is_compact:
        log.warning(
            "chat resume failed for session %s (%s) — retrying with a fresh session",
            sdk_session_id,
            type(err).__name__,
        )
        retry: dict = {"emitted": False, "result_seen": False, "error": None}
        async for event in _attempt(None, retry):
            yield event
        rerr = retry["error"]
        if rerr is None or retry["result_seen"]:
            if rerr is not None:
                log.warning("chat retry raised after ResultMessage (ignoring)", exc_info=rerr)
            return
        log.error("chat stream failed on fresh-session retry", exc_info=rerr)
        yield ChatEventPayload(type="error", data={"message": f"{type(rerr).__name__}: {rerr}"})
        return

    log.error("chat stream failed", exc_info=err)
    yield ChatEventPayload(type="error", data={"message": f"{type(err).__name__}: {err}"})


async def _translate(message: Any) -> AsyncIterator[ChatEventPayload]:
    if isinstance(message, StreamEvent):
        ev = message.event or {}
        ev_type = ev.get("type")
        if ev_type == "content_block_delta":
            delta = ev.get("delta") or {}
            if delta.get("type") == "text_delta":
                yield ChatEventPayload(type="token", data={"text": delta.get("text", "")})
        return

    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, ToolUseBlock):
                yield ChatEventPayload(
                    type="tool_call",
                    data={
                        "tool": block.name,
                        "input": _safe_input(block.input),
                        "id": block.id,
                    },
                )
        return

    if isinstance(message, UserMessage):
        for block in getattr(message, "content", []) or []:
            kind = getattr(block, "type", None) or (
                block.get("type") if isinstance(block, dict) else None
            )
            if kind == "tool_result":
                content = (
                    getattr(block, "content", None)
                    or (block.get("content") if isinstance(block, dict) else None)
                    or ""
                )
                preview = _stringify_preview(content)
                yield ChatEventPayload(
                    type="tool_result",
                    data={
                        "id": getattr(block, "tool_use_id", None)
                        or (block.get("tool_use_id") if isinstance(block, dict) else None),
                        "preview": preview[:600],
                        "truncated": len(preview) > 600,
                    },
                )
        return

    if isinstance(message, SystemMessage):
        if message.subtype == "init":
            sid = (message.data or {}).get("session_id")
            if sid:
                yield ChatEventPayload(type="session", data={"session_id": sid})
        elif message.subtype == "compact_boundary":
            # Numbers live under `compact_metadata`, not flat on `data` —
            # confirmed against a real SDK response (2026-07-17).
            meta = (message.data or {}).get("compact_metadata") or {}
            yield ChatEventPayload(
                type="compact_boundary",
                data={
                    "pre_tokens": meta.get("pre_tokens"),
                    "post_tokens": meta.get("post_tokens"),
                    "trigger": meta.get("trigger"),
                },
            )
        return

    if isinstance(message, ResultMessage):
        if getattr(message, "is_error", False):
            log.warning(
                "ResultMessage has is_error=True: subtype=%s errors=%s",
                message.subtype,
                getattr(message, "errors", None),
            )
        text = ""
        if message.subtype == "success" and message.result:
            text = message.result
        yield ChatEventPayload(
            type="done",
            data={
                "session_id": message.session_id,
                "subtype": message.subtype,
                "result": text,
                "cost_usd": getattr(message, "total_cost_usd", None),
                "num_turns": getattr(message, "num_turns", None),
            },
        )
        return


def _safe_input(value: Any) -> Any:
    try:
        json.dumps(value)
    except TypeError:
        value = {"_repr": str(value)[:400]}
    if isinstance(value, dict):
        return {
            k: (v[:400] + "…" if isinstance(v, str) and len(v) > 400 else v)
            for k, v in value.items()
        }
    return value


def _stringify_preview(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    parts.append(item.get("text", ""))
                else:
                    parts.append(json.dumps(item)[:200])
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content)


_ = TextBlock  # keep import alive for type-checkers
