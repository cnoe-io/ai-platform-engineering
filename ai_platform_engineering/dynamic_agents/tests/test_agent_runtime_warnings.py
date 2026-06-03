"""MCP availability warning wording, split by failure class (US3).

Verifies that transient (still-warming) servers never get the alarming
permanent wording, permanent failures keep the actionable "will not work"
message with their error detail, and denials (carried on the permanent path)
are not relabeled as "starting up".
"""

from __future__ import annotations

from dynamic_agents.services.agent_runtime import (
    _build_mcp_warning_lines,
    _mcp_warning_events,
)


def test_permanent_lines_keep_needs_attention_and_detail():
    lines = _build_mcp_warning_lines(
        permanent=["github"],
        permanent_error="github: HTTP 404 Not Found from http://gw/mcp",
        transient=[],
    )
    joined = "\n".join(lines)
    assert "needs attention" in joined
    assert "github: HTTP 404 Not Found" in joined
    assert "starting up" not in joined


def test_transient_lines_say_starting_up_not_will_not_work():
    lines = _build_mcp_warning_lines(
        permanent=[],
        permanent_error="",
        transient=["argocd", "jira"],
    )
    joined = "\n".join(lines)
    assert "starting up" in joined
    assert "argocd" in joined and "jira" in joined
    assert "will not work" not in joined


def test_no_failures_yields_no_lines():
    assert _build_mcp_warning_lines([], "", []) == []


def test_events_permanent_uses_will_not_work():
    events = _mcp_warning_events(permanent=["github"], transient=[])
    assert events == ["MCP server 'github' is unavailable. Tools from this server will not work."]


def test_events_transient_uses_starting_up():
    events = _mcp_warning_events(permanent=[], transient=["argocd"])
    assert len(events) == 1
    assert "starting up" in events[0]
    assert "will not work" not in events[0]


def test_events_mixed_keeps_classes_distinct():
    events = _mcp_warning_events(permanent=["github"], transient=["argocd"])
    assert any("will not work" in e and "github" in e for e in events)
    assert any("starting up" in e and "argocd" in e for e in events)
