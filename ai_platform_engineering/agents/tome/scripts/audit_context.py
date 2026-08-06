#!/usr/bin/env python3
"""Assemble the real ingest and BHAG/Area-synthesis system prompts against a
representative fixture project, and report their size broken down by source
(base doctrine / per-connector blocks / citation guidance / deep-research
guidance / steering / skills / CLAUDE.md / AGENTS.md).

Run from the `tome` agent's own directory so `tome_agent` resolves:

    cd ai_platform_engineering/agents/tome
    uv run python scripts/audit_context.py
    uv run python scripts/audit_context.py --baseline scripts/audit_baseline.json
    uv run python scripts/audit_context.py --save-baseline scripts/audit_baseline.json

The ingest/chat agent's starting context is assembled from several
independently-edited sources with no single place that shows the assembled
result or flags growth. This script is that place.

It reuses the same prompt-builder functions the agent calls at request time
(`ingestor._build_system_prompt`, `synthesize._build_synthesis_system_prompt`)
against a synthetic fixture, so its output tracks the real prompt text —
not a hand-maintained approximation of it.

Skills and CLAUDE.md/AGENTS.md are NOT audited against this monorepo by
default — the deployed tome-agent container has no `.claude/skills/` of its
own (see Dockerfile) and its cwd at runtime is a per-project working tree
(`/project/<id>/`), not this checkout. Set `TOME_AGENT_SKILLS_DIR` to a real
container/image skills path if you need to audit that; otherwise the skills
section reports the omission rather than measuring the wrong directory.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).parent
_TOME_AGENT_ROOT = _HERE.parent
sys.path.insert(0, str(_TOME_AGENT_ROOT))

from tome_agent.agent.connectors import REGISTRY  # noqa: E402
from tome_agent.agent.ingestor import _build_system_prompt  # noqa: E402
from tome_agent.agent.loop import sources_for_connector  # noqa: E402
from tome_agent.agent.synthesize import _build_synthesis_system_prompt  # noqa: E402
from tome_agent.orchestrator.contract import (  # noqa: E402
    ChildProjectSnapshot,
    ConfluenceSpaceSnapshot,
    ProjectSnapshot,
    RepoSnapshot,
    WebexRoomSnapshot,
)

# The running tome-agent container has no `.claude/skills/` of its own — the
# Dockerfile only creates an empty `/home/agent/.claude/` and copies in
# `tome_agent/`. `skills: "all"` (loop.py) resolves against the SDK's
# `setting_sources=["project","local"]` at the agent's cwd, which in the
# container is the per-request project working dir (`/project/<id>/`), NOT
# this monorepo's `.claude/skills/` — checking the monorepo's skills dir here
# would measure a directory the deployed agent never sees. Point this at
# `TOME_AGENT_SKILLS_DIR` if you want to audit skills baked into a specific
# image/volume; absent that, report the omission rather than guessing.
_SKILLS_DIR = Path(os.environ["TOME_AGENT_SKILLS_DIR"]) if os.environ.get(
    "TOME_AGENT_SKILLS_DIR"
) else None
_REPO_ROOT = _TOME_AGENT_ROOT.parent.parent.parent

# Rough chars-per-token estimate for a quick, dependency-free size signal.
# Not exact (no tokenizer dependency in this agent), good enough to flag
# order-of-magnitude growth between runs.
_CHARS_PER_TOKEN = 4

# Skill directory names judged relevant to Tome/wiki/ingest work. Anything
# else pulled in by `skills: "all"` is flagged as likely-irrelevant context
# bloat for this specific agent.
_TOME_RELEVANT_SKILL_KEYWORDS = ("tome", "wiki", "ingest", "confluence", "mycelium")


def _fixture_snapshot(project_type: str = "project") -> ProjectSnapshot:
    """A representative project with one source of each connector type, so
    every connector's system_prompt_block/citation_guidance/deep_research_
    guidance renders its real (non-empty-source) text rather than the
    shorter "no sources of this type" branch."""
    return ProjectSnapshot(
        project_id="audit-fixture",
        slug="audit-fixture",
        name="Audit Fixture Project",
        project_type=project_type,  # type: ignore[arg-type]
        phase="build",
        cadence="weekly",
        repos=[
            RepoSnapshot(slug="repository", url="https://github.com/example/repository"),
        ],
        confluence_spaces=[
            ConfluenceSpaceSnapshot(
                slug="example-space",
                name="Example space",
                space_key="EXAMPLE",
                base_url="https://example.atlassian.net",
            ),
        ],
        webex_rooms=[
            WebexRoomSnapshot(slug="example-room", name="Example room", room_id="room-id"),
        ],
        child_projects=(
            [ChildProjectSnapshot(project_id="child-id", slug="child-example", name="Child example")]
            if project_type in ("bhag", "area")
            else []
        ),
    )


def _chars(text: str) -> int:
    return len(text)


def _tokens_est(text: str) -> int:
    return _chars(text) // _CHARS_PER_TOKEN


def _connector_breakdown(
    snapshot: ProjectSnapshot, quick: bool = False
) -> list[dict[str, object]]:
    """Per-connector system_prompt_block / citation_guidance /
    deep_research_guidance sizes for this snapshot, mirroring exactly what
    `_build_system_prompt` / `_build_synthesis_system_prompt` assemble.

    `quick=True` mirrors ingestor.py's quick-mode branch, which omits
    deep_research_guidance entirely — that's the whole point of quick mode,
    so its accounting should reflect the omission, not just note it."""
    rows: list[dict[str, object]] = []
    for connector in REGISTRY:
        sources = sources_for_connector(snapshot, connector)
        block = connector.system_prompt_block(sources)
        citation = connector.citation_guidance(sources)
        research = "" if quick else connector.deep_research_guidance(sources)
        rows.append(
            {
                "source": f"connector:{connector.slug}",
                "chars": _chars(block) + _chars(citation) + _chars(research),
                "detail": (
                    f"prompt_block={_chars(block)} citation={_chars(citation)} "
                    f"deep_research={_chars(research)}"
                    + (" (omitted: quick mode)" if quick else "")
                ),
            }
        )
    return rows


def _skills_breakdown() -> list[dict[str, object]]:
    """What `skills: "all"` (loop.py's ClaudeAgentOptions) actually pulls in.

    The deployed tome-agent container has no `.claude/skills/` of its own
    (the Dockerfile only creates an empty `/home/agent/.claude/`), so without
    `TOME_AGENT_SKILLS_DIR` pointing at a real container/image skills path,
    there's nothing here to audit — report that explicitly rather than
    silently measuring an unrelated directory (e.g. this monorepo's own
    `.claude/skills/`, which the container never sees)."""
    if _SKILLS_DIR is None:
        return [
            {
                "source": "skills",
                "chars": 0,
                "detail": (
                    "not audited — set TOME_AGENT_SKILLS_DIR to the container's "
                    "actual skills path (none exists by default; see Dockerfile)"
                ),
            }
        ]
    rows: list[dict[str, object]] = []
    if not _SKILLS_DIR.is_dir():
        return rows
    for skill_dir in sorted(_SKILLS_DIR.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(encoding="utf-8")
        haystack = f"{skill_dir.name} {text}".lower()
        relevant = any(keyword in haystack for keyword in _TOME_RELEVANT_SKILL_KEYWORDS)
        rows.append(
            {
                "source": f"skill:{skill_dir.name}",
                "chars": _chars(text),
                "detail": "relevant to tome" if relevant else "FLAG: likely irrelevant to tome",
            }
        )
    return rows


def _claude_md_breakdown() -> list[dict[str, object]]:
    """CLAUDE.md/AGENTS.md the SDK auto-pulls in via `setting_sources`.

    `setting_sources=["project","local"]` (loop.py) resolves at the agent's
    cwd, which in the container is the per-project wiki working tree
    (`/project/<id>/`, see `project_root()` in loop.py) — NOT this monorepo
    root. A project's own `CLAUDE.md`/`AGENTS.md` (e.g. one synced in from an
    ingested GitHub repo) would only exist per-project at runtime, so this
    reports against this checkout's root as a size REFERENCE POINT only —
    it does not claim to be what any specific running project actually has."""
    rows: list[dict[str, object]] = []
    for name in ("CLAUDE.md", "AGENTS.md"):
        path = _REPO_ROOT / name
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            rows.append({"source": f"doctrine:{name}", "chars": _chars(text), "detail": str(path)})
    return rows


def _base_doctrine_breakdown() -> list[dict[str, object]]:
    from tome_agent import prompts

    rows = []
    for name in ("INGEST", "CHAT", "COMPACT"):
        try:
            text = prompts.load(name)
        except FileNotFoundError:
            continue
        rows.append({"source": f"prompts/{name}.md", "chars": _chars(text), "detail": ""})
    return rows


def _print_table(title: str, rows: list[dict[str, object]]) -> None:
    total = sum(int(r["chars"]) for r in rows)
    print(f"\n=== {title} (total {total:,} chars / ~{total // _CHARS_PER_TOKEN:,} tokens) ===")
    width = max((len(str(r["source"])) for r in rows), default=8)
    for row in sorted(rows, key=lambda r: -int(r["chars"])):
        chars = int(row["chars"])
        pct = (chars / total * 100) if total else 0
        detail = f"  {row['detail']}" if row.get("detail") else ""
        print(f"  {str(row['source']):<{width}}  {chars:>7,} chars  {pct:5.1f}%{detail}")


def _grounding_check(prompt: str, label: str) -> list[str]:
    """Flag prompts with no blanket "ground everything, never invent CONTENT"
    directive. A narrow, connector-specific "never invent a person's NAME"
    line (Webex) does not count — this checks for the general directive
    specifically, since a substring match on "never invent" alone produces a
    false negative (it matches the narrow one too). Per-field "output TBD if
    not found" comments in schema.py are not a substitute for a blanket
    directive."""
    warnings = []
    grounding_markers = (
        "ground everything in those inputs",
        "ground every claim",
        "never invent project status",
        "do not invent child projects",
        "not responsible for inventing new content",
    )
    if not any(marker in prompt.lower() for marker in grounding_markers):
        warnings.append(
            f"[{label}] no blanket content-grounding/anti-fabrication directive found. "
            "Relying solely on per-field 'output TBD if not found' comments (schema.py) "
            "and/or narrow connector-specific rules (e.g. Webex's 'never invent a name') "
            "is not a substitute for one."
        )
    return warnings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, help="Previous run's JSON to diff against")
    parser.add_argument("--save-baseline", type=Path, help="Write this run's totals as JSON")
    args = parser.parse_args()

    project_snapshot = _fixture_snapshot("project")
    bhag_snapshot = _fixture_snapshot("bhag")

    ingest_prompt = _build_system_prompt(project_snapshot, is_greenfield=True, seed_stable_pages=True)
    quick_prompt = _build_system_prompt(project_snapshot, is_greenfield=False, quick=True)
    synthesis_prompt = _build_synthesis_system_prompt(
        bhag_snapshot, is_greenfield=True, seed_stable_pages=True
    )

    ingest_rows = _base_doctrine_breakdown() + _connector_breakdown(project_snapshot)
    quick_rows = _base_doctrine_breakdown() + _connector_breakdown(project_snapshot, quick=True)
    synthesis_rows = _base_doctrine_breakdown() + _connector_breakdown(bhag_snapshot)
    skills_rows = _skills_breakdown()
    claude_md_rows = _claude_md_breakdown()

    _print_table("Ingest system prompt (per-source)", ingest_rows)
    _print_table("Quick-edit system prompt (per-source, deep-research omitted)", quick_rows)
    _print_table("BHAG/Area synthesis system prompt (per-source)", synthesis_rows)
    _print_table("Skills pulled in via skills=\"all\"", skills_rows)
    if claude_md_rows:
        _print_table(
            "This checkout's CLAUDE.md/AGENTS.md size (reference point only — "
            "a project's own files, if any, are per-project at runtime, not this repo's)",
            claude_md_rows,
        )

    totals = {
        "ingest_prompt_chars": _chars(ingest_prompt),
        "quick_prompt_chars": _chars(quick_prompt),
        "synthesis_prompt_chars": _chars(synthesis_prompt),
        "skills_chars_total": sum(int(r["chars"]) for r in skills_rows),
        "skills_irrelevant_count": sum(
            1 for r in skills_rows if "FLAG" in str(r["detail"])
        ),
        "claude_md_chars_total": sum(int(r["chars"]) for r in claude_md_rows),
    }

    print("\n=== Totals ===")
    for key, value in totals.items():
        print(f"  {key}: {value:,}")

    warnings = (
        _grounding_check(ingest_prompt, "ingest")
        + _grounding_check(quick_prompt, "quick")
        + _grounding_check(synthesis_prompt, "synthesis")
    )
    if warnings:
        print("\n=== Grounding/anti-fabrication check ===")
        for warning in warnings:
            print(f"  ! {warning}")

    if args.baseline and args.baseline.is_file():
        baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
        print(f"\n=== Diff vs {args.baseline} ===")
        for key, value in totals.items():
            old = baseline.get(key)
            if old is None:
                print(f"  {key}: {value:,} (no baseline value)")
                continue
            delta = value - old
            sign = "+" if delta >= 0 else ""
            pct = (delta / old * 100) if old else 0
            print(f"  {key}: {old:,} -> {value:,} ({sign}{delta:,}, {sign}{pct:.1f}%)")

    if args.save_baseline:
        args.save_baseline.write_text(json.dumps(totals, indent=2) + "\n", encoding="utf-8")
        print(f"\nSaved baseline to {args.save_baseline}")


if __name__ == "__main__":
    main()
