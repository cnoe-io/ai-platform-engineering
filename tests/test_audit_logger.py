# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for ai_platform_engineering.utils.audit_logger."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import ai_platform_engineering.utils.audit_logger as audit_logger


@pytest.fixture(autouse=True)
def reset_audit_module_state():
    audit_logger._indexes_ensured = False
    yield
    audit_logger._indexes_ensured = False


def test_hash_subject_is_stable():
    with patch.dict("os.environ", {"AUDIT_SUBJECT_SALT": "test-salt"}):
        h1 = audit_logger._hash_subject("user@example.com")
        h2 = audit_logger._hash_subject("user@example.com")
    assert h1 == h2
    assert h1.startswith("sha256:")


def test_log_audit_event_returns_event_shape():
    with patch.object(audit_logger, "_persist_to_mongo", lambda _e: None):
        ev = audit_logger.log_audit_event(
            event_type="auth",
            outcome="allow",
            action="test#view",
            user_email="alice@example.com",
            agent_name="supervisor",
        )
    assert ev["type"] == "auth"
    assert ev["outcome"] == "allow"
    assert ev["action"] == "test#view"
    assert ev["user_email"] == "alice@example.com"
    assert ev["agent_name"] == "supervisor"
    assert "correlation_id" in ev
    assert ev["subject_hash"].startswith("sha256:")


def test_persist_to_mongo_skips_when_no_client():
    with patch.object(audit_logger, "get_mongodb_client", return_value=None):
        audit_logger._persist_to_mongo({"ts": "x", "type": "auth"})


def test_persist_to_mongo_inserts_and_ensures_indexes():
    mock_coll = MagicMock()
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_coll
    mock_client = MagicMock()
    mock_client.__getitem__.return_value = mock_db

    with patch.object(audit_logger, "get_mongodb_client", return_value=mock_client):
        with patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}):
            audit_logger._persist_to_mongo({"type": "tool_action", "action": "t"})

    mock_coll.insert_one.assert_called_once()
    mock_coll.create_index.assert_called()


def test_persist_to_mongo_swallows_pymongo_error():
    from pymongo.errors import PyMongoError

    mock_coll = MagicMock()
    mock_coll.insert_one.side_effect = PyMongoError("down")
    mock_coll.create_index = MagicMock()
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_coll
    mock_client = MagicMock()
    mock_client.__getitem__.return_value = mock_db

    with patch.object(audit_logger, "get_mongodb_client", return_value=mock_client):
        with patch.dict("os.environ", {"MONGODB_DATABASE": "caipe"}):
            audit_logger._persist_to_mongo({"type": "auth"})
