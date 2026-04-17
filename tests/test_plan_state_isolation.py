# assisted-by claude code claude-opus-4-6
"""
Unit tests for PlanState session isolation.

Verifies that execution plan state is per-request (local to each stream()
call) and does not leak across concurrent chat sessions on the singleton
AIPlatformEngineerA2ABinding.

Usage:
    pytest tests/test_plan_state_isolation.py -v
"""

import pytest

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    PlanState,
    AIPlatformEngineerA2ABinding,
)


class TestPlanStateDataclass:
    """Test that PlanState initialises with clean defaults."""

    def test_defaults(self):
        ps = PlanState()
        assert ps.execution_plan_sent is False
        assert ps.previous_todos == {}
        assert ps.task_plan_entries == {}
        assert ps.in_self_service_workflow is False

    def test_independent_instances(self):
        """Two PlanState instances must not share mutable containers."""
        a = PlanState()
        b = PlanState()
        a.previous_todos[1] = {"status": "completed", "content": "Step 1"}
        a.task_plan_entries["tc-1"] = {"subagent": "github", "description": "x", "status": "in_progress"}
        a.execution_plan_sent = True
        a.in_self_service_workflow = True

        # b must be untouched
        assert b.previous_todos == {}
        assert b.task_plan_entries == {}
        assert b.execution_plan_sent is False
        assert b.in_self_service_workflow is False


class TestBuildPlanTextMethods:
    """Test that helper methods use the passed PlanState, not instance state."""

    @pytest.fixture
    def binding(self):
        """Create a minimal binding without full initialisation.

        We only need the _build_*_plan_text helpers which don't touch
        the graph or MAS instance, so we can bypass __init__ safely.
        """
        obj = object.__new__(AIPlatformEngineerA2ABinding)
        return obj

    def test_build_task_plan_text_uses_plan_arg(self, binding):
        plan = PlanState()
        plan.task_plan_entries = {
            "tc-1": {"subagent": "github", "description": "Fetch PRs", "status": "completed"},
            "tc-2": {"subagent": "jira", "description": "Search tickets", "status": "in_progress"},
        }
        text = binding._build_task_plan_text(plan)
        assert "Github" in text  # .title() produces "Github"
        assert "Fetch PRs" in text
        assert "Jira" in text

    def test_build_todo_plan_text_uses_plan_arg(self, binding):
        plan = PlanState()
        plan.previous_todos = {
            0: {"status": "completed", "content": "[GitHub] Fetch PRs"},
            1: {"status": "pending", "content": "[Jira] Create ticket"},
        }
        text = binding._build_todo_plan_text(plan)
        assert "✅" in text
        assert "⏳" in text
        assert "[GitHub] Fetch PRs" in text
        assert "[Jira] Create ticket" in text

    def test_empty_plan_produces_empty_text(self, binding):
        plan = PlanState()
        assert binding._build_task_plan_text(plan) == ""
        assert binding._build_todo_plan_text(plan) == ""


class TestBindingHasNoPlanInstanceState:
    """Ensure the singleton binding no longer carries plan state as instance attributes."""

    def test_no_leaking_instance_attributes(self):
        """AIPlatformEngineerA2ABinding.__init__ must not set the old plan attributes."""
        # We check the class source rather than instantiating (which requires MAS/LLM).
        import inspect
        source = inspect.getsource(AIPlatformEngineerA2ABinding.__init__)
        for attr in ("_execution_plan_sent", "_previous_todos",
                     "_task_plan_entries", "_in_self_service_workflow"):
            assert attr not in source, (
                f"Instance attribute {attr} still exists on the binding — "
                "it should have been moved to PlanState"
            )
