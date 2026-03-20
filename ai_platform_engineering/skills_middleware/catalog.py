# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Skill catalog — single source of truth for UI and supervisor.

Merges skills from:
  - Filesystem / SKILLS_DIR  (default)
  - MongoDB agent_configs    (agent_config)
  - Registered GitHub hubs   (hub)

Applies deterministic precedence (default > agent_config > hub).
Provides a TTL-based in-memory cache so the supervisor can hot-reload
without restart (FR-012).
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from ai_platform_engineering.skills_middleware.loaders.default import load_default_skills
from ai_platform_engineering.skills_middleware.loaders.agent_config import load_agent_config_skills
from ai_platform_engineering.skills_middleware.precedence import merge_skills

logger = logging.getLogger(__name__)

# Cache
_skills_cache: list[dict[str, Any]] | None = None
_skills_cache_time: float = 0.0
SKILLS_CACHE_TTL = int(os.getenv("SKILLS_CACHE_TTL", "60"))  # seconds


def _load_hub_skills(include_content: bool = True) -> list[dict[str, Any]]:
    """Load skills from all enabled hubs in MongoDB ``skill_hubs`` collection.

    Returns empty list if MongoDB is unavailable or no hubs exist.
    """
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
            all_hub_skills.extend(skills)

            # Update last_success_at
            hubs_collection.update_one(
                {"_id": hub["_id"]},
                {"$set": {"last_success_at": time.time()}},
            )
        except Exception as e:
            logger.error("Hub %s fetch failed: %s", hub_id, e)
            unavailable.append(hub_id)
            # Update last_failure_*
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

    return all_hub_skills


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
    agent_config_skills = load_agent_config_skills(include_content=True)

    try:
        hub_skills = _load_hub_skills(include_content=True)
    except Exception:
        logger.exception("Hub skill loading failed; continuing without hub skills")
        hub_skills = []

    merged = merge_skills(default_skills, agent_config_skills, hub_skills)

    _skills_cache = merged
    _skills_cache_time = now

    logger.info(
        "Skills catalog refreshed: %d total (%d default, %d agent_config, %d hub)",
        len(merged),
        len(default_skills),
        len(agent_config_skills),
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


def invalidate_skills_cache() -> None:
    """Clear the in-memory skills cache, forcing a fresh load on next access."""
    global _skills_cache, _skills_cache_time
    _skills_cache = None
    _skills_cache_time = 0.0
