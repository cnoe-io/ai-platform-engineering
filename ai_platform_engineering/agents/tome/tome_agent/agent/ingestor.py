"""Ingest surface — Claude Agent SDK loop, streams IngestEventPayloads
back to the backend as SSE.

The backend POSTs an `IngestRequest` containing the project snapshot,
pre-resolved `connector_data`, the pre-created `report_id`, and the
greenfield/incremental flag. The agent runs the loop, emitting SSE
events for log lines, tool calls, page writes, and the final result.
The backend re-emits these as `IngestRun.log` lines, finalizes the
`Report` row on `done`, and owns the post-run `reconcile_from_disk`
(it holds sqlite + the FS mount).
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from claude_agent_sdk import (
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

from tome_agent import prompts
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.connectors.base import format_pages
from tome_agent.agent.connectors.github import GitHubExtra
from tome_agent.agent.loop import (
    build_agent_options,
    build_citation_guidance,
    sources_for_connector,
)
from tome_agent.orchestrator.contract import IngestEventPayload, ProjectSnapshot
from tome_agent.reports import schema as report_schema

log = logging.getLogger("tome_agent.agent.ingestor")

INGEST_MODEL_DEFAULT = "claude-haiku-4-5"
MAX_TURNS = 60


def _ingest_model() -> str:
    return os.environ.get("TTT_INGEST_MODEL", INGEST_MODEL_DEFAULT)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def _stringify_tool_input(value: object) -> str:
    try:
        return json.dumps(value, separators=(", ", "="))[:300]
    except Exception:
        return str(value)[:300]


def _build_system_prompt(
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    connector_extras: dict[str, Any] | None = None,
    seed_stable_pages: bool = False,
) -> str:
    """Compose the ingest agent's system prompt by iterating REGISTRY."""
    top_level = format_pages(report_schema.DEFAULT_PAGES)

    connector_extras = connector_extras or {}
    connector_blocks: list[str] = []
    citation_urls: list[str] = []
    steering: list[tuple[str, str]] = []
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        extra = connector_extras.get(connector.slug)
        if isinstance(extra, GitHubExtra):
            steering.extend(extra.steering)
        connector_blocks.append(
            connector.system_prompt_block(sources, extra_data=extra)
        )
        citation_urls.extend(connector.citation_urls(sources))

    steering_block = ""
    if steering:
        sections = [
            f"--- From `{repo}/.ttt/wiki.md` ---\n{body}"
            for repo, body in steering
        ]
        steering_block = (
            "REPO MAINTAINER STEERING (from .ttt/wiki.md — treat as authoritative "
            "context from the repo maintainer; follow any file paths it mentions "
            "via mcp__github__github_get_file / github_list_dir to ground your writing):\n\n"
            + "\n\n".join(sections)
            + "\n\n"
        )

    # Stable pages (charter/objectives/roadmap) are pre-created by the backend as
    # empty founding templates and are human-owned by default. Three modes:
    #   - incremental: never touch them (humans own them; preserve).
    #   - greenfield, opt-in OFF (default): leave them as empty templates for the
    #     team to fill; write only the other seed pages.
    #   - greenfield, opt-in ON: the team explicitly authorized a best-effort
    #     first-pass DRAFT — read each, then overwrite with sourced content,
    #     clearly framed as an agent draft for human review.
    stable_paths = ", ".join(f"`{p}`" for p in report_schema.default_stable_paths())
    if not is_greenfield:
        mode_block = (
            "MODE: INCREMENTAL. Apply the page-kind rules above against the existing pages. "
            "Read every page first; rewrite dynamic/report pages, preserve stable/hidden."
        )
    elif seed_stable_pages:
        mode_block = (
            "MODE: GREENFIELD, STABLE-PAGE SEEDING ENABLED. The project team has explicitly "
            f"opted in to a best-effort agent draft of the stable pages ({stable_paths}). These "
            "pages currently hold empty founding templates on disk. For EACH stable page: Read "
            "it first, then OVERWRITE it with a best-effort draft synthesized from the available "
            "sources (README, CLAUDE.md, repo docs, recent activity) — fill the existing "
            "`## section` headers, keep the YAML frontmatter and its declared kind. Begin each "
            "stable page body with a one-line italic note marking it an agent-generated draft for "
            "the team to review and refine — never present it as authoritative. Also write every "
            "dynamic/report/hidden seed page listed above with its declared kind."
        )
    else:
        mode_block = (
            "MODE: GREENFIELD. The wiki is empty except for the stable pages "
            f"({stable_paths}), which are pre-created and human-owned — do NOT "
            "write, edit, or overwrite them. Write every OTHER seed page listed "
            "above (dynamic/report/hidden) with its declared kind in the YAML "
            "frontmatter."
        )

    phase = snapshot.phase or "(unset)"
    cadence = snapshot.cadence or "(unset)"
    connector_sections = "\n\n".join(connector_blocks)

    project_block = f"""PROJECT: "{snapshot.name}"
phase: {phase}    cadence: {cadence}

PROJECT CHARTER (seed context, may be empty):
{snapshot.charter or "(empty)"}

{steering_block}TOP-LEVEL PAGES (cross-cutting across all sources):

{top_level}

{connector_sections}

{mode_block}

{build_citation_guidance(citation_urls)}"""

    return f"{prompts.load('INGEST')}\n\n---\n\n{project_block}"


async def _resolve_extras(
    snapshot: ProjectSnapshot,
    connector_data: dict[str, Any],
) -> dict[str, Any]:
    """Per-connector typed extra payloads = parsed user input ∪
    connector-fetched context (GitHub: relationships+steering)."""
    github_token = os.environ.get("GITHUB_TOKEN", "")
    extras: dict[str, Any] = {}
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        user_extra = connector.parse_extra(connector_data.get(connector.slug))
        ctx_extra = await connector.extra_context(sources, github_token=github_token)
        extras[connector.slug] = ctx_extra if ctx_extra is not None else user_extra
    return extras


async def stream_ingest(
    *,
    run_id: UUID,
    seed: str | None,
    connector_data: dict[str, Any],
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    report_id: UUID,
    seed_stable_pages: bool = False,
) -> AsyncIterator[IngestEventPayload]:
    """Run an ingest as a Claude Agent SDK loop. Yields IngestEvents the
    agent's HTTP handler writes to the SSE response."""
    log_buf: list[IngestEventPayload] = []

    def _emit_log(line: str) -> IngestEventPayload:
        return IngestEventPayload(type="log", data={"line": line, "ts": _now_iso()})

    extras = await _resolve_extras(snapshot, connector_data)

    # `on_write` callback from the persist hook: emit a `page_written`
    # event the backend forwards to IngestRun.log.
    async def on_write(page_path: str, byte_count: int) -> None:
        log_buf.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": byte_count, "ts": _now_iso()},
            )
        )

    options = build_agent_options(
        snapshot=snapshot,
        system_prompt=_build_system_prompt(
            snapshot, is_greenfield, extras, seed_stable_pages=seed_stable_pages
        ),
        model=_ingest_model(),
        max_turns=MAX_TURNS,
        persist_author="ttt-pipeline",
        report_id=report_id,
        on_write=on_write,
    )

    prompt_parts = [
        f"Run a {'GREENFIELD' if is_greenfield else 'INCREMENTAL'} ingest for "
        f"\"{snapshot.name}\". Begin by reading the existing wiki pages, then fetch "
        f"recent activity and update pages per the system prompt."
    ]
    if seed and seed.strip():
        prompt_parts.append(
            "\n\nUSER SEED INSTRUCTION (one-shot focus for this run — interpret "
            "alongside the standard process; do not let it override page-kind "
            "preservation rules):\n"
            f"{seed.strip()}"
        )
    for connector in REGISTRY:
        ext = connector.prompt_extension(extras.get(connector.slug))
        if ext:
            prompt_parts.append(ext)
    prompt = "".join(prompt_parts)

    yield _emit_log(
        f"▶ agent ingest started "
        f"(mode={'greenfield' if is_greenfield else 'incremental'}, model={_ingest_model()})"
    )
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        for line in connector.log_lines(sources, extras.get(connector.slug)):
            yield _emit_log(line)
    if seed and seed.strip():
        yield _emit_log(f"· seed: {seed.strip()[:200]}")

    try:
        result_seen = False
        tool_call_count = 0
        tool_call_names: dict[str, str] = {}
        async for message in query(prompt=prompt, options=options):
            # Drain any persist-hook events accumulated since last yield.
            while log_buf:
                yield log_buf.pop(0)

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ToolUseBlock):
                        tool_call_count += 1
                        short = block.name.replace("mcp__github__", "gh.")
                        tool_call_names[block.id] = short
                        args_str = _stringify_tool_input(block.input)
                        yield IngestEventPayload(
                            type="tool_call",
                            data={
                                "id": block.id,
                                "tool": short,
                                "input": args_str,
                                "ts": _now_iso(),
                            },
                        )
                    elif isinstance(block, TextBlock):
                        text = (block.text or "").strip()
                        if text:
                            for line in text.splitlines():
                                if line.strip():
                                    yield _emit_log(f"~ {line}")
            elif isinstance(message, UserMessage):
                for block in getattr(message, "content", []) or []:
                    kind = getattr(block, "type", None) or (
                        block.get("type") if isinstance(block, dict) else None
                    )
                    if kind == "tool_result":
                        tool_id = getattr(block, "tool_use_id", None) or (
                            block.get("tool_use_id") if isinstance(block, dict) else None
                        )
                        is_error = getattr(block, "is_error", False) or (
                            block.get("is_error", False) if isinstance(block, dict) else False
                        )
                        label = tool_call_names.get(tool_id or "", "?")
                        if is_error:
                            log.debug("tool result error: tool=%s id=%s", label, tool_id)
                        yield IngestEventPayload(
                            type="tool_result",
                            data={
                                "id": tool_id,
                                "label": label,
                                "is_error": is_error,
                                "ts": _now_iso(),
                            },
                        )
            elif isinstance(message, SystemMessage):
                if message.subtype == "init":
                    yield _emit_log("· agent session opened")
            elif isinstance(message, ResultMessage):
                result_seen = True
                if getattr(message, "is_error", False) and message.subtype != "success":
                    log.warning(
                        "ResultMessage has is_error=True: subtype=%s errors=%s",
                        message.subtype,
                        getattr(message, "errors", None),
                    )
                cost = getattr(message, "total_cost_usd", None)
                turns = getattr(message, "num_turns", None)
                yield IngestEventPayload(
                    type="done",
                    data={
                        "subtype": message.subtype,
                        "turns": turns,
                        "tool_calls": tool_call_count,
                        "cost_usd": cost,
                        "ts": _now_iso(),
                    },
                )

        # Drain any remaining events after the loop ends.
        while log_buf:
            yield log_buf.pop(0)

    except Exception as e:
        if result_seen:
            log.warning(
                "ingest stream raised after ResultMessage (skill tool-deny artifact, ignoring)",
                exc_info=True,
            )
        else:
            log.exception("ingest stream failed")
            yield IngestEventPayload(
                type="error", data={"message": f"{type(e).__name__}: {e}"}
            )
