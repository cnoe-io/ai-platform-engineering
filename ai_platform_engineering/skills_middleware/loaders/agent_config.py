# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Agent config loader — projects agent_configs from MongoDB as skills."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def load_agent_config_skills(include_content: bool = True) -> list[dict[str, Any]]:
    """Load skills projected from the agent_configs MongoDB collection.

    Each agent_config with a ``skill_template`` field is projected as a skill
    in the catalog with ``source="agent_config"``.

    Args:
        include_content: If True, include the skill template body.

    Returns:
        List of skill dicts matching the catalog Skill entity shape.
    """
    try:
        from ai_platform_engineering.utils.mongodb_client import get_mongodb_client
    except ImportError:
        logger.debug("mongodb_client not available; skipping agent_config skills")
        return []

    client = get_mongodb_client()
    if client is None:
        return []

    database = os.getenv("MONGODB_DATABASE", "caipe")
    try:
        db = client[database]
        collection = db["agent_configs"]
        docs = list(
            collection.find(
                {"skill_template": {"$exists": True, "$ne": ""}},
                {
                    "_id": 0,
                    "name": 1,
                    "description": 1,
                    "skill_template": 1,
                    "metadata": 1,
                    "owner_id": 1,
                },
            )
        )
    except Exception as e:
        logger.warning("Failed to read agent_configs from MongoDB: %s", e)
        return []

    skills: list[dict[str, Any]] = []
    for doc in docs:
        name = doc.get("name", "")
        description = doc.get("description", "")
        if not name or not description:
            continue

        skill: dict[str, Any] = {
            "id": str(name),
            "name": str(name),
            "description": str(description)[:1024],
            "source": "agent_config",
            "source_id": doc.get("owner_id"),
            "content": doc.get("skill_template", "") if include_content else None,
            "metadata": doc.get("metadata", {}),
        }
        skills.append(skill)

    logger.info("Loaded %d skills from agent_configs", len(skills))
    return skills
