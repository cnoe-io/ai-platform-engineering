# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Skill catalog — single source of truth for UI and supervisor.

Merges skills from:
  - Filesystem / SKILLS_DIR  (default)
  - MongoDB agent_skills    (agent_skills)
  - Registered GitHub hubs   (hub)

Applies deterministic precedence (default > agent_skills > hub).
Provides a TTL-based in-memory cache so the supervisor can hot-reload
without restart (FR-012).
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from ai_platform_engineering.skills_middleware.loaders.default import load_default_skills
from ai_platform_engineering.skills_middleware.loaders.agent_skill import load_agent_skills
from ai_platform_engineering.skills_middleware.precedence import merge_skills
from ai_platform_engineering.skills_middleware.entitlement import normalize_merged_skills

logger = logging.getLogger(__name__)

# Cache — TTL defaults raised to avoid re-fetching GitHub hubs on every request.
_skills_cache: list[dict[str, Any]] | None = None
_skills_cache_time: float = 0.0
SKILLS_CACHE_TTL = int(os.getenv("SKILLS_CACHE_TTL", "3600"))  # seconds (default 1 hour)

# Separate hub cache with longer TTL — GitHub API calls are expensive (~70s).
_hub_cache: list[dict[str, Any]] | None = None
_hub_cache_time: float = 0.0
HUB_CACHE_TTL = int(os.getenv("HUB_CACHE_TTL", "3600"))  # seconds (default 1 hour)

# Bumped on each ``invalidate_skills_cache()`` for UI vs supervisor diff (FR-016).
_catalog_cache_generation: int = 0


def _filter_hub_skills_by_scan(
    db: Any,
    hub_id: str,
    skills: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Drop hub skills the UI scanner has flagged.

    The supervisor fetches hub skills live from GitHub, so it has no
    scanner output of its own. The UI side (hub crawl + bulk scan)
    persists per-skill scan results into ``hub_skills`` keyed by
    ``(hub_id, skill_id)``. To keep the supervisor and the UI in
    agreement, look up cached ``scan_status`` here and gate via the
    shared policy.

    We match on ``name`` in addition to ``skill_id`` because the
    Python live fetcher derives ``skill_id`` from the directory name
    while the UI crawler may use a normalized id; the frontmatter
    ``name`` is the one field both sides agree on.
    """
    if not skills:
        return skills

    from ai_platform_engineering.skills_middleware.scan_gate import is_status_blocked

    try:
        col = db["hub_skills"]
        names = [s.get("name") for s in skills if s.get("name")]
        if not names:
            return skills
        rows = list(
            col.find(
                {"hub_id": hub_id, "name": {"$in": names}},
                {"_id": 0, "name": 1, "skill_id": 1, "scan_status": 1},
            )
        )
    except Exception:
        return skills

    # Index by (name) — there can be at most one per hub by convention.
    status_by_name: dict[str, str | None] = {}
    for row in rows:
        n = row.get("name")
        if isinstance(n, str):
            status_by_name[n] = row.get("scan_status")

    out: list[dict[str, Any]] = []
    blocked = 0
    for s in skills:
        name = s.get("name")
        status = status_by_name.get(name) if isinstance(name, str) else None
        # Stamp the status on the skill so downstream consumers (and
        # the listing API surfaces) can show it without a re-query.
        s["scan_status"] = status
        if is_status_blocked(status):
            blocked += 1
            logger.info(
                "Excluding hub skill %r (hub=%s) from supervisor catalog (scan_status=%r)",
                name,
                hub_id,
                status,
            )
            continue
        out.append(s)

    if blocked:
        logger.warning(
            "Scan gate excluded %d hub skills from hub %s", blocked, hub_id
        )
    return out


def _load_hub_skills(include_content: bool = True) -> list[dict[str, Any]]:
    """Load skills from all enabled hubs in MongoDB ``skill_hubs`` collection.

    Uses a separate cache with longer TTL (``HUB_CACHE_TTL``) because GitHub
    API calls are the dominant cost (~70s per refresh).  The main catalog cache
    can expire and cheaply re-merge without re-fetching hubs.

    Returns empty list if MongoDB is unavailable or no hubs exist.
    """
    global _hub_cache, _hub_cache_time

    now = time.time()
    if _hub_cache is not None and (now - _hub_cache_time) < HUB_CACHE_TTL:
        logger.debug("Hub cache hit (%d skills, age %.0fs)", len(_hub_cache), now - _hub_cache_time)
        return list(_hub_cache)

    try:
        from ai_platform_engineering.utils.mongodb_client import get_mongodb_client
    except ImportError:
        return []

    client = get_mongodb_client()
    if client is None:
        return []

    database = os.getenv("MONGODB_DATABASE", "caipe")
    try:
        db = client[database]
        hubs_collection = db["skill_hubs"]
        hubs = list(hubs_collection.find({"enabled": True}).sort("created_at", 1))
    except Exception as e:
        logger.warning("Failed to read skill_hubs from MongoDB: %s", e)
        return []

    if not hubs:
        _hub_cache = []
        _hub_cache_time = now
        return []

    from ai_platform_engineering.skills_middleware.loaders.hub_github import fetch_github_hub_skills

    all_hub_skills: list[dict[str, Any]] = []
    unavailable: list[str] = []

    for hub in hubs:
        hub_type = hub.get("type", "")
        hub_id = hub.get("id", str(hub.get("_id", "")))

        if hub_type != "github":
            logger.warning("Unsupported hub type '%s' for hub %s; skipping", hub_type, hub_id)
            continue

        try:
            skills = fetch_github_hub_skills(hub, include_content=include_content)
            try:
                from ai_platform_engineering.skills_middleware.hub_skill_scan import (
                    hub_scan_should_block_merge,
                )

                if hub_scan_should_block_merge(str(hub_id), skills):
                    unavailable.append(hub_id)
                    continue
            except Exception as scan_err:
                logger.warning("Skill scanner hook skipped for hub %s: %s", hub_id, scan_err)

            # Per-skill scan gate: drop individual hub skills the UI
            # bulk-scanner has flagged. The supervisor's live GitHub
            # fetch has no scan signal of its own — we look up cached
            # status from the ``hub_skills`` Mongo collection (written
            # by the UI hub scan + UI bulk-scan). Missing rows are
            # treated as ``unscanned`` and gated by SKILL_SCANNER_GATE
            # via the shared helper.
            try:
                skills = _filter_hub_skills_by_scan(db, str(hub_id), skills)
            except Exception as scan_err:  # pragma: no cover - defensive
                logger.warning(
                    "Per-skill hub scan filter skipped for hub %s: %s",
                    hub_id,
                    scan_err,
                )

            all_hub_skills.extend(skills)

            hubs_collection.update_one(
                {"_id": hub["_id"]},
                {"$set": {"last_success_at": time.time()}},
            )
        except Exception as e:
            logger.error("Hub %s fetch failed: %s", hub_id, e)
            unavailable.append(hub_id)
            try:
                hubs_collection.update_one(
                    {"_id": hub["_id"]},
                    {"$set": {
                        "last_failure_at": time.time(),
                        "last_failure_message": str(e)[:500],
                    }},
                )
            except Exception:
                pass

    _hub_cache = all_hub_skills
    _hub_cache_time = now
    logger.info("Hub cache refreshed: %d skills from %d hubs", len(all_hub_skills), len(hubs) - len(unavailable))
    return list(all_hub_skills)


def get_merged_skills(include_content: bool = False) -> list[dict[str, Any]]:
    """Return the merged skill catalog from all sources.

    Uses a TTL-based cache.  Call ``invalidate_skills_cache()`` to force
    a fresh load on next access.

    Args:
        include_content: If True, include full SKILL.md body for each skill.

    Returns:
        List of skill dicts with id, name, description, source, source_id,
        content (optional), and metadata.
    """
    global _skills_cache, _skills_cache_time

    now = time.time()
    if _skills_cache is not None and (now - _skills_cache_time) < SKILLS_CACHE_TTL:
        if not include_content:
            return [{**s, "content": None} for s in _skills_cache]
        return list(_skills_cache)

    default_skills = load_default_skills(include_content=True)
    agent_skills_list = load_agent_skills(include_content=True)

    try:
        hub_skills = _load_hub_skills(include_content=True)
    except Exception:
        logger.exception("Hub skill loading failed; continuing without hub skills")
        hub_skills = []

    merged = merge_skills(default_skills, agent_skills_list, hub_skills)
    merged = normalize_merged_skills(merged)

    _skills_cache = merged
    _skills_cache_time = now

    logger.info(
        "Skills catalog refreshed: %d total (%d default, %d agent_skills, %d hub)",
        len(merged),
        len(default_skills),
        len(agent_skills_list),
        len(hub_skills),
    )

    if not include_content:
        return [{**s, "content": None} for s in merged]
    return list(merged)


def get_unavailable_sources() -> list[str]:
    """Return hub IDs that failed on the last catalog refresh.

    This is a best-effort indicator for the API ``meta.unavailable_sources``.
    """
    try:
        from ai_platform_engineering.utils.mongodb_client import get_mongodb_client

        client = get_mongodb_client()
        if client is None:
            return []
        database = os.getenv("MONGODB_DATABASE", "caipe")
        db = client[database]
        hubs = db["skill_hubs"]
        failed = hubs.find(
            {"enabled": True, "last_failure_at": {"$exists": True}},
            {"id": 1, "_id": 0},
        )
        return [h.get("id", "") for h in failed if h.get("id")]
    except Exception:
        return []


def invalidate_skills_cache(*, include_hubs: bool = True) -> None:
    """Clear the in-memory skills cache, forcing a fresh load on next access.

    Args:
        include_hubs: Also clear the hub cache (default True).  Set False to
            keep cached hub results and only re-merge default + agent_skills.
    """
    global _skills_cache, _skills_cache_time, _catalog_cache_generation
    global _hub_cache, _hub_cache_time
    _skills_cache = None
    _skills_cache_time = 0.0
    _catalog_cache_generation += 1
    if include_hubs:
        _hub_cache = None
        _hub_cache_time = 0.0


def get_catalog_cache_generation() -> int:
    """Monotonic counter incremented when the merged-skills cache is invalidated."""
    return _catalog_cache_generation
