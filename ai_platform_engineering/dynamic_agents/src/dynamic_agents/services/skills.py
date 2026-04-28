"""Skill loading and file-building utilities for Dynamic Agents.

Loads skill documents from the ``agent_skills`` MongoDB collection,
normalises content from the three known content fields (``skill_content``,
``skill_template``, ``tasks[0].llm_prompt``) into a single ``content``
key, and builds the ``files`` dict + source paths that
``SkillsMiddleware`` / ``StateBackend`` consume.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger(__name__)


# ─────────────────────────── content helpers ─────────────────────────────


def extract_llm_prompt(doc: dict[str, Any]) -> str:
    """Extract ``llm_prompt`` from ``tasks[0]`` for template-based skills."""
    tasks = doc.get("tasks")
    if isinstance(tasks, list) and tasks:
        return tasks[0].get("llm_prompt", "") if isinstance(tasks[0], dict) else ""
    return ""


# ─────────────────────────── skill loading ───────────────────────────────


def load_skills(
    skill_ids: list[str],
    *,
    mongodb_uri: str,
    mongodb_database: str,
) -> list[dict[str, Any]]:
    """Load skill documents from MongoDB ``agent_skills`` collection.

    Args:
        skill_ids: List of skill ``id`` values (string slugs) to load.
        mongodb_uri: MongoDB connection URI.
        mongodb_database: Database name (overridden by ``MONGODB_DATABASE`` env var).

    Returns:
        List of skill dicts compatible with ``build_skills_files()``.
    """
    from pymongo import MongoClient as _MongoClient

    database = os.getenv("MONGODB_DATABASE", mongodb_database)
    client = _MongoClient(mongodb_uri, tz_aware=True)
    logger.info(
        "Loading skills from agent_skills: requested_ids=%s db=%s",
        skill_ids,
        database,
    )
    try:
        db = client[database]
        collection = db["agent_skills"]
        # UI stores the ``id`` field (string slug), not the MongoDB ``_id``
        # (ObjectId).  Query both to handle either format.
        docs = list(
            collection.find(
                {
                    "$or": [
                        {"id": {"$in": skill_ids}},
                        {"_id": {"$in": skill_ids}},
                    ]
                }
            )
        )
        logger.info(
            "MongoDB query returned %d docs for %d requested skill IDs",
            len(docs),
            len(skill_ids),
        )
    except Exception as e:
        logger.warning("Failed to load skills from agent_skills: %s", e, exc_info=True)
        return []
    finally:
        client.close()

    # Build result list and track which requested IDs were found.
    found_ids: set[str] = set()
    skills: list[dict[str, Any]] = []
    for doc in docs:
        name = doc.get("name", "")
        description = doc.get("description", "")
        doc_id = str(doc.get("id", "")) or str(doc.get("_id", ""))
        found_ids.add(str(doc.get("id", "")))
        found_ids.add(str(doc.get("_id", "")))

        if not name:
            logger.warning("Skipping skill doc %s: missing name", doc_id)
            continue

        content = doc.get("skill_content") or doc.get("skill_template") or extract_llm_prompt(doc) or ""
        content_source = (
            "skill_content"
            if doc.get("skill_content")
            else "skill_template"
            if doc.get("skill_template")
            else "tasks[0].llm_prompt"
            if extract_llm_prompt(doc)
            else "empty"
        )
        logger.debug(
            "Skill %r (%s): content_source=%s content_len=%d",
            name,
            doc_id,
            content_source,
            len(content),
        )

        owner_user = doc.get("owner_user_id") or str(doc.get("owner_id", ""))
        raw_ancillary = doc.get("ancillary_files")
        ancillary: dict[str, str] = raw_ancillary if isinstance(raw_ancillary, dict) else {}

        skills.append(
            {
                "id": doc_id,
                "name": str(name),
                "description": str(description)[:1024],
                "source": "agent_skills",
                "source_id": doc.get("owner_id"),
                "content": content,
                "metadata": doc.get("metadata", {}),
                "visibility": doc.get("visibility"),
                "team_ids": doc.get("team_ids"),
                "owner_user_id": owner_user,
                "ancillary_files": ancillary,
            }
        )

    missing = [sid for sid in skill_ids if sid not in found_ids]
    if missing:
        logger.warning("Skills not found in agent_skills: %s", missing)
    logger.info(
        "Loaded %d/%d skills from agent_skills (missing=%d)",
        len(skills),
        len(skill_ids),
        len(missing),
    )
    return skills


# ─────────────────────── StateBackend file building ──────────────────────
#
# Converts loaded skill dicts into the ``files`` dict and source paths
# that ``SkillsMiddleware`` / ``StateBackend`` consume at runtime.


def _sanitize_name(name: str) -> str:
    """Sanitize a skill name for use as a directory name."""
    return re.sub(r"[^a-z0-9-]", "-", name.lower()).strip("-")


def _create_file_data(content: str) -> dict[str, Any]:
    """Create a file data dict compatible with StateBackend.

    Mirrors ``deepagents.backends.utils.create_file_data``.
    """
    lines = content.split("\n") if isinstance(content, str) else content
    now = datetime.now(UTC).isoformat()
    return {
        "content": lines,
        "created_at": now,
        "modified_at": now,
    }


def _build_skill_md(skill: dict[str, Any]) -> str:
    """Build a SKILL.md string (YAML frontmatter + body) from a skill dict."""
    name = skill.get("name", "")
    description = skill.get("description", "")
    content = skill.get("content", "")

    # If the original content already has valid frontmatter, use it as-is
    if content and content.strip().startswith("---"):
        return content

    # Build frontmatter + body
    metadata = skill.get("metadata", {})
    fm_lines = [
        "---",
        f"name: {name}",
        f"description: {description}",
    ]
    for key in ("license", "compatibility"):
        val = metadata.get(key)
        if val:
            fm_lines.append(f"{key}: {val}")

    source = skill.get("source", "")
    source_id = skill.get("source_id", "")
    if source:
        fm_lines.append("metadata:")
        fm_lines.append(f"  source: {source}")
        if source_id:
            fm_lines.append(f"  source_id: {source_id}")

    fm_lines.append("---")
    fm_lines.append("")

    if content:
        fm_lines.append(content)
    else:
        fm_lines.append(f"# {name}")
        fm_lines.append("")
        fm_lines.append(description)

    return "\n".join(fm_lines)


def build_skills_files(
    skills: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    """Build a ``files`` dict and source paths for StateBackend + SkillsMiddleware.

    Args:
        skills: List of skill dicts from ``load_skills()``.

    Returns:
        Tuple of:
        - ``files``: Dict of ``{path: file_data}`` to inject into agent state.
        - ``sources``: List of source paths for ``SkillsMiddleware(sources=...)``.
    """
    files: dict[str, Any] = {}
    source_paths: set[str] = set()

    for skill in skills:
        source = skill.get("source", "default")
        source_id = skill.get("source_id")
        name = _sanitize_name(skill.get("name", "unknown"))

        if source == "default":
            source_dir = "/skills/default"
        elif source == "agent_skills":
            source_dir = "/skills/agent-skills"
        elif source == "hub" and source_id:
            safe_id = _sanitize_name(source_id)
            source_dir = f"/skills/hub-{safe_id}"
        else:
            source_dir = "/skills/default"

        source_path = f"{source_dir}/"
        source_paths.add(source_path)

        file_path = f"{source_dir}/{name}/SKILL.md"
        skill_md = _build_skill_md(skill)
        files[file_path] = _create_file_data(skill_md)

        for rel_path, file_content in skill.get("ancillary_files", {}).items():
            anc_path = f"{source_dir}/{name}/{rel_path}"
            files[anc_path] = _create_file_data(file_content)

    sources = sorted(source_paths)
    logger.info(
        "Built %d skill files for StateBackend (%d sources: %s)",
        len(files),
        len(sources),
        sources,
    )
    return files, sources
