"""Authorize agent use when executing a workflow step (delegated from workflow config)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from dynamic_agents.models import UserContext
    from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)


def _normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _normalize_team_slug(value: str) -> str:
    return value.strip().lower()


def _agent_in_workflow_steps(workflow_doc: dict[str, Any], agent_id: str) -> bool:
    for step in workflow_doc.get("steps") or []:
        if not isinstance(step, dict):
            continue
        if step.get("type") == "step" and step.get("agent_id") == agent_id:
            return True
    return False


def _user_team_slugs(mongo: MongoDBService, user_email: str) -> set[str]:
    db = getattr(mongo, "_db", None)
    if db is None:
        return set()
    try:
        rows = db["teams"].find(
            {"members.user_id": user_email},
            {"slug": 1},
        )
        return {
            _normalize_team_slug(row["slug"])
            for row in rows
            if isinstance(row.get("slug"), str) and row["slug"].strip()
        }
    except Exception as exc:
        logger.warning("Failed to load team slugs for %s: %s", user_email, exc)
        return set()


def user_can_run_workflow(workflow_doc: dict[str, Any], user: UserContext, mongo: MongoDBService) -> bool:
    """Mirror UI workflowRunAllowedByVisibility for runtime delegation."""
    email = _normalize_email(user.email)
    if not email:
        return False

    visibility = workflow_doc.get("visibility") or "private"
    if visibility == "global":
        return True

    if visibility == "team":
        shared_raw = workflow_doc.get("shared_with_teams") or []
        shared = {_normalize_team_slug(s) for s in shared_raw if isinstance(s, str) and s.strip()}
        if not shared:
            return False
        member_slugs = _user_team_slugs(mongo, user.email or "")
        return bool(shared.intersection(member_slugs))

    owner = _normalize_email(workflow_doc.get("owner_id"))
    return bool(owner and owner == email)


def can_use_agent_via_workflow(
    agent_id: str,
    workflow_config_id: str,
    user: UserContext,
    mongo: MongoDBService,
) -> bool:
    """Allow agent use when the agent is a step in a workflow the user may run."""
    if not workflow_config_id or not agent_id:
        return False

    db = getattr(mongo, "_db", None)
    if db is None:
        return False

    try:
        workflow_doc = db["workflow_configs"].find_one({"_id": workflow_config_id})
    except Exception as exc:
        logger.warning(
            "Failed to load workflow config %s for agent delegation: %s",
            workflow_config_id,
            exc,
        )
        return False

    if not workflow_doc:
        return False
    if not _agent_in_workflow_steps(workflow_doc, agent_id):
        return False
    return user_can_run_workflow(workflow_doc, user, mongo)
