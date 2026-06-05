# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for AuditCallbackHandler."""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest

from ai_platform_engineering.utils.audit_callback import AuditCallbackHandler


@pytest.fixture
def handler():
    return AuditCallbackHandler(
        agent_name="test-agent",
        user_email="u@example.com",
        context_id="ctx-1",
        trace_id="trace-abc",
        tenant_id="t1",
    )


def test_disabled_skips_tool_events(handler):
    with patch.dict("os.environ", {"AUDIT_ENABLED": "false"}):
        h = AuditCallbackHandler(agent_name="a")
    rid = uuid4()
    with patch("ai_platform_engineering.utils.audit_callback.log_audit_event") as mock_log:
        h.on_tool_start({"name": "t1"}, "in", run_id=rid)
        h.on_tool_end("out", run_id=rid)
    mock_log.assert_not_called()


def test_tool_success_logs_audit(handler):
    rid = uuid4()
    with patch("ai_platform_engineering.utils.audit_callback.log_audit_event") as mock_log:
        handler.on_tool_start({"name": "my_tool"}, "input", run_id=rid)
        handler.on_tool_end("result", run_id=rid)
    mock_log.assert_called_once()
    kwargs = mock_log.call_args.kwargs
    assert kwargs["event_type"] == "tool_action"
    assert kwargs["outcome"] == "success"
    assert kwargs["tool_name"] == "my_tool"
    assert kwargs["agent_name"] == "test-agent"
    assert kwargs["correlation_id"] == "trace-abc"
    assert kwargs["context_id"] == "ctx-1"


def test_tool_error_logs_audit(handler):
    rid = uuid4()
    err = ValueError("boom")
    with patch("ai_platform_engineering.utils.audit_callback.log_audit_event") as mock_log:
        handler.on_tool_start({"name": "bad_tool"}, "in", run_id=rid)
        handler.on_tool_error(err, run_id=rid)
    mock_log.assert_called_once()
    kwargs = mock_log.call_args.kwargs
    assert kwargs["outcome"] == "error"
    assert kwargs["tool_name"] == "bad_tool"
    assert "boom" in kwargs["reason_code"]
