# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""GitHub hub fetcher — discovers and loads skills from a GitHub repository.

Looks for skills under ``skills/*/SKILL.md`` or repo root ``*/SKILL.md``.
Parses both Anthropic/agentskills.io and OpenClaw-style SKILL.md (FR-011).
ClawHub as a hub source is out of scope for v1.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from typing import Any

import yaml

logger = logging.getLogger(__name__)


def _parse_frontmatter(content: str) -> dict[str, Any]:
    """Parse YAML frontmatter from SKILL.md content."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", content, re.DOTALL)
    if not match:
        return {}
    try:
        data = yaml.safe_load(match.group(1))
        return data if isinstance(data, dict) else {}
    except yaml.YAMLError:
        return {}


def _build_skill_dict(
    skill_id: str,
    content: str,
    hub_id: str,
    include_content: bool,
) -> dict[str, Any] | None:
    """Build a catalog Skill dict from a fetched SKILL.md."""
    frontmatter = _parse_frontmatter(content)
    name = frontmatter.get("name", skill_id)
    description = frontmatter.get("description", "")
    if not name or not description:
        logger.warning("Hub %s: skipping skill '%s' — missing name or description", hub_id, skill_id)
        return None

    metadata = frontmatter.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
    for key in ("category", "icon", "tags", "compatibility", "license"):
        val = frontmatter.get(key)
        if val is not None:
            metadata[key] = val

    return {
        "id": f"{hub_id}/{name}",
        "name": str(name),
        "description": str(description)[:1024],
        "source": "hub",
        "source_id": hub_id,
        "content": content if include_content else None,
        "metadata": metadata,
    }


def fetch_github_hub_skills(
    hub: dict[str, Any],
    include_content: bool = True,
) -> list[dict[str, Any]]:
    """Fetch skills from a GitHub repository hub.

    Uses the GitHub API (``repos/{owner}/{repo}/git/trees/{branch}?recursive=1``)
    to discover SKILL.md files, then fetches each via the contents API.

    Args:
        hub: Hub document from MongoDB (id, type, location, credentials_ref, ...).
        include_content: If True, include full SKILL.md body.

    Returns:
        List of skill dicts for this hub.  Empty list on failure.
    """
    import httpx

    hub_id = hub["id"]
    location = hub.get("location", "")
    if not location:
        logger.warning("Hub %s: empty location", hub_id)
        return []

    # Resolve token from credentials_ref → env var name
    token: str | None = None
    cred_ref = hub.get("credentials_ref")
    if cred_ref:
        token = os.getenv(cred_ref)
    if not token:
        token = os.getenv("GITHUB_TOKEN")

    headers: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    api_base = os.getenv("GITHUB_API_URL", "https://api.github.com")

    try:
        # Fetch recursive tree to find SKILL.md files
        tree_url = f"{api_base}/repos/{location}/git/trees/HEAD?recursive=1"
        with httpx.Client(timeout=30) as client:
            resp = client.get(tree_url, headers=headers)
            resp.raise_for_status()
            tree = resp.json()

        # Find SKILL.md files under skills/*/ or top-level */
        skill_paths: list[tuple[str, str]] = []  # (skill_id, path)
        for item in tree.get("tree", []):
            path = item.get("path", "")
            if not path.endswith("/SKILL.md") and not path.endswith("\\SKILL.md"):
                if path == "SKILL.md":
                    continue
                if not path.endswith("SKILL.md"):
                    continue
            # Extract skill_id from parent directory
            parts = path.replace("\\", "/").rsplit("/", 1)
            if len(parts) < 2:
                continue
            parent = parts[0]
            skill_id = parent.rsplit("/", 1)[-1] if "/" in parent else parent
            skill_paths.append((skill_id, path))

        if not skill_paths:
            logger.info("Hub %s: no SKILL.md files found in %s", hub_id, location)
            return []

        skills: list[dict[str, Any]] = []
        with httpx.Client(timeout=30) as client:
            for skill_id, path in skill_paths:
                try:
                    content_url = f"{api_base}/repos/{location}/contents/{path}"
                    resp = client.get(content_url, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    raw = base64.b64decode(data.get("content", "")).decode("utf-8")
                except Exception as e:
                    logger.warning("Hub %s: failed to fetch %s: %s", hub_id, path, e)
                    continue

                skill = _build_skill_dict(skill_id, raw, hub_id, include_content)
                if skill:
                    skills.append(skill)

        logger.info("Hub %s: loaded %d skills from %s", hub_id, len(skills), location)
        return skills

    except Exception as e:
        logger.error("Hub %s: fetch failed for %s: %s", hub_id, location, e)
        return []
