# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for ai_platform_engineering.utils.audit_logger."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import ai_platform_engineering.utils.audit_logger as audit_logger
import ai_platform_engineering.utils.audit_backend as audit_backend_module


@pytest.fixture(autouse=True)
def reset_backend_singleton():
    """Reset the backend singleton between tests."""
    original = audit_backend_module._backend
    audit_backend_module._backend = None
    yield
    audit_backend_module._backend = original


def test_hash_subject_is_stable():
    with patch.dict("os.environ", {"AUDIT_SUBJECT_SALT": "test-salt"}):
        h1 = audit_logger._hash_subject("user@example.com")
        h2 = audit_logger._hash_subject("user@example.com")
    assert h1 == h2
    assert h1.startswith("sha256:")


def test_log_audit_event_calls_backend_write():
    mock_backend = MagicMock()
    with patch.object(audit_logger, "get_audit_backend", return_value=mock_backend):
        ev = audit_logger.log_audit_event(
            event_type="auth",
            outcome="allow",
            action="test#view",
            user_email="alice@example.com",
            agent_name="supervisor",
        )

    mock_backend.write.assert_called_once_with(ev)
    assert ev["type"] == "auth"
    assert ev["outcome"] == "allow"
    assert ev["action"] == "test#view"
    assert ev["user_email"] == "alice@example.com"
    assert ev["agent_name"] == "supervisor"
    assert "correlation_id" in ev
    assert ev["subject_hash"].startswith("sha256:")


def test_log_audit_event_returns_event_with_required_fields():
    mock_backend = MagicMock()
    with patch.object(audit_logger, "get_audit_backend", return_value=mock_backend):
        ev = audit_logger.log_audit_event(
            event_type="tool_action",
            outcome="success",
            action="argocd_list_applications",
            tool_name="argocd",
        )
    assert ev["type"] == "tool_action"
    assert ev["tool_name"] == "argocd"
    assert ev["subject_hash"].startswith("sha256:")


def test_log_audit_event_always_calls_backend_write():
    """Verify write is called regardless of event content; backend is responsible for error handling."""
    mock_backend = MagicMock()
    with patch.object(audit_logger, "get_audit_backend", return_value=mock_backend):
        audit_logger.log_audit_event(
            event_type="auth",
            outcome="deny",
            action="admin_ui#view",
        )
    mock_backend.write.assert_called_once()
