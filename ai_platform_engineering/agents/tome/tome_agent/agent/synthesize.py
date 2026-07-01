"""BHAG synthesis agent — synthesizes a strategic goal's wiki from the wikis of
the projects tagged to it.

A BHAG (Big Hairy Audacious Goal) has no sources of its own. Its dynamic pages
are a cross-project synthesis: the agent READS each child project's on-disk wiki
(materialized by the workspace sync) and rolls them up, grounded strictly in
what those wikis say. This is the first of a suite of cross-project subagents
(see #66 integrity / graph resolver, #42 compression) — each its own route +
module, sharing `run_stream.consume_agent_query` and `build_agent_options`.

The backend POSTs an `IngestRequest` whose `snapshot.project_type == "bhag"` and
whose `snapshot.child_projects` lists the tagged projects. The route refreshes
the children on disk first (under their locks), then drives this loop.
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
from tome_agent.reports import schema as report_schema

log = logging.getLogger("tome_agent.agent.synthesize")

SYNTHESIS_MODEL_DEFAULT = "claude-haiku-4-5"
MAX_TURNS = 60


def _synthesis_model() -> str:
    return os.environ.get("TTT_INGEST_MODEL", SYNTHESIS_MODEL_DEFAULT)


def _build_synthesis_system_prompt(
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    seed_stable_pages: bool,
) -> str:
    """System prompt for a BHAG synthesis. The loop widens the read fence to the
    child dirs; the agent reads those (read-only) and synthesizes, grounded
    strictly in what the child wikis say."""
    from tome_agent.agent.connectors.base import format_pages

    top_level = format_pages(report_schema.DEFAULT_PAGES)

    children = snapshot.child_projects or []
    if children:
        child_lines = "\n".join(
            f"- {c.name or c.slug or c.project_id} (`{c.slug or c.project_id}`): "
            f"`{project_root(c.project_id)}/`"
            for c in children
        )
        children_block = (
            "PROJECTS UNDER THIS BHAG — read their wikis at these absolute paths "
            "(READ-ONLY: you may Read/Glob/Grep them, but only Write within your own "
            "wiki, which is your cwd):\n\n"
            f"{child_lines}\n\n"
            "Each child's pages are markdown files DIRECTLY in its directory — there "
            "is NO `wiki/` subfolder (e.g. `/project/<id>/overview.md`, not "
            "`/project/<id>/wiki/overview.md`). DISCOVER before reading: for each "
            "child, run `Glob` with pattern `<that-path>/*.md` to list its actual "
            "pages, THEN Read the ones that matter (overview, status, standup, "
            "charter). Do NOT guess filenames or retry the same path. Skip a child "
            "whose Glob returns nothing — its wiki is empty.\n\n"
            "Then synthesize across the children — shared themes, cross-project "
            "progress, risks, and how each project ladders up to this goal. GROUND "
            "every statement in what a child wiki actually says and cite the child by "
            "name. Never invent project status; if few children have content, write a "
            "short honest synthesis over the ones that do."
        )
    else:
        children_block = (
            "NO PROJECTS ARE TAGGED TO THIS BHAG YET. Do not invent child projects "
            "or their status. Write only what the charter/seed context supports, and "
            "note in overview.md that no projects are tagged yet (tag projects to this "
            "BHAG from their Settings, under BHAG / Initiatives)."
        )

    stable_paths = ", ".join(f"`{p}`" for p in report_schema.default_stable_paths())
    if not is_greenfield:
        mode_block = (
            "MODE: INCREMENTAL SYNTHESIS. Re-read the child wikis and your existing "
            "pages; rewrite the dynamic/report pages to reflect the current "
            "cross-project state. Preserve stable/hidden pages (human-owned)."
        )
    elif seed_stable_pages:
        mode_block = (
            "MODE: GREENFIELD SYNTHESIS, STABLE-PAGE SEEDING ENABLED. The team opted in "
            f"to a best-effort agent draft of the stable pages ({stable_paths}). For "
            "EACH: Read it, then OVERWRITE with a draft synthesized from the child "
            "projects' charters/objectives — fill the existing `## section` headers, "
            "keep the YAML frontmatter + kind. Begin each stable page body with a "
            "one-line italic note marking it an agent draft for human review. Also "
            "write the dynamic/report/hidden pages."
        )
    else:
        mode_block = (
            "MODE: GREENFIELD SYNTHESIS. The stable pages "
            f"({stable_paths}) are pre-created and human-owned — do NOT write or "
            "overwrite them. Write the dynamic/report/hidden pages from the "
            "child wikis, with each page's declared kind in the YAML frontmatter."
        )

    project_block = f"""THIS IS A BHAG (Big Hairy Audacious Goal): "{snapshot.name}" — a strategic \
goal that spans multiple projects. It has NO repos, Confluence, or Webex sources \
of its own. Its wiki is a SYNTHESIS synthesized from the projects tagged to it.

BHAG CHARTER (seed context, may be empty):
{snapshot.charter or "(empty)"}

{children_block}

TOP-LEVEL PAGES (cross-cutting):

{top_level}

{mode_block}"""

    return f"{prompts.load('INGEST')}\n\n---\n\n{project_block}"


async def stream_synthesis(
    *,
    run_id: UUID,
    seed: str | None,
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    report_id: UUID,
    seed_stable_pages: bool = False,
) -> AsyncIterator[IngestEventPayload]:
    """Run a BHAG synthesis as a Claude Agent SDK loop. Yields IngestEvents the
    agent's HTTP handler writes to the SSE response."""
    log_buf: list[IngestEventPayload] = []

    async def on_write(page_path: str, byte_count: int) -> None:
        log_buf.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": byte_count, "ts": now_iso()},
            )
        )

    # Widen the read fence to the child projects' on-disk wikis (read-only).
    child_read_dirs = [project_root(c.project_id) for c in (snapshot.child_projects or [])]

    options = build_agent_options(
        snapshot=snapshot,
        system_prompt=_build_synthesis_system_prompt(
            snapshot, is_greenfield, seed_stable_pages
        ),
        model=_synthesis_model(),
        max_turns=MAX_TURNS,
        persist_author="ttt-synthesis",
        report_id=report_id,
        on_write=on_write,
        extra_read_dirs=child_read_dirs,
    )

    prompt_parts = [
        f"Run a {'GREENFIELD' if is_greenfield else 'INCREMENTAL'} BHAG synthesis for "
        f"\"{snapshot.name}\". Begin by reading your own existing wiki pages, then "
        f"read the wikis of the child projects at the paths listed in the system "
        f"prompt, and synthesize this BHAG's pages. Ground everything in the child "
        f"wikis — do not invent."
    ]
    if seed and seed.strip():
        prompt_parts.append(
            "\n\nUSER SEED INSTRUCTION (one-shot focus for this run):\n"
            f"{seed.strip()}"
        )
    prompt = "".join(prompt_parts)

    child_count = len(snapshot.child_projects or [])
    yield emit_log(
        f"▶ BHAG synthesis started "
        f"(mode={'greenfield' if is_greenfield else 'incremental'}, "
        f"projects={child_count}, model={_synthesis_model()})"
    )
    if seed and seed.strip():
        yield emit_log(f"· seed: {seed.strip()[:200]}")

    async for event in consume_agent_query(prompt, options, log_buf):
        yield event
