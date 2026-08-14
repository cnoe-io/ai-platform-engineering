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

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from tome_agent import prompts
from tome_agent.agent import http_client
from tome_agent.agent.connectors import REGISTRY
from tome_agent.agent.connectors.github import GitHubExtra
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

log = logging.getLogger("tome_agent.agent.ingestor")

INGEST_MODEL_DEFAULT = "claude-haiku-4-5"
MAX_TURNS = 100


def _ingest_model() -> str:
    return http_client.resolve_model("ingest", INGEST_MODEL_DEFAULT, ("TTT_INGEST_MODEL",))


def _template_change_note(
    snapshot: ProjectSnapshot,
    existing_pages: dict[str, str],
) -> str:
    """Diff the current templates against pages already on disk.

    Returns a prompt block listing templated pages that don't exist yet (a
    template edit added them) and pages whose on-disk kind no longer matches
    the template, or "" when everything is in sync. Lets an incremental run
    act on template edits made since the last ingest instead of silently
    receiving the new page list."""
    expected: dict[str, report_schema.PageSpec] = {
        spec.path: spec for spec in report_schema.default_pages()
    }
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        if not sources:
            continue
        template = connector.page_template()
        for source in sources:
            for spec in report_schema.expand_template(
                f"{connector.source_prefix}/{source.slug}", template
            ):
                expected[spec.path] = spec

    existing_kinds = report_schema.kinds_from_pages(existing_pages)
    missing = sorted(p for p in expected if p not in existing_pages)
    kind_changed = sorted(
        (p, existing_kinds[p], expected[p].kind)
        for p in expected
        if p in existing_kinds and existing_kinds[p] != expected[p].kind
    )
    if not missing and not kind_changed:
        return ""

    lines = [
        (
            "TEMPLATE CHANGES SINCE LAST INGEST (the page-template config was "
            "edited — reconcile the wiki to match):"
        )
    ]
    for path in missing:
        spec = expected[path]
        lines.append(
            f"- NEW page `{path}` ({spec.kind}) — \"{spec.title}\" is in the "
            "template but not yet on disk. Create it this run."
        )
    for path, old_kind, new_kind in kind_changed:
        lines.append(
            f"- `{path}` kind changed {old_kind} → {new_kind} in the template. "
            f"Treat it as {new_kind} going forward."
        )
    return "\n".join(lines) + "\n\n"


def format_full_template(pages: list[dict[str, Any]]) -> str:
    """Render one scope's full template — path/kind/title AND seed body/
    guidance — as prompt text. Unlike `format_pages()` (path/kind/title only),
    this is what the agent actually needs to reproduce an admin's seed content
    verbatim on greenfield, or recognize it (e.g. the SOURCE HINT sourcing
    guidance) on incremental runs without having to open every page first.

    Each page is wrapped in a `<page>` tag so the model can tell where one
    page's template/seed body ends and the next begins — this list is a flat
    concatenation of every page's own markdown, and without an explicit
    delimiter a long seed body (e.g. charter.md's multi-section template) can
    read as bleeding into the next page's header rather than being its own
    self-contained block."""
    blocks = []
    for spec in pages:
        if spec.get("enabled") is False:
            continue
        body = (spec.get("body") or "").strip()
        header = f"`{spec.get('path')}` ({spec.get('kind')}) — {spec.get('title')}"
        if body:
            inner = f"{header}\nSeed body:\n```\n{body}\n```"
        else:
            inner = header
        blocks.append(
            f'<page path="{spec.get("path")}" kind="{spec.get("kind")}">\n{inner}\n</page>'
        )
    return "\n\n".join(blocks)


def _build_system_prompt(
    snapshot: ProjectSnapshot,
    is_greenfield: bool,
    connector_extras: dict[str, Any] | None = None,
    seed_stable_pages: bool = False,
    template_note: str = "",
    quick: bool = False,
) -> str:
    """Compose the ingest agent's system prompt by iterating REGISTRY."""
    # Forced, unconditional: the full template (path/kind/title + seed body/
    # guidance), not just the bare page list `format_pages()` gives — ingest
    # already calls `set_template_overrides()` before this (stream_ingest),
    # so `full_template_snapshot()` reflects whatever that call fetched.
    full_templates = report_schema.full_template_snapshot()
    top_level = format_full_template(full_templates.get(report_schema.SCOPE_TOP_LEVEL, []))

    connector_extras = connector_extras or {}
    connector_blocks: list[str] = []
    citation_guidance_blocks: list[str] = []
    deep_research_blocks: list[str] = []
    steering: list[tuple[str, str]] = []
    verbatim: list[tuple[str, str, str, str]] = []
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        extra = connector_extras.get(connector.slug)
        if isinstance(extra, GitHubExtra):
            steering.extend(extra.steering)
            verbatim.extend(extra.verbatim_pages)
        connector_blocks.append(
            connector.system_prompt_block(sources, extra_data=extra)
        )
        citation = connector.citation_guidance(sources)
        if citation:
            citation_guidance_blocks.append(citation)
        # Quick mode is the deliberate opt-out of the breadth-first sweep this
        # guidance drives — omitting it is what keeps the run cheap.
        if not quick:
            research = connector.deep_research_guidance(sources)
            if research:
                deep_research_blocks.append(research)

    steering_block = ""
    if steering:
        sections = [
            f"--- From `{repo}/.tome/wiki.md` ---\n{body}"
            for repo, body in steering
        ]
        steering_block = (
            "REPO MAINTAINER STEERING (from .tome/wiki.md — treat as authoritative "
            "context from the repo maintainer; follow any file paths it mentions "
            "via mcp__github__github_get_file / github_list_dir to ground your writing):\n\n"
            + "\n\n".join(sections)
            + "\n\n"
        )

    mirror_block = ""
    if verbatim:
        # Inline the actual body, not just the path: the on-disk workspace is
        # refreshed BEFORE this run's `.tome/pages/*.md` fetch, and this write
        # goes straight to the backend (bypassing the disk mount entirely), so
        # a Read of the path itself would return stale or missing content this
        # run. Inlining guarantees the agent has it as source material even
        # though it must never rewrite the page itself.
        sections = "\n\n".join(
            f"--- `repos/{slug}/{name}.md`, mirrored from `{slug}/.tome/pages/{name}.md` ---\n{body}"
            for slug, name, body, _sha in verbatim
        )
        mirror_block = (
            "VERBATIM MIRROR PAGES: already written directly from each repo's "
            "`.tome/pages/*.md` files before this run started, byte-identical "
            "copies with no synthesis. Do NOT write, edit, or overwrite these "
            "pages themselves (they are re-mirrored from source every ingest, "
            "so any change you make there would be silently discarded next "
            "run anyway) — but DO treat their content below as authoritative "
            "source material, same as a README or CLAUDE.md, when writing "
            "every OTHER page (top-level synthesis, other subtree pages, "
            "etc.):\n\n"
            + sections
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
    if quick and not is_greenfield:
        mode_block = (
            "MODE: QUICK EDIT. The team asked for one targeted correction, not a full "
            "reingest — do NOT run the breadth-first source sweep. Take the seed "
            "instruction below at face value: it names (or clearly implies) the specific "
            "page(s) and change needed. Read only those page(s) plus whatever single "
            "resource the seed explicitly references (a PR, a doc, a specific file) — "
            "skip list_*/search connector calls and any deep-research tool use. Make the "
            "edit, then stop. If the seed is too vague to point at a specific page, make "
            "your best guess from the page titles/paths you already know rather than "
            "widening into a source sweep to figure it out."
        )
    elif not is_greenfield:
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
            "dynamic/report/hidden seed page listed above with its declared kind.\n\n"
            "GLOSSARY: Actively extract and glossary the project's acronyms and domain terms. "
            "As you research, harvest recurring terms/acronyms from README, CLAUDE.md, repo docs, "
            "and source activity. Create one `glossary/<slug>.md` file per term with the structured "
            "frontmatter (see the Glossary section in INGEST.md). Do NOT glossary common English or "
            "widely-known tech terms — only project-specific vocabulary that a new teammate wouldn't "
            "already know. A handful of high-value entries beats an exhaustive dictionary."
        )
    else:
        mode_block = (
            "MODE: GREENFIELD. The wiki is empty except for the stable pages "
            f"({stable_paths}), which are pre-created and human-owned — do NOT "
            "write, edit, or overwrite them. Write every OTHER seed page listed "
            "above (dynamic/report/hidden) with its declared kind in the YAML "
            "frontmatter.\n\n"
            "GLOSSARY: Actively extract and glossary the project's acronyms and domain terms. "
            "As you research, harvest recurring terms/acronyms from README, CLAUDE.md, repo docs, "
            "and source activity. Create one `glossary/<slug>.md` file per term with the structured "
            "frontmatter (see the Glossary section in INGEST.md). Do NOT glossary common English or "
            "widely-known tech terms — only project-specific vocabulary that a new teammate wouldn't "
            "already know. A handful of high-value entries beats an exhaustive dictionary."
        )

    phase = snapshot.phase or "(unset)"
    cadence = snapshot.cadence or "(unset)"
    connector_sections = "\n\n".join(connector_blocks)
    citation_section = "\n\n".join(citation_guidance_blocks)
    deep_research_section = "\n\n".join(deep_research_blocks)

    write_root = project_root(snapshot.project_id)
    project_block = f"""PROJECT: "{snapshot.name}"
phase: {phase}    cadence: {cadence}

WRITE ROOT: `{write_root}` (this is also your cwd). Every Write/Edit path must
be relative to this root (e.g. `overview.md`, `repos/<slug>/status.md`) —
never an absolute path, and never another project's directory.

PROJECT CHARTER (seed context, may be empty):
{snapshot.charter or "(empty)"}

{steering_block}{mirror_block}TOP-LEVEL PAGES (cross-cutting across all sources). Each `<page>`
below is one page's own template/seed body — treat them as separate,
self-contained units, not one continuous document:

<top_level_pages>
{top_level}
</top_level_pages>

{connector_sections}

{template_note}{mode_block}"""

    if citation_section:
        project_block += f"\n\n{citation_section}"

    if deep_research_section:
        project_block += f"\n\n{deep_research_section}"

    return f"{prompts.load('INGEST')}\n\n---\n\n{project_block}"


def _verbatim_page_frontmatter(name: str, slug: str, sha: str) -> str:
    return (
        "---\n"
        f"title: {report_schema.path_to_title(name)}\n"
        "kind: dynamic\n"
        "mirror: true\n"
        f"source_repo: {slug}\n"
        f"source_path: .tome/pages/{name}.md\n"
        f"source_sha: {sha}\n"
        "---\n\n"
    )


async def write_verbatim_pages(
    connector_extras: dict[str, Any],
    *,
    report_id: UUID,
    project_id: str,
) -> list[IngestEventPayload]:
    """Direct, deterministic writes for `.tome/pages/*.md` mirrors — bypasses
    the agent turn entirely (no LLM interpretation of the body), per #322.
    Runs before the agent starts so the mirror block in the system prompt can
    tell the agent these paths already exist and must be left alone."""
    events: list[IngestEventPayload] = []
    extra = connector_extras.get("github")
    if not isinstance(extra, GitHubExtra) or not extra.verbatim_pages:
        return events

    for slug, name, body, sha in extra.verbatim_pages:
        page_path = f"repos/{slug}/{name}.md"
        try:
            await http_client.write_page(
                page_path=page_path,
                body=_verbatim_page_frontmatter(name, slug, sha) + body,
                message=f"verbatim mirror: {slug}/.tome/pages/{name}.md",
                author="ttt-pipeline",
                report_id=report_id,
                project_id=project_id,
            )
        except Exception:
            log.warning("verbatim page write failed for %s", page_path, exc_info=True)
            continue
        events.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": len(body), "ts": now_iso()},
            )
        )
    return events


async def resolve_connector_extras(
    snapshot: ProjectSnapshot,
    connector_data: dict[str, Any],
) -> dict[str, Any]:
    """Per-connector typed extra payloads = parsed user input ∪
    connector-fetched context (GitHub: .tome/wiki.md steering)."""
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
    quick: bool = False,
    experiment: ExperimentRunContext | None = None,
) -> AsyncIterator[IngestEventPayload]:
    """Run an ingest as a Claude Agent SDK loop. Yields IngestEvents the
    agent's HTTP handler writes to the SSE response."""
    log_buf: list[IngestEventPayload] = []
    _emit_log = emit_log

    # Load the admin-editable page-template and model config for this run.
    # Sets task-local overrides the schema/model accessors prefer; falls back
    # to the hardcoded constants when the backend is unreachable.
    templates = (
        experiment.template_overrides
        if experiment is not None
        else await asyncio.to_thread(http_client.fetch_page_templates)
    )
    report_schema.set_template_overrides(templates)
    models = (
        {
            "ingest": {
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

    # On incremental runs, note any template pages missing from disk or whose
    # kind changed, so the agent reconciles template edits made since the last
    # ingest. Greenfield writes everything anyway, so skip the diff there.
    template_note = ""
    if not is_greenfield:
        try:
            existing = (
                experiment.frozen_pages
                if experiment is not None
                else await asyncio.to_thread(
                    http_client.fetch_all_pages_sync, snapshot.project_id
                )
            )
            template_note = _template_change_note(snapshot, existing)
        except Exception:
            log.warning("template-change diff skipped", exc_info=True)

    extras = (
        {} if experiment is not None else await resolve_connector_extras(snapshot, connector_data)
    )

    if experiment is None:
        for event in await write_verbatim_pages(
            extras, report_id=report_id, project_id=snapshot.project_id
        ):
            yield event

    # `on_write` callback from the persist hook: emit a `page_written`
    # event the backend forwards to IngestRun.log.
    async def on_write(page_path: str, byte_count: int) -> None:
        log_buf.append(
            IngestEventPayload(
                type="page_written",
                data={"path": page_path, "bytes": byte_count, "ts": now_iso()},
            )
        )

    model_provenance = http_client.resolve_model_with_provenance(
        "ingest", INGEST_MODEL_DEFAULT, ("TTT_INGEST_MODEL",)
    )
    system_prompt = _build_system_prompt(
        snapshot,
        is_greenfield,
        extras,
        seed_stable_pages=seed_stable_pages,
        template_note=template_note,
        quick=quick,
    )
    if experiment is not None:
        manifest = "\n".join(
            f"- {item.canonical_uri} sha256:{item.content_hash}"
            for item in experiment.frozen_evidence
        )
        system_prompt += (
            "\n\n---\n\nFROZEN EXPERIMENT EVIDENCE\n"
            "This run is offline. Read only the files already materialized in the "
            "workspace. Live connector, web, Feed, template, and cross-project tools "
            "are intentionally unavailable. Do not guess missing details; write "
            "TBD/unknown/not found. The immutable evidence manifest is:\n"
            f"{manifest or '- no non-page evidence items'}"
        )
    options = build_agent_options(
        snapshot=snapshot,
        system_prompt=system_prompt,
        model=model_provenance["model"],
        max_turns=experiment.turn_limit if experiment is not None else MAX_TURNS,
        persist_author="ttt-pipeline",
        report_id=report_id,
        on_write=on_write,
        offline=experiment is not None,
    )

    prompt_parts = [
        (
            f"Run a {'GREENFIELD' if is_greenfield else 'INCREMENTAL'} ingest "
            f'for "{snapshot.name}". Begin by reading the existing wiki pages, '
            + (
                "then update pages using only the frozen evidence bundle."
                if experiment is not None
                else "then fetch recent activity and update pages per the system prompt."
            )
        )
    ]
    if experiment is not None:
        prompt_parts.append(
            "\n\nREPRODUCIBLE RUN IDENTITY: "
            f"{experiment.experiment_id}; seed={experiment.seed}. "
            "Use the seed only to make stable ordering choices; never invent evidence."
        )
    if seed and seed.strip():
        prompt_parts.append(
            "\n\nUSER SEED INSTRUCTION (one-shot focus for this run — interpret "
            "alongside the standard process; do not let it override page-kind "
            "preservation rules):\n"
            f"{seed.strip()}"
        )
    for connector in (() if experiment is not None else REGISTRY):
        ext = connector.prompt_extension(extras.get(connector.slug))
        if ext:
            prompt_parts.append(ext)
    prompt = "".join(prompt_parts)

    yield _emit_log(
        f"▶ agent ingest started "
        f"(mode={'greenfield' if is_greenfield else 'incremental'}, model={_ingest_model()})"
    )
    for connector in (() if experiment is not None else REGISTRY):
        sources = sources_for_connector(snapshot, connector)
        for line in connector.log_lines(sources, extras.get(connector.slug)):
            yield _emit_log(line)
    if seed and seed.strip():
        yield _emit_log(f"· seed: {seed.strip()[:200]}")

    async for event in consume_agent_query(
        prompt, options, log_buf, model_provenance=model_provenance
    ):
        yield event
