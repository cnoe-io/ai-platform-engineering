# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Tests for per-user task config scoping.

Run with: PYTHONPATH=. uv run pytest tests/test_task_config_user_scoping.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

from ai_platform_engineering.utils.mongodb_client import get_task_configs_for_user


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
