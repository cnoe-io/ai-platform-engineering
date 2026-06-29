"""Persistent multi-project workspace for the agent container.

All project wikis live on disk at `<base>/<project_id>/` at all times. The
backend (Mongo) is the source of truth; this module materializes it to disk:

- at startup (`sync_all_projects` — the initial load)
- periodically (`sync_loop`), catching new projects and UI edits
- on demand before an ingest (`refresh_project`, under the project lock)

Writers (ingest) serialize per-project via `project_lock`; the periodic sync
respects the same lock so it never overwrites a project mid-run. The sync is
one-directional (backend → disk): it never writes back, so it creates no page
revisions — only the agent's persist hook and human edits do that.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from pathlib import Path

from tome_agent.agent import http_client
from tome_agent.agent.loop import project_root

log = logging.getLogger("tome_agent.agent.workspace")

# One lock per project_id, created lazily. Module scope so it's shared across
# all requests in the (multi-project) container.
_project_locks: "defaultdict[str, asyncio.Lock]" = defaultdict(asyncio.Lock)


def project_lock(project_id: str) -> asyncio.Lock:
    """The per-project write lock. An ingest holds it for its whole run so two
    runs for the same project can't stomp each other's edits, and the periodic
    sync skips any project whose lock is currently held."""
    return _project_locks[project_id]


def _materialize(project_id: str, pages: dict[str, str]) -> None:
    """Mirror `pages` (`{path: markdown}`) into `<base>/<project_id>/`: write
    every current page and prune on-disk files Mongo no longer has, so
    deletions/renames propagate and Grep stays accurate."""
    pdir = project_root(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    wanted: set[Path] = set()
    for path, md in pages.items():
        fp = pdir / path
        try:
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(md)
            wanted.add(fp.resolve())
        except OSError:
            log.warning("materialize: could not write %s/%s", project_id, path, exc_info=True)
    for existing in pdir.rglob("*"):
        if existing.is_file() and existing.resolve() not in wanted:
            try:
                existing.unlink()
            except OSError:
                log.warning("materialize: could not prune %s", existing, exc_info=True)


async def refresh_project(project_id: str) -> None:
    """Pull a single project's pages from the backend and mirror them to disk.
    The caller MUST hold `project_lock(project_id)`. Best-effort: on a fetch
    failure the on-disk copy is left as-is."""
    try:
        pages = await asyncio.to_thread(http_client.fetch_all_pages_sync, project_id)
    except Exception:
        log.warning("refresh_project: fetch failed for %s", project_id, exc_info=True)
        return
    await asyncio.to_thread(_materialize, project_id, pages)


async def _sync_one(project_id: str) -> None:
    lock = _project_locks[project_id]
    if lock.locked():
        # A run holds it (e.g. ingest mid-flight). Skip — the run persists to
        # Mongo itself, and we'll catch its result on the next tick.
        log.debug("sync: skipping %s (locked by in-flight run)", project_id)
        return
    async with lock:
        await refresh_project(project_id)


async def sync_all_projects() -> None:
    """Enumerate all projects and mirror each to disk. Used for the startup
    load and every sync tick. Best-effort and per-project isolated — one
    project's failure doesn't abort the rest."""
    try:
        projects = await asyncio.to_thread(http_client.fetch_all_projects)
    except Exception:
        log.warning("sync: could not list projects", exc_info=True)
        return
    log.info("sync: refreshing %d project(s) to disk", len(projects))
    for p in projects:
        pid = p.get("project_id") or p.get("_id") or p.get("id")
        if pid:
            await _sync_one(str(pid))


async def sync_loop(interval_seconds: int) -> None:
    """Background task: re-mirror all projects every `interval_seconds`."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await sync_all_projects()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("sync loop iteration failed", exc_info=True)
