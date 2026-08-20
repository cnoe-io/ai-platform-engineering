"""BHAG/Area synthesis agent.

The agent reads each child project's on-disk wiki and enriches that roll-up
with the BHAG/Area's directly attached GitHub, Confluence, and Webex sources.
This is the first of a suite of cross-project subagents (see #66 integrity /
graph resolver, #42 compression) — each its own route + module, sharing
`run_stream.consume_agent_query` and `build_agent_options`.

The backend POSTs an `IngestRequest` whose `snapshot.project_type == "bhag"` and
whose `snapshot.child_projects` lists the tagged projects. The route refreshes
the children on disk first (under their locks), then drives this loop.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from tome_agent import prompts
from tome_agent.agent import http_client
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.ingestor import (
    expected_template_pages,
    format_full_template,
    resolve_connector_extras,
)
from tome_agent.agent.loop import (
    build_agent_options,
    project_root,
    sources_for_connector,
)
from tome_agent.agent.run_stream import consume_agent_query, emit_log, now_iso
from tome_agent.orchestrator.contract import (
    ExperimentRunContext,
    IngestEventPayload,
    ProjectSnapshot,
)
from tome_agent.reports import schema as report_schema

log = logging.getLogger("tome_agent.agent.synthesize")

SYNTHESIS_MODEL_DEFAULT = "claude-haiku-4-5"
MAX_TURNS = 100


def _synthesis_model() -> str:
    return http_client.resolve_model(
        "synthesize",
        SYNTHESIS_MODEL_DEFAULT,
        ("TTT_INGEST_MODEL",),
    )


def _build_synthesis_system_prompt(
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    seed_stable_pages: bool,
    connector_extras: dict[str, Any] | None = None,
) -> str:
    """System prompt for a BHAG or Area synthesis. The loop widens the read
    fence to the child dirs and combines those read-only wikis with direct
    connector sources.

    Uses the same `format_full_template()` as project-level ingest (not the
    bare `format_pages()` path/kind/title list) so a BHAG/Area synthesis run
    sees the actual charter/roadmap section structure and its per-field
    "if not found, output TBD" guidance too, instead of guessing the
    expected structure from whatever's already on disk."""
    full_templates = report_schema.full_template_snapshot()
    top_level = format_full_template(full_templates.get(report_schema.SCOPE_TOP_LEVEL, []))
    connector_extras = connector_extras or {}
    connector_blocks: list[str] = []
    citation_blocks: list[str] = []
    research_blocks: list[str] = []
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        connector_blocks.append(
            connector.system_prompt_block(
                sources,
                extra_data=connector_extras.get(connector.slug),
            )
        )
        citation = connector.citation_guidance(sources)
        if citation:
            citation_blocks.append(citation)
        research = connector.deep_research_guidance(sources)
        if research:
            research_blocks.append(research)
    connector_section = "\n\n".join(connector_blocks)

    write_root = project_root(snapshot.project_id)
    entity_kind = "Area" if snapshot.project_type == "area" else "BHAG"
    tag_hint = (
        "tag projects to this Area from their Settings, under Area"
        if snapshot.project_type == "area"
        else "tag projects to this BHAG from their Settings, under BHAG / Initiatives"
    )
    children = snapshot.child_projects or []
    if children:
        child_lines = "\n".join(
            f"- {c.name or c.slug or c.project_id} (`{c.slug or c.project_id}`): "
            f"`{project_root(c.project_id)}/`"
            for c in children
        )
        children_block = (
            f"YOUR WRITE ROOT (this {entity_kind}'s own wiki, also your cwd): `{write_root}`. "
            "Every Write/Edit path must be relative to THIS root — never absolute, "
            "and never one of the child paths below even though they look like "
            "real, writable project directories.\n\n"
            f"PROJECTS UNDER THIS {entity_kind.upper()} — read their wikis at these absolute paths "
            "(READ-ONLY: you may Read/Glob/Grep them, but writing here is never "
            f"allowed — only `{write_root}` is writable):\n\n"
            f"{child_lines}\n\n"
            "Each child's pages are markdown files DIRECTLY in its directory — there "
            "is NO `wiki/` subfolder (e.g. `/project/<id>/overview.md`, not "
            "`/project/<id>/wiki/overview.md`). DISCOVER before reading: for each "
            "child, run `Glob` with pattern `<that-path>/*.md` to list its actual "
            "pages, THEN Read the ones that matter (overview, status, standup, "
            "charter). Also Glob `<that-path>/issues/*.md` and "
            "`<that-path>/decisions/*.md`; read every entry whose frontmatter "
            "priority is `critical`, including resolved/accepted/rejected entries "
            "so the strategic view reflects lifecycle outcomes. Do NOT guess "
            "filenames or retry the same path. Skip a child "
            "whose Glob returns nothing — its wiki is empty.\n\n"
            "Then synthesize across the children — shared themes, cross-project "
            "progress, risks, and how each project ladders up to this goal. GROUND "
            "every statement in what a child wiki actually says and cite the child by "
            "name. Never invent project status; if few children have content, write a "
            "short honest synthesis over the ones that do."
        )
    else:
        children_block = (
            f"YOUR WRITE ROOT (this {entity_kind}'s own wiki, also your cwd): `{write_root}`.\n\n"
            f"NO PROJECTS ARE TAGGED TO THIS {entity_kind.upper()} YET. "
            "Do not invent child projects "
            "or their status. Use the directly attached sources below when present; "
            "otherwise write only what the charter/seed context supports. In either "
            "case, "
            f"note in overview.md that no projects are tagged yet ({tag_hint})."
        )

    stable_paths = ", ".join(f"`{p}`" for p in report_schema.default_stable_paths())
    if not is_greenfield:
        mode_block = (
            "MODE: INCREMENTAL SYNTHESIS. Re-read the child wikis and your existing "
            "pages; refresh the attached direct sources; rewrite the dynamic/report "
            "pages to reflect the current combined state. Preserve stable/hidden "
            "pages (human-owned)."
        )
    elif seed_stable_pages:
        mode_block = (
            "MODE: GREENFIELD SYNTHESIS, STABLE-PAGE SEEDING ENABLED. The team opted in "
            f"to a best-effort agent draft of the stable pages ({stable_paths}). For "
            "EACH: Read it, then OVERWRITE with a draft synthesized from the child "
            "projects and attached sources — fill the existing `## section` headers, "
            "keep the YAML frontmatter + kind. Begin each stable page body with a "
            "one-line italic note marking it an agent draft for human review. Also "
            "write the dynamic/report/hidden pages."
        )
    else:
        mode_block = (
            "MODE: GREENFIELD SYNTHESIS. The stable pages "
            f"({stable_paths}) are pre-created and human-owned — do NOT write or "
            "overwrite them. Write the dynamic/report/hidden pages from the "
            "child wikis and attached sources, with each page's declared kind in "
            "the YAML frontmatter."
        )

    is_area = snapshot.project_type == "area"
    if is_area:
        entity_header = (
            f'THIS IS AN AREA: "{snapshot.name}" — a mid-tier grouping that spans '
            "multiple projects. Its wiki is synthesized from the projects tagged to "
            "it plus the directly attached sources listed below."
        )
    else:
        entity_header = (
            f'THIS IS A BHAG (Big Hairy Audacious Goal): "{snapshot.name}" — a strategic '
            "goal that spans multiple projects. Its wiki is synthesized from the "
            "projects tagged to it plus the directly attached sources listed below."
        )

    charter_label = "AREA CONTEXT" if is_area else "BHAG CHARTER"
    project_block = f"""{entity_header}

{charter_label} (seed context, may be empty):
{snapshot.charter or "(empty)"}

{children_block}

TOP-LEVEL PAGES (cross-cutting). Each `<page>` below is one page's own
template/seed body — treat them as separate, self-contained units, not one
continuous document:

<top_level_pages>
{top_level}
</top_level_pages>

DIRECTLY ATTACHED SOURCES:

{connector_section}

{mode_block}"""

    if citation_blocks:
        project_block += "\n\n" + "\n\n".join(citation_blocks)
    if research_blocks:
        project_block += "\n\n" + "\n\n".join(research_blocks)

    return f"{prompts.load('INGEST')}\n\n---\n\n{project_block}"


async def stream_synthesis(
    *,
    run_id: UUID,
    seed: str | None,
    connector_data: dict[str, Any],
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    report_id: UUID,
    seed_stable_pages: bool = False,
    experiment: ExperimentRunContext | None = None,
) -> AsyncIterator[IngestEventPayload]:
    """Run a BHAG synthesis as a Claude Agent SDK loop. Yields IngestEvents the
    agent's HTTP handler writes to the SSE response."""
    log_buf: list[IngestEventPayload] = []
    if experiment is not None:
        templates, template_versions = experiment.template_overrides, {}
    else:
        fetched = await asyncio.to_thread(http_client.fetch_page_templates)
        templates, template_versions = fetched if fetched is not None else (None, {})
    report_schema.set_template_overrides(templates, template_versions)
    models = (
        {
            "synthesize": {
                "model": experiment.model,
                "source": "experiment",
                "scope_kind": "exact",
                "scope_id": experiment.experiment_id,
            }
        }
        if experiment is not None
        else await asyncio.to_thread(
            http_client.fetch_model_config, snapshot.project_id, snapshot.project_type
        )
    )
    http_client.set_model_overrides(models)
    connector_extras = (
        {} if experiment is not None else await resolve_connector_extras(snapshot, connector_data)
    )

    async def on_write(page_path: str, byte_count: int) -> None:
        log_buf.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": byte_count, "ts": now_iso()},
            )
        )

    # Widen the read fence to the child projects' on-disk wikis (read-only).
    child_read_dirs = [project_root(c.project_id) for c in (snapshot.child_projects or [])]

    model_provenance = http_client.resolve_model_with_provenance(
        "synthesize",
        SYNTHESIS_MODEL_DEFAULT,
        ("TTT_INGEST_MODEL",),
    )
    system_prompt = _build_synthesis_system_prompt(
        snapshot,
        is_greenfield,
        seed_stable_pages,
        connector_extras,
    )
    if experiment is not None:
        manifest = "\n".join(
            f"- {item.canonical_uri} sha256:{item.content_hash}"
            for item in experiment.frozen_evidence
        )
        system_prompt += (
            "\n\n---\n\nFROZEN EXPERIMENT EVIDENCE\n"
            "This synthesis is offline. Read only the materialized frozen "
            "workspace and child evidence; never call or infer live sources. "
            "Use TBD/unknown/not found for evidence gaps. Manifest:\n"
            f"{manifest or '- no non-page evidence items'}"
        )
        if experiment.evaluation_mode == "quick":
            targets = ", ".join(f"`{path}`" for path in experiment.evaluation_page_paths)
            system_prompt += (
                "\n\nQUICK PAGE EVALUATION: synthesize only "
                f"{targets}. Read only the frozen inputs needed for those pages, do not "
                "edit any other page, and stop when the selected pages are complete."
            )
    options = build_agent_options(
        snapshot=snapshot,
        system_prompt=system_prompt,
        model=model_provenance["model"],
        max_turns=experiment.turn_limit if experiment is not None else MAX_TURNS,
        persist_author="ttt-synthesis",
        report_id=report_id,
        on_write=on_write,
        extra_read_dirs=child_read_dirs,
        offline=experiment is not None,
        max_budget_usd=experiment.max_budget_usd if experiment is not None else None,
        expected_template_pages=expected_template_pages(snapshot),
    )

    entity_kind = "Area" if snapshot.project_type == "area" else "BHAG"
    if experiment is not None and experiment.evaluation_mode == "quick":
        targets = ", ".join(f"`{path}`" for path in experiment.evaluation_page_paths)
        prompt_parts = [
            (
                f'Synthesize only {targets} for "{snapshot.name}". Read only the frozen '
                "project and child evidence needed for those pages. Do not inspect or edit "
                "unrelated pages, and stop when the targets are complete. Ground every claim."
            )
        ]
    else:
        prompt_parts = [
            (
                f"Run a {'GREENFIELD' if is_greenfield else 'INCREMENTAL'} "
                f'{entity_kind} synthesis for "{snapshot.name}". Begin by reading '
                "your own existing wiki pages, then read the wikis of the child "
                "projects at the paths listed in the system prompt, investigate the "
                + (
                    "frozen child and source evidence, and synthesize this "
                    if experiment is not None
                    else "directly attached sources, and synthesize this "
                )
                + f"{entity_kind}'s "
                "pages. Ground everything in those inputs — do not invent."
            )
        ]
    if experiment is not None:
        prompt_parts.append(
            "\n\nREPRODUCIBLE RUN IDENTITY: "
            f"{experiment.experiment_id}; seed={experiment.seed}. "
            "Use the seed only for stable ordering choices."
        )
    if seed and seed.strip():
        prompt_parts.append(
            "\n\nUSER SEED INSTRUCTION (one-shot focus for this run):\n"
            f"{seed.strip()}"
        )
    for connector in (() if experiment is not None else REGISTRY):
        extension = connector.prompt_extension(
            connector_extras.get(connector.slug)
        )
        if extension:
            prompt_parts.append(extension)
    prompt = "".join(prompt_parts)

    child_count = len(snapshot.child_projects or [])
    synthesis_kind = "Area" if snapshot.project_type == "area" else "BHAG"
    yield emit_log(
        f"▶ {synthesis_kind} synthesis started "
        f"(mode={'greenfield' if is_greenfield else 'incremental'}, "
        f"projects={child_count}, model={_synthesis_model()})"
    )
    for connector in (() if experiment is not None else REGISTRY):
        sources = sources_for_connector(snapshot, connector)
        for line in connector.log_lines(
            sources, connector_extras.get(connector.slug)
        ):
            yield emit_log(line)
    if seed and seed.strip():
        yield emit_log(f"· seed: {seed.strip()[:200]}")

    async for event in consume_agent_query(
        prompt, options, log_buf, model_provenance=model_provenance
    ):
        yield event
