# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Default skill loader — reads SKILL.md from SKILLS_DIR / chart data/skills.

Supports folder-per-skill and flat ConfigMap layouts, parsing both
Anthropic/agentskills.io and OpenClaw-style YAML frontmatter (FR-011).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


def _resolve_skills_dir() -> str | None:
    """Resolve the skills directory from env or well-known chart paths."""
    if os.getenv("SKILLS_DIR"):
        return os.getenv("SKILLS_DIR")

    # Check chart path (Docker / repo layout)
    for base in ["/app", os.getcwd()]:
        chart_path = os.path.join(base, "charts", "ai-platform-engineering", "data", "skills")
        if os.path.isdir(chart_path):
            return chart_path

    # Local data/skills fallback
    local_path = os.path.join(os.getcwd(), "data", "skills")
    if os.path.isdir(local_path):
        return local_path

    return None


def _parse_frontmatter(content: str) -> dict[str, Any]:
    """Parse YAML frontmatter from SKILL.md content.

    Accepts both agentskills.io and OpenClaw-style frontmatter.
    Returns empty dict on parse failure.
    """
    import re

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", content, re.DOTALL)
    if not match:
        return {}

    try:
        data = yaml.safe_load(match.group(1))
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def _build_skill_from_frontmatter(
    skill_id: str, content: str, frontmatter: dict[str, Any]
) -> dict[str, Any] | None:
    """Build a catalog Skill dict from parsed frontmatter + content."""
    name = frontmatter.get("name", skill_id)
    description = frontmatter.get("description", "")

    if not name or not description:
        logger.warning("Skipping skill '%s': missing name or description", skill_id)
        return None

    metadata = frontmatter.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}

    # Merge extra frontmatter fields into metadata
    for key in ("category", "icon", "tags", "compatibility", "license"):
        val = frontmatter.get(key)
        if val is not None:
            metadata[key] = val

    return {
        "id": str(name),
        "name": str(name),
        "description": str(description)[:1024],
        "source": "default",
        "source_id": None,
        "content": content,
        "metadata": metadata,
    }


def load_default_skills(include_content: bool = True) -> list[dict[str, Any]]:
    """Load skills from the filesystem (SKILLS_DIR).

    Args:
        include_content: If True, include full SKILL.md body in each skill.

    Returns:
        List of skill dicts matching the catalog Skill entity shape.
    """
    skills_dir = _resolve_skills_dir()
    if not skills_dir or not os.path.isdir(skills_dir):
        logger.info("No skills directory found; default skills empty")
        return []

    skills: list[dict[str, Any]] = []
    entries = sorted(os.listdir(skills_dir))

    # Folder-per-skill layout
    for entry in entries:
        entry_path = Path(skills_dir) / entry
        if not entry_path.is_dir():
            continue

        skill_md = entry_path / "SKILL.md"
        if not skill_md.is_file():
            # Flat ConfigMap layout: <id>--SKILL.md
            continue

        try:
            content = skill_md.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning("Error reading %s: %s", skill_md, e)
            continue

        frontmatter = _parse_frontmatter(content)
        skill = _build_skill_from_frontmatter(entry, content, frontmatter)
        if skill:
            if not include_content:
                skill["content"] = None
            skills.append(skill)

    # Flat ConfigMap layout: <id>--SKILL.md
    flat_files = [f for f in entries if f.endswith("--SKILL.md")]
    for flat_file in flat_files:
        skill_id = flat_file.replace("--SKILL.md", "")
        flat_path = Path(skills_dir) / flat_file
        try:
            content = flat_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning("Error reading %s: %s", flat_path, e)
            continue

        frontmatter = _parse_frontmatter(content)
        skill = _build_skill_from_frontmatter(skill_id, content, frontmatter)
        if skill:
            if not include_content:
                skill["content"] = None
            skills.append(skill)

    logger.info("Loaded %d default skills from %s", len(skills), skills_dir)
    return skills
