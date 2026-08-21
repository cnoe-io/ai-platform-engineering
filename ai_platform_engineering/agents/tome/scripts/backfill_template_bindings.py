#!/usr/bin/env python3
"""One-time backfill for #488: stamp `template_scope`/`template_path`/
`template_version` frontmatter onto every existing page that predates the
binding.

Why this is needed: `ingestor.py`/`synthesize.py` now run
`report_schema.reconcile_template_bindings` unconditionally on every ingest
(the same deterministic, code-owned pattern as `write_verbatim_pages` for
`.tome/pages/*.md` mirrors) — so any page still unbound gets fixed on its
project's very next ingest. But every project that existed before #488
shipped needs at least one more ingest to reach that state, and a
rarely-touched project could go a long time before that happens on its own.
This script is a one-time sweep so the drift report is meaningful everywhere
immediately, not just after the fact.

This is mechanical and idempotent (safe to re-run), never calls an LLM, and
never rewrites a page's body — same logic as the automatic per-ingest pass:

- Pages with no `template_scope` frontmatter at all, whose CURRENT on-disk
  path matches a live template path, are stamped with that binding.
  `template_version` is deliberately set to 0 (the template's baseline),
  NOT the scope's current live version — we have no record of when the page
  was actually seeded, and assuming "current" would silently hide any real
  drift that happened before this backfill ran. Assuming 0 means the very
  next "Check for template drift" surfaces real version-behind/content
  drift for anything whose template has since been admin-edited, rather
  than hiding it.
- Pages that don't match any template path get `template_scope: null`
  (explicitly marked unbound, not "never checked").
- Pages that already carry a `template_scope` key (already migrated, or
  written after #488 shipped) are left untouched — safe to re-run.

Run from the `tome` agent's own directory so `tome_agent` resolves, with
TTT_BACKEND_URL/TTT_AGENT_TOKEN pointed at the target deployment (same env
vars the running agent container uses):

    cd ai_platform_engineering/agents/tome
    TTT_BACKEND_URL=... TTT_AGENT_TOKEN=... uv run python scripts/backfill_template_bindings.py --dry-run
    TTT_BACKEND_URL=... TTT_AGENT_TOKEN=... uv run python scripts/backfill_template_bindings.py
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from uuid import uuid4

_HERE = Path(__file__).parent
_TOME_AGENT_ROOT = _HERE.parent
sys.path.insert(0, str(_TOME_AGENT_ROOT))

from tome_agent.agent import http_client  # noqa: E402
from tome_agent.agent.ingestor import expected_template_pages  # noqa: E402
from tome_agent.reports import schema as report_schema  # noqa: E402

log = logging.getLogger("backfill_template_bindings")

MIGRATION_AUTHOR = "tome-migration-488"


async def backfill_project(project_id: str, *, dry_run: bool) -> tuple[int, int]:
    """Returns (pages_stamped, pages_already_bound). Uses the same
    `report_schema.reconcile_template_bindings` the ingest loop now runs
    automatically every run (see loop.py) — this script's only job is a
    one-time sweep for pages that predate that automatic pass ever existing."""
    http_client.set_active_project_id(project_id)
    snapshot = await http_client.fetch_snapshot()
    pages = await asyncio.to_thread(http_client.fetch_all_pages_sync, project_id)
    expected = expected_template_pages(snapshot)

    changed = report_schema.reconcile_template_bindings(pages, expected)
    already_bound = len(pages) - len(changed)
    for path, new_markdown in changed.items():
        fm, _ = report_schema.parse_frontmatter(new_markdown)
        scope = fm.get(report_schema.FM_TEMPLATE_SCOPE)
        if scope is None:
            log.info("  %s -> unbound (no matching template path)", path)
        else:
            log.info(
                "  %s -> bound to %s/%s @ v%s",
                path, scope, fm.get(report_schema.FM_TEMPLATE_PATH), fm.get(report_schema.FM_TEMPLATE_VERSION),
            )
        if dry_run:
            continue
        await http_client.write_page(
            page_path=path,
            body=new_markdown,
            message=f"{MIGRATION_AUTHOR}: backfill #488 template binding (metadata only)",
            author=MIGRATION_AUTHOR,
            report_id=uuid4(),
            project_id=project_id,
        )
    return len(changed), already_bound


async def main(dry_run: bool) -> None:
    fetched = await asyncio.to_thread(http_client.fetch_page_templates)
    templates, versions = fetched if fetched is not None else (None, {})
    report_schema.set_template_overrides(templates, versions)

    projects = await asyncio.to_thread(http_client.fetch_all_projects)
    log.info("found %d project(s)%s", len(projects), " (dry run)" if dry_run else "")

    total_stamped = total_already_bound = 0
    failures: list[str] = []
    for project in projects:
        project_id = project.get("project_id")
        if not project_id:
            continue
        label = project.get("slug") or project_id
        try:
            stamped, already_bound = await backfill_project(project_id, dry_run=dry_run)
        except Exception:
            log.exception("backfill failed for project %s", label)
            failures.append(label)
            continue
        total_stamped += stamped
        total_already_bound += already_bound
        log.info(
            "%s: stamped %d page(s), %d already bound",
            label, stamped, already_bound,
        )

    log.info(
        "done: %d page(s) stamped, %d already bound, across %d project(s)%s",
        total_stamped, total_already_bound, len(projects),
        f" — {len(failures)} project(s) failed: {failures}" if failures else "",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="log what would change without writing anything"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(main(dry_run=args.dry_run))
