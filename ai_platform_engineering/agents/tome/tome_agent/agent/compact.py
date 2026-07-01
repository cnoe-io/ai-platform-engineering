"""Wiki compaction agent — an in-place editing pass over a project's wiki.

Compaction is the subtractive-in-spirit counterpart to ingest, but it never pulls
sources and never removes pages. It does two things: tighten the prose of dynamic
pages (say the same thing with fewer words, without losing facts or citations),
and fix stale `tome://` internal links. It's a sibling agent route to `/ingest`
and `/synthesize`, sharing `run_stream.consume_agent_query` and
`build_agent_options`.

The backend POSTs an `IngestRequest`; the route holds the project lock and
refreshes the on-disk wiki first (so the agent edits the latest committed state),
then drives this loop. Writes persist through the same hook as every other agent.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from uuid import UUID

from tome_agent import prompts
from tome_agent.agent.loop import build_agent_options, project_root
from tome_agent.agent.run_stream import consume_agent_query, emit_log, now_iso
from tome_agent.orchestrator.contract import IngestEventPayload, ProjectSnapshot

log = logging.getLogger("tome_agent.agent.compact")

COMPACTION_MODEL_DEFAULT = "claude-haiku-4-5"
MAX_TURNS = 40


def _compaction_model() -> str:
    return os.environ.get("TTT_INGEST_MODEL", COMPACTION_MODEL_DEFAULT)


def _build_compaction_system_prompt(snapshot: ProjectSnapshot) -> str:
    """System prompt for a compaction pass. COMPACT.md carries the behavior; this
    names the project and, for a BHAG, points at the child wikis it may read as
    ground truth while tightening."""
    project_block = (
        f'You are compacting the wiki for "{snapshot.name}". Its pages are markdown '
        "files in your cwd (the wiki root). Start by Globbing the tree to see every "
        "page, then tighten the dynamic ones and fix stale internal links per the "
        "rules above. Do not touch stable/hidden/report pages, and do not add or "
        "remove pages."
    )

    children = snapshot.child_projects or []
    if children:
        child_lines = "\n".join(
            f"- {c.name or c.slug or c.project_id} (`{c.slug or c.project_id}`): "
            f"`{project_root(c.project_id)}/`"
            for c in children
        )
        project_block += (
            "\n\nThis is a BHAG: its wiki is synthesized from the projects tagged to "
            "it. You MAY Read (never write) their on-disk wikis as ground truth when "
            "tightening this wiki's pages and checking references — their pages are "
            "markdown files DIRECTLY in these directories (no `wiki/` subfolder):\n\n"
            f"{child_lines}\n\n"
            "Use them only to keep this wiki's claims accurate as you edit. You still "
            "edit only this wiki's own pages."
        )

    return f"{prompts.load('COMPACT')}\n\n---\n\n{project_block}"


async def stream_compaction(
    *,
    run_id: UUID,
    seed: str | None,
    snapshot: ProjectSnapshot,
    report_id: UUID,
) -> AsyncIterator[IngestEventPayload]:
    """Run a wiki compaction pass as a Claude Agent SDK loop. Yields IngestEvents
    the agent's HTTP handler writes to the SSE response."""
    log_buf: list[IngestEventPayload] = []

    async def on_write(page_path: str, byte_count: int) -> None:
        log_buf.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": byte_count, "ts": now_iso()},
            )
        )

    # For a BHAG, widen the read fence to the child projects' on-disk wikis
    # (read-only) so compaction can check its pages against the ground truth.
    child_read_dirs = [project_root(c.project_id) for c in (snapshot.child_projects or [])]

    options = build_agent_options(
        snapshot=snapshot,
        system_prompt=_build_compaction_system_prompt(snapshot),
        model=_compaction_model(),
        max_turns=MAX_TURNS,
        persist_author="tome-compaction",
        report_id=report_id,
        on_write=on_write,
        extra_read_dirs=child_read_dirs,
    )

    prompt_parts = [
        "Run a compaction pass over this wiki. Glob the page tree, then tighten the "
        "prose of the dynamic pages and fix any stale tome:// links. Preserve all "
        "facts, citations, and frontmatter. Leave stable/hidden/report pages alone "
        "and add/remove no pages. If the wiki is already tight and its links "
        "resolve, make no edits."
    ]
    if seed and seed.strip():
        prompt_parts.append(
            "\n\nUSER SEED INSTRUCTION (one-shot focus for this run):\n"
            f"{seed.strip()}"
        )
    prompt = "".join(prompt_parts)

    yield emit_log(f"▶ compaction started (model={_compaction_model()})")
    if seed and seed.strip():
        yield emit_log(f"· seed: {seed.strip()[:200]}")

    async for event in consume_agent_query(prompt, options, log_buf):
        yield event
