# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Agent skills loader — projects agent_skills from MongoDB as skills."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def load_agent_skills(include_content: bool = True) -> list[dict[str, Any]]:
    """Load skills projected from the agent_skills MongoDB collection.

    Each document with a ``skill_template`` field is projected as a skill
    in the catalog with ``source="agent_skills"``.

    Args:
        include_content: If True, include the skill template body.

    Returns:
        List of skill dicts matching the catalog Skill entity shape.
    """
    try:
        from ai_platform_engineering.utils.mongodb_client import get_mongodb_client
    except ImportError:
        logger.debug("mongodb_client not available; skipping agent skills")
        return []

    client = get_mongodb_client()
    if client is None:
        return []

    database = os.getenv("MONGODB_DATABASE", "caipe")
    gate = os.getenv("SKILL_SCANNER_GATE", "warn").strip().lower()
    try:
        db = client[database]
        collection = db["agent_skills"]
        query: dict[str, Any] = {
            "$or": [
                {"skill_content": {"$exists": True, "$ne": ""}},
                {"skill_template": {"$exists": True, "$ne": ""}},
            ]
        }
        if gate == "strict":
            query["scan_status"] = {"$ne": "flagged"}
        docs = list(
            collection.find(
                query,
                {
                    "_id": 0,
                    "name": 1,
                    "description": 1,
                    "skill_content": 1,
                    "skill_template": 1,
                    "metadata": 1,
                    "owner_id": 1,
                    "visibility": 1,
                    "team_ids": 1,
                    "owner_user_id": 1,
                    "ancillary_files": 1,
                },
            )
        )
    except Exception as e:
        logger.warning("Failed to read agent_skills from MongoDB: %s", e)
        return []

    skills: list[dict[str, Any]] = []
    for doc in docs:
        name = doc.get("name", "")
        description = doc.get("description", "")
        if not name or not description:
            continue

        owner_user = doc.get("owner_user_id")
        if owner_user is None and doc.get("owner_id") is not None:
            owner_user = str(doc.get("owner_id"))

        raw_ancillary = doc.get("ancillary_files")
        ancillary: dict[str, str] = (
            raw_ancillary if isinstance(raw_ancillary, dict) else {}
        )

        skill: dict[str, Any] = {
            "id": str(name),
            "name": str(name),
            "description": str(description)[:1024],
            "source": "agent_skills",
            "source_id": doc.get("owner_id"),
            "content": (doc.get("skill_content") or doc.get("skill_template") or "") if include_content else None,
            "metadata": doc.get("metadata", {}),
            "visibility": doc.get("visibility"),
            "team_ids": doc.get("team_ids"),
            "owner_user_id": owner_user,
            "ancillary_files": ancillary if include_content else {},
        }
        skills.append(skill)

    logger.info("Loaded %d skills from agent_skills", len(skills))
    return skills
