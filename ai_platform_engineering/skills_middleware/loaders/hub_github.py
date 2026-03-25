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
        "visibility": "global",
        "team_ids": [],
        "owner_user_id": None,
        "ancillary_files": {},
    }


def _fetch_blob_content(
    client: Any,
    api_base: str,
    location: str,
    sha: str,
    headers: dict[str, str],
) -> str | None:
    """Fetch a git blob by SHA (faster than contents API, no path encoding needed)."""
    try:
        resp = client.get(
            f"{api_base}/repos/{location}/git/blobs/{sha}",
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()
        encoding = data.get("encoding", "base64")
        if encoding == "base64":
            return base64.b64decode(data.get("content", "")).decode("utf-8", errors="replace")
        return data.get("content", "")
    except Exception:
        return None


def fetch_github_hub_skills(
    hub: dict[str, Any],
    include_content: bool = True,
) -> list[dict[str, Any]]:
    """Fetch skills from a GitHub repository hub.

    Uses the GitHub API (``repos/{owner}/{repo}/git/trees/{branch}?recursive=1``)
    to discover SKILL.md files, then fetches file contents via the git blob API
    using SHAs from the tree (avoids slow per-path contents API lookups).

    Args:
        hub: Hub document from MongoDB (id, type, location, credentials_ref, ...).
        include_content: If True, include full SKILL.md body.

    Returns:
        List of skill dicts for this hub.  Empty list on failure.
    """
    import httpx

    hub_id = hub["id"]
    location = hub.get("location", "").strip()
    if not location:
        logger.warning("Hub %s: empty location", hub_id)
        return []

    # Normalize full GitHub URLs to owner/repo
    if location.startswith("http://") or location.startswith("https://"):
        from urllib.parse import urlparse

        parsed = urlparse(location)
        path = parsed.path.strip("/")
        parts = path.split("/")
        if len(parts) >= 2:
            location = f"{parts[0]}/{parts[1]}"
        else:
            logger.warning("Hub %s: cannot extract owner/repo from URL %s", hub_id, location)
            return []

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
        tree_url = f"{api_base}/repos/{location}/git/trees/HEAD?recursive=1"
        with httpx.Client(timeout=30) as client:
            resp = client.get(tree_url, headers=headers)
            resp.raise_for_status()
            tree = resp.json()

        tree_items = tree.get("tree", [])

        # Build a lookup of normalised path → sha for blob fetching.
        blob_sha: dict[str, str] = {}
        for item in tree_items:
            if item.get("type") != "blob":
                continue
            norm = item.get("path", "").replace("\\", "/")
            blob_sha[norm] = item.get("sha", "")

        # Find SKILL.md files under skills/*/ or top-level */
        skill_paths: list[tuple[str, str, str]] = []  # (skill_id, path, dir_prefix)
        for item in tree_items:
            path = item.get("path", "")
            norm = path.replace("\\", "/")
            if not norm.endswith("/SKILL.md"):
                if norm == "SKILL.md":
                    continue
                if not norm.endswith("SKILL.md"):
                    continue
            parts = norm.rsplit("/", 1)
            if len(parts) < 2:
                continue
            parent = parts[0]
            skill_id = parent.rsplit("/", 1)[-1] if "/" in parent else parent
            skill_paths.append((skill_id, norm, parent + "/"))

        if not skill_paths:
            logger.info("Hub %s: no SKILL.md files found in %s", hub_id, location)
            return []

        # Build ancillary paths per skill directory
        skill_ancillary: dict[str, list[str]] = {}
        for _skill_id, _skill_path, dir_prefix in skill_paths:
            ancillary = [
                bp for bp in blob_sha
                if bp.startswith(dir_prefix) and not bp.endswith("SKILL.md")
            ]
            skill_ancillary[dir_prefix] = ancillary

        skills: list[dict[str, Any]] = []
        with httpx.Client(timeout=30) as client:
            for skill_id, path, dir_prefix in skill_paths:
                sha = blob_sha.get(path)
                if not sha:
                    logger.warning("Hub %s: no SHA for %s; skipping", hub_id, path)
                    continue

                raw = _fetch_blob_content(client, api_base, location, sha, headers)
                if raw is None:
                    logger.warning("Hub %s: failed to fetch blob for %s", hub_id, path)
                    continue

                skill = _build_skill_dict(skill_id, raw, hub_id, include_content)
                if not skill:
                    continue

                ancillary_files: dict[str, str] = {}
                if include_content:
                    for anc_path in skill_ancillary.get(dir_prefix, []):
                        anc_sha = blob_sha.get(anc_path)
                        if not anc_sha:
                            continue
                        rel = anc_path[len(dir_prefix):]
                        content = _fetch_blob_content(client, api_base, location, anc_sha, headers)
                        if content is not None:
                            ancillary_files[rel] = content

                skill["ancillary_files"] = ancillary_files
                skills.append(skill)

        logger.info("Hub %s: loaded %d skills from %s", hub_id, len(skills), location)
        return skills

    except Exception as e:
        logger.error("Hub %s: fetch failed for %s: %s", hub_id, location, e)
        return []


def preview_github_hub_skills(
    location: str,
    credentials_ref: str | None = None,
    *,
    max_paths: int = 200,
) -> dict[str, Any]:
    """List SKILL.md paths in a GitHub repo without persisting a hub (FR-017 crawl).

    Uses one recursive tree request; optionally derives a display name from the
    parent directory of each path. Does not fetch full file bodies.
    """
    import httpx

    if not location or "/" not in location.strip():
        return {"paths": [], "skills_preview": [], "error": "invalid_location"}

    location = location.strip()
    # Normalize full GitHub URLs to owner/repo
    if location.startswith("http://") or location.startswith("https://"):
        from urllib.parse import urlparse

        parsed = urlparse(location)
        path = parsed.path.strip("/")
        parts = path.split("/")
        if len(parts) >= 2:
            location = f"{parts[0]}/{parts[1]}"
        else:
            return {"paths": [], "skills_preview": [], "error": "invalid_location"}

    max_paths = max(1, min(500, max_paths))

    token: str | None = None
    if credentials_ref:
        token = os.getenv(credentials_ref)
    if not token:
        token = os.getenv("GITHUB_TOKEN")

    headers: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    api_base = os.getenv("GITHUB_API_URL", "https://api.github.com")

    try:
        tree_url = f"{api_base}/repos/{location.strip()}/git/trees/HEAD?recursive=1"
        with httpx.Client(timeout=30) as client:
            resp = client.get(tree_url, headers=headers)
            resp.raise_for_status()
            tree = resp.json()

        tree_items = tree.get("tree", [])
        all_blob_paths = [
            item.get("path", "").replace("\\", "/")
            for item in tree_items
            if item.get("type") == "blob"
        ]

        raw_paths: list[str] = []
        for item in tree_items:
            path = item.get("path", "")
            if not path.endswith("SKILL.md"):
                continue
            raw_paths.append(path.replace("\\", "/"))
            if len(raw_paths) >= max_paths:
                break

        skills_preview: list[dict[str, Any]] = []
        for path in raw_paths:
            parent = path.rsplit("/", 1)[0] if "/" in path else ""
            name = parent.rsplit("/", 1)[-1] if parent else path
            dir_prefix = parent + "/" if parent else ""
            ancillary_count = sum(
                1
                for bp in all_blob_paths
                if dir_prefix and bp.startswith(dir_prefix) and not bp.endswith("SKILL.md")
            )
            skills_preview.append({
                "path": path,
                "name": name,
                "description": "",
                "ancillary_file_count": ancillary_count,
            })

        return {"paths": raw_paths, "skills_preview": skills_preview, "error": None}
    except Exception as e:
        logger.warning("preview_github_hub_skills failed for %s: %s", location, e)
        return {"paths": [], "skills_preview": [], "error": str(e)}
