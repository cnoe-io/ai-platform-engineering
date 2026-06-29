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
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
    query,
)
from claude_agent_sdk.types import StreamEvent

from tome_agent import prompts
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.loop import (
    build_agent_options,
    build_citation_guidance,
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

    citation_urls: list[str] = []
    tree_lines: list[str] = [
        "- Top-level pages: `charter.md`, `objectives.md`, `roadmap.md` (stable, "
        "human-owned — edit only when the user asks; never rewrite unprompted), "
        "`overview.md`, `architecture.md`, `marketing.md`, `conversations.md` "
        "(dynamic, cross-cutting), `standup.md` (report card), `memory.md` (hidden agent notes).",
    ]
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        citation_urls.extend(connector.citation_urls(sources))
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

    project_block = f"""PROJECT: "{snapshot.name}"
phase: {snapshot.phase or '(unset)'}    cadence: {snapshot.cadence or '(unset)'}

{build_citation_guidance(citation_urls)}

WIKI TREE:
{wiki_tree}

Project anchor (top-level overview — read repo-specific overviews under `repos/<slug>/overview.md` for code-level detail):

# Overview

{_strip("overview.md")}"""

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
) -> AsyncIterator[ChatEventPayload]:
    """Run one chat turn against the SDK and yield ChatEventPayloads the
    agent's HTTP handler turns into SSE."""

    system_prompt = build_system_prompt(snapshot, stable_pages)

    def _options(resume: str | None) -> Any:
        return build_agent_options(
            snapshot=snapshot,
            system_prompt=system_prompt,
            model=_chat_model(),
            max_turns=MAX_TURNS,
            persist_author="ttt-chat",
            report_id=None,
            resume=resume,
            include_partial_messages=True,
        )

    # One attempt. Records progress in `state` and captures (never raises) any
    # exception, so the caller can decide whether to fall back to a fresh
    # session. A fresh `init`/`done` event carries the new session_id back to
    # the client, so it stops reusing a dead id.
    async def _attempt(resume: str | None, state: dict) -> AsyncIterator[ChatEventPayload]:
        try:
            async for message in query(prompt=user_message, options=_options(resume)):
                if isinstance(message, ResultMessage):
                    state["result_seen"] = True
                async for event in _translate(message):
                    state["emitted"] = True
                    yield event
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
    # transcript ("No conversation found with session ID"). Retry once on a
    # fresh session so chat self-heals instead of staying wedged on a dead id.
    if sdk_session_id and not state["emitted"]:
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
