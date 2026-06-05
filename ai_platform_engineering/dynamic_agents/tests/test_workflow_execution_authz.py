"""Tests for workflow-delegated agent use authorization."""

from unittest.mock import MagicMock

from dynamic_agents.auth.workflow_execution_authz import (
    can_use_agent_via_workflow,
    user_can_run_workflow,
)
from dynamic_agents.models import UserContext


def _mongo_with_workflow(doc: dict | None) -> MagicMock:
    mongo = MagicMock()
    db = MagicMock()
    mongo._db = db
    db.__getitem__.return_value.find_one.return_value = doc
    db.__getitem__.return_value.find.return_value = []
    return mongo


def test_global_workflow_delegates_agent_in_steps() -> None:
    workflow = {
        "_id": "wf-movie-guessing",
        "visibility": "global",
        "owner_id": "system",
        "steps": [
            {"type": "step", "agent_id": "dynamic-agent-1", "display_text": "Ask"},
        ],
    }
    mongo = _mongo_with_workflow(workflow)
    user = UserContext(email="runner@example.com")

    assert can_use_agent_via_workflow("dynamic-agent-1", "wf-movie-guessing", user, mongo) is True
    assert can_use_agent_via_workflow("other-agent", "wf-movie-guessing", user, mongo) is False


def test_team_workflow_requires_shared_team() -> None:
    workflow = {
        "_id": "wf-team",
        "visibility": "team",
        "owner_id": "owner@example.com",
        "shared_with_teams": ["platform-eng"],
        "steps": [{"type": "step", "agent_id": "agent-a"}],
    }
    mongo = _mongo_with_workflow(workflow)
    teams_coll = mongo._db.__getitem__.return_value
    teams_coll.find.return_value = [{"slug": "platform-eng"}]

    user = UserContext(email="member@example.com")
    assert user_can_run_workflow(workflow, user, mongo) is True
    assert can_use_agent_via_workflow("agent-a", "wf-team", user, mongo) is True

    teams_coll.find.return_value = [{"slug": "other-team"}]
    assert user_can_run_workflow(workflow, user, mongo) is False


def test_agent_not_in_workflow_steps_denied() -> None:
    """Agent not referenced in any step is denied even if workflow is accessible."""
    workflow = {
        "_id": "wf-global",
        "visibility": "global",
        "owner_id": "system",
        "steps": [{"type": "step", "agent_id": "agent-x"}],
    }
    mongo = _mongo_with_workflow(workflow)
    user = UserContext(email="anyone@example.com")

    assert can_use_agent_via_workflow("agent-not-in-steps", "wf-global", user, mongo) is False


def test_missing_workflow_denied() -> None:
    """Unknown workflow_config_id always denies."""
    mongo = _mongo_with_workflow(None)
    user = UserContext(email="anyone@example.com")

    assert can_use_agent_via_workflow("agent-x", "wf-does-not-exist", user, mongo) is False


def test_private_workflow_only_owner_can_use() -> None:
    workflow = {
        "_id": "wf-private",
        "visibility": "private",
        "owner_id": "owner@example.com",
        "steps": [{"type": "step", "agent_id": "agent-priv"}],
    }
    mongo = _mongo_with_workflow(workflow)

    assert can_use_agent_via_workflow("agent-priv", "wf-private", UserContext(email="owner@example.com"), mongo) is True
    assert can_use_agent_via_workflow("agent-priv", "wf-private", UserContext(email="other@example.com"), mongo) is False
