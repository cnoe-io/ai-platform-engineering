# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for per-user task config scoping.

Run with: PYTHONPATH=. uv run pytest tests/test_task_config_user_scoping.py -v
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parents[1]))

from ai_platform_engineering.utils.mongodb_client import (
    _get_user_team_ids,
    get_task_configs_for_user,
)


SAMPLE_CONFIGS = {
    "Deploy App": {
        "tasks": [{"display_text": "Deploy", "llm_prompt": "deploy it", "subagent": "caipe"}],
        "owner_id": "system",
        "is_system": True,
        "visibility": "global",
    },
    "Restart Pod": {
        "tasks": [{"display_text": "Restart", "llm_prompt": "restart pod", "subagent": "caipe"}],
        "owner_id": "system",
        "is_system": True,
        "visibility": "global",
    },
    "Alice Custom Task": {
        "tasks": [{"display_text": "Custom", "llm_prompt": "do custom", "subagent": "caipe"}],
        "owner_id": "alice@example.com",
        "is_system": False,
        "visibility": "private",
    },
    "Bob Custom Task": {
        "tasks": [{"display_text": "Bob's", "llm_prompt": "do bob stuff", "subagent": "caipe"}],
        "owner_id": "bob@example.com",
        "is_system": False,
        "visibility": "private",
    },
    "Shared Global Task": {
        "tasks": [{"display_text": "Shared", "llm_prompt": "shared op", "subagent": "caipe"}],
        "owner_id": "alice@example.com",
        "is_system": False,
        "visibility": "global",
    },
}


@patch(
    "ai_platform_engineering.utils.mongodb_client.get_task_configs_from_mongodb",
    return_value=SAMPLE_CONFIGS,
)
class TestGetTaskConfigsForUser:
    """Tests for get_task_configs_for_user per-user filtering."""

    def test_no_email_returns_system_and_global_only(self, mock_get):
        result = get_task_configs_for_user(user_email=None)

        assert "Deploy App" in result
        assert "Restart Pod" in result
        assert "Shared Global Task" in result
        assert "Alice Custom Task" not in result
        assert "Bob Custom Task" not in result

    def test_alice_sees_own_plus_system_global(self, mock_get):
        result = get_task_configs_for_user(user_email="alice@example.com")

        assert "Deploy App" in result
        assert "Restart Pod" in result
        assert "Shared Global Task" in result
        assert "Alice Custom Task" in result
        assert "Bob Custom Task" not in result

    def test_bob_sees_own_plus_system_global(self, mock_get):
        result = get_task_configs_for_user(user_email="bob@example.com")

        assert "Deploy App" in result
        assert "Restart Pod" in result
        assert "Shared Global Task" in result
        assert "Bob Custom Task" in result
        assert "Alice Custom Task" not in result

    def test_unknown_user_sees_system_and_global_only(self, mock_get):
        result = get_task_configs_for_user(user_email="stranger@example.com")

        assert "Deploy App" in result
        assert "Restart Pod" in result
        assert "Shared Global Task" in result
        assert "Alice Custom Task" not in result
        assert "Bob Custom Task" not in result

    def test_empty_mongodb_returns_none(self, mock_get):
        mock_get.return_value = None
        result = get_task_configs_for_user(user_email="alice@example.com")
        assert result is None

    def test_all_private_returns_none_for_no_email(self, mock_get):
        mock_get.return_value = {
            "Private Only": {
                "tasks": [{"display_text": "X", "llm_prompt": "Y", "subagent": "caipe"}],
                "owner_id": "alice@example.com",
                "is_system": False,
                "visibility": "private",
            }
        }
        result = get_task_configs_for_user(user_email=None)
        assert result is None


@patch(
    "ai_platform_engineering.utils.mongodb_client.get_task_configs_from_mongodb",
    return_value=SAMPLE_CONFIGS,
)
class TestGetTaskConfigsForUserDefaults:
    """Tests for legacy documents missing ownership fields."""

    def test_missing_owner_id_defaults_to_system(self, mock_get):
        mock_get.return_value = {
            "Legacy Task": {
                "tasks": [{"display_text": "L", "llm_prompt": "legacy", "subagent": "caipe"}],
            }
        }
        result = get_task_configs_for_user(user_email=None)
        assert result is not None
        assert "Legacy Task" in result

    def test_missing_visibility_defaults_to_global(self, mock_get):
        mock_get.return_value = {
            "Old Task": {
                "tasks": [{"display_text": "O", "llm_prompt": "old", "subagent": "caipe"}],
                "owner_id": "alice@example.com",
                "is_system": False,
            }
        }
        result = get_task_configs_for_user(user_email=None)
        assert result is not None
        assert "Old Task" in result


# ============================================================================
# Team-visibility tests (visibility="team" + shared_with_teams)
# ============================================================================

TEAM_CONFIGS = {
    # System / global — always visible
    "Global Task": {
        "tasks": [{"display_text": "G", "llm_prompt": "global op", "subagent": "caipe"}],
        "owner_id": "system",
        "is_system": True,
        "visibility": "global",
        "shared_with_teams": [],
    },
    # Shared with team-a and team-b
    "Team AB Workflow": {
        "tasks": [{"display_text": "T", "llm_prompt": "team op", "subagent": "caipe"}],
        "owner_id": "alice@example.com",
        "is_system": False,
        "visibility": "team",
        "shared_with_teams": ["team-a", "team-b"],
    },
    # Shared with team-c only
    "Team C Workflow": {
        "tasks": [{"display_text": "C", "llm_prompt": "team c op", "subagent": "caipe"}],
        "owner_id": "charlie@example.com",
        "is_system": False,
        "visibility": "team",
        "shared_with_teams": ["team-c"],
    },
    # Private — only owner sees it
    "Owner-Only Task": {
        "tasks": [{"display_text": "O", "llm_prompt": "private op", "subagent": "caipe"}],
        "owner_id": "alice@example.com",
        "is_system": False,
        "visibility": "private",
        "shared_with_teams": [],
    },
}


@patch(
    "ai_platform_engineering.utils.mongodb_client.get_task_configs_from_mongodb",
    return_value=TEAM_CONFIGS,
)
class TestTeamVisibilityFiltering:
    """Tests for visibility='team' filtering in get_task_configs_for_user."""

    def test_member_of_team_a_sees_team_ab_workflow(self, mock_get):
        """User in team-a can see Team AB Workflow."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-a"],
        ):
            result = get_task_configs_for_user(user_email="alice@example.com")
        assert "Team AB Workflow" in result

    def test_member_of_team_b_sees_team_ab_workflow(self, mock_get):
        """User in team-b can also see Team AB Workflow."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-b"],
        ):
            result = get_task_configs_for_user(user_email="bob@example.com")
        assert "Team AB Workflow" in result

    def test_member_of_team_c_sees_team_c_workflow(self, mock_get):
        """User in team-c sees Team C Workflow but not Team AB Workflow."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-c"],
        ):
            result = get_task_configs_for_user(user_email="carol@example.com")
        assert "Team C Workflow" in result
        assert "Team AB Workflow" not in result

    def test_user_not_in_any_team_does_not_see_team_workflows(self, mock_get):
        """User with no team memberships cannot see any team-scoped workflows."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=[],
        ):
            result = get_task_configs_for_user(user_email="stranger@example.com")
        assert "Team AB Workflow" not in result
        assert "Team C Workflow" not in result
        assert "Global Task" in result

    def test_no_email_does_not_trigger_team_lookup(self, mock_get):
        """When user_email is None no team IDs should be fetched."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
        ) as mock_team_ids:
            result = get_task_configs_for_user(user_email=None)
        mock_team_ids.assert_not_called()
        assert "Team AB Workflow" not in result
        assert "Team C Workflow" not in result
        assert "Global Task" in result

    def test_team_lookup_is_lazy_called_at_most_once(self, mock_get):
        """_get_user_team_ids is called at most once even with multiple team configs."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-a"],
        ) as mock_team_ids:
            get_task_configs_for_user(user_email="dave@example.com")
        # Both Team AB Workflow and Team C Workflow are team-scoped; IDs resolved once
        assert mock_team_ids.call_count == 1

    def test_team_workflow_with_empty_shared_with_teams_is_excluded_for_non_owner(self, mock_get):
        """A team-visibility config with shared_with_teams=[] is not shown to a non-owner."""
        mock_get.return_value = {
            "Empty Teams Config": {
                "tasks": [{"display_text": "E", "llm_prompt": "empty", "subagent": "caipe"}],
                "owner_id": "alice@example.com",
                "is_system": False,
                "visibility": "team",
                "shared_with_teams": [],
            }
        }
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-a"],
        ):
            # bob is in team-a but shared_with_teams is empty → not visible to bob
            result = get_task_configs_for_user(user_email="bob@example.com")
        assert result is None  # no visible configs at all for non-owner

    def test_owner_sees_own_team_workflow_without_team_membership(self, mock_get):
        """Owner of a team workflow sees it via owner_id match, not team lookup."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=[],
        ) as mock_team_ids:
            result = get_task_configs_for_user(user_email="alice@example.com")
        # alice@example.com owns "Team AB Workflow" — seen via owner_id branch
        assert "Team AB Workflow" in result
        # Team lookup should NOT have been called for alice's own config (owner branch matches first)
        # (it may still be called for "Team C Workflow" which alice doesn't own)

    def test_global_and_system_always_visible_regardless_of_teams(self, mock_get):
        """Global task visible to every user, even those with no teams."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=[],
        ):
            result = get_task_configs_for_user(user_email="anyone@example.com")
        assert "Global Task" in result

    def test_private_task_hidden_from_non_owner_team_member(self, mock_get):
        """Owner-Only Task is not visible to a team member who is not the owner."""
        with patch(
            "ai_platform_engineering.utils.mongodb_client._get_user_team_ids",
            return_value=["team-a", "team-b"],
        ):
            result = get_task_configs_for_user(user_email="bob@example.com")
        assert "Owner-Only Task" not in result


# ============================================================================
# _get_user_team_ids unit tests
# ============================================================================


class TestGetUserTeamIds:
    """Unit tests for _get_user_team_ids using a mocked MongoDB client."""

    def _make_mock_client(self, team_docs: list) -> MagicMock:
        """Return a mock MongoClient whose teams.find() returns team_docs."""
        mock_find = MagicMock(return_value=iter(team_docs))
        mock_teams_coll = MagicMock()
        mock_teams_coll.find = mock_find
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_teams_coll)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        return mock_client

    def test_returns_team_ids_as_strings(self):
        """Team _id values are converted to str."""
        from bson import ObjectId

        oid = ObjectId()
        mock_client = self._make_mock_client([{"_id": oid}])
        with (
            patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=mock_client),
            patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}),
        ):
            result = _get_user_team_ids("alice@example.com")
        assert result == [str(oid)]

    def test_returns_multiple_team_ids(self):
        """Multiple team memberships return all IDs."""
        from bson import ObjectId

        oids = [ObjectId(), ObjectId(), ObjectId()]
        mock_client = self._make_mock_client([{"_id": o} for o in oids])
        with (
            patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=mock_client),
            patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}),
        ):
            result = _get_user_team_ids("alice@example.com")
        assert result == [str(o) for o in oids]

    def test_returns_empty_when_user_not_in_any_team(self):
        """User in no teams returns empty list."""
        mock_client = self._make_mock_client([])
        with (
            patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=mock_client),
            patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}),
        ):
            result = _get_user_team_ids("stranger@example.com")
        assert result == []

    def test_returns_empty_when_mongodb_unavailable(self):
        """No MongoDB connection → empty list (no exception raised)."""
        with patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=None):
            result = _get_user_team_ids("alice@example.com")
        assert result == []

    def test_returns_empty_on_pymongo_error(self):
        """PyMongoError during find is caught and returns empty list."""
        from pymongo.errors import PyMongoError

        mock_teams_coll = MagicMock()
        mock_teams_coll.find = MagicMock(side_effect=PyMongoError("connection reset"))
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_teams_coll)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)

        with (
            patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=mock_client),
            patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}),
        ):
            result = _get_user_team_ids("alice@example.com")
        assert result == []

    def test_queries_teams_collection_by_member_user_id(self):
        """Confirms the correct query filter is used: members.user_id == email."""
        mock_find = MagicMock(return_value=iter([]))
        mock_teams_coll = MagicMock()
        mock_teams_coll.find = mock_find
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_teams_coll)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)

        with (
            patch("ai_platform_engineering.utils.mongodb_client.get_mongodb_client", return_value=mock_client),
            patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}),
        ):
            _get_user_team_ids("bob@example.com")

        mock_find.assert_called_once_with(
            {"members.user_id": "bob@example.com"},
            {"_id": 1},
        )
