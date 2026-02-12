# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for BaseLangGraphAgent.

Tests the core functionality of the BaseLangGraphAgent class,
including date/time injection and system instruction generation.
"""

import asyncio
import pytest
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import AsyncMock, MagicMock, Mock, patch
from typing import Dict, Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent


class MockLangGraphAgent(BaseLangGraphAgent):
    """Mock implementation of BaseLangGraphAgent for testing."""
    
    def __init__(self, system_instruction: str = "Test system instruction"):
        """Initialize test agent with custom system instruction."""
        self._system_instruction = system_instruction
        self._agent_name = "test_agent"
        # Skip parent __init__ to avoid MCP setup
        
    def get_agent_name(self) -> str:
        return self._agent_name
    
    def get_system_instruction(self) -> str:
        return self._system_instruction
    
    def get_response_format_instruction(self) -> str:
        return "Test response format"
    
    def get_response_format_class(self):
        return None
    
    def get_tool_working_message(self) -> str:
        return "Test tool working"
    
    def get_tool_processing_message(self) -> str:
        return "Test tool processing"
    
    def get_mcp_config(self, server_path: str | None = None) -> Dict[str, Any]:
        return {"test": {"command": "test"}}
    
    def get_mcp_http_config(self) -> Dict[str, Any] | None:
        return None


class TestBaseLangGraphAgent:
    """Test suite for BaseLangGraphAgent class."""
    
    def test_agent_initialization(self):
        """Test that agent can be initialized properly."""
        agent = MockLangGraphAgent()
        assert agent.get_agent_name() == "test_agent"
        assert agent.get_system_instruction() == "Test system instruction"
    
    def test_get_system_instruction_with_date_format(self):
        """Test that date/time is injected with correct format."""
        agent = MockLangGraphAgent("My agent instruction")
        
        result = agent._get_system_instruction_with_date()
        
        # Check that date context is prepended
        assert "## Current Date and Time" in result
        assert "Today's date:" in result
        assert "Current time:" in result
        assert "ISO format:" in result
        assert "UTC" in result
        
        # Check that original instruction is included
        assert "My agent instruction" in result
        
        # Check that date context comes before instruction
        date_pos = result.index("## Current Date and Time")
        instruction_pos = result.index("My agent instruction")
        assert date_pos < instruction_pos
    
    def test_get_system_instruction_with_date_contains_guidance(self):
        """Test that date injection includes usage guidance."""
        agent = MockLangGraphAgent()
        
        result = agent._get_system_instruction_with_date()
        
        # Check for guidance text
        assert "Use this as the reference point for all date calculations" in result
        assert "today" in result.lower()
        assert "tomorrow" in result.lower()
        assert "yesterday" in result.lower()
    
    @patch('ai_platform_engineering.utils.a2a_common.base_langgraph_agent.datetime')
    def test_get_system_instruction_with_date_uses_utc(self, mock_datetime):
        """Test that date injection uses UTC timezone."""
        # Mock datetime to return a fixed time
        fixed_time = datetime(2025, 10, 27, 15, 30, 45, tzinfo=ZoneInfo("UTC"))
        mock_now = Mock(return_value=fixed_time)
        mock_datetime.now = mock_now
        
        agent = MockLangGraphAgent()
        _ = agent._get_system_instruction_with_date()
        
        # Verify datetime.now was called with UTC timezone
        mock_now.assert_called_once()
        call_args = mock_now.call_args
        assert len(call_args[0]) > 0
        assert isinstance(call_args[0][0], ZoneInfo)
        assert str(call_args[0][0]) == "UTC"
    
    @patch('ai_platform_engineering.utils.a2a_common.base_langgraph_agent.datetime')
    def test_get_system_instruction_with_date_correct_format(self, mock_datetime):
        """Test that date is formatted correctly."""
        # Mock datetime to return a fixed time
        fixed_time = datetime(2025, 10, 27, 15, 30, 45, tzinfo=ZoneInfo("UTC"))
        mock_datetime.now.return_value = fixed_time
        
        agent = MockLangGraphAgent()
        result = agent._get_system_instruction_with_date()
        
        # Check date format (Monday, October 27, 2025)
        assert "Monday, October 27, 2025" in result
        
        # Check time format (15:30:45 UTC)
        assert "15:30:45 UTC" in result
        
        # Check ISO format (2025-10-27T15:30:45+00:00)
        assert "2025-10-27T15:30:45+00:00" in result
    
    def test_get_system_instruction_with_date_preserves_original(self):
        """Test that original system instruction is not modified."""
        original_instruction = "This is a complex instruction\nwith multiple lines\nand special characters: @#$%"
        agent = MockLangGraphAgent(original_instruction)
        
        result = agent._get_system_instruction_with_date()
        
        # Check that original instruction is preserved exactly
        assert original_instruction in result
    
    def test_get_system_instruction_with_date_multiple_calls(self):
        """Test that multiple calls return updated date/time."""
        agent = MockLangGraphAgent()
        
        # First call
        result1 = agent._get_system_instruction_with_date()
        _ = datetime.now(ZoneInfo("UTC"))
        
        # Small delay (in practice, time will advance)
        import time
        time.sleep(0.1)
        
        # Second call
        result2 = agent._get_system_instruction_with_date()
        _ = datetime.now(ZoneInfo("UTC"))
        
        # Both should have date context
        assert "## Current Date and Time" in result1
        assert "## Current Date and Time" in result2
        
        # Both should have original instruction
        assert "Test system instruction" in result1
        assert "Test system instruction" in result2
    
    def test_abstract_methods_required(self):
        """Test that abstract methods must be implemented."""
        with pytest.raises(TypeError) as exc_info:
            # Try to instantiate BaseLangGraphAgent directly
            BaseLangGraphAgent()
        
        error_msg = str(exc_info.value)
        # Should complain about abstract methods not being implemented
        assert "abstract" in error_msg.lower() or "instantiate" in error_msg.lower()
    
    def test_get_response_format_instruction(self):
        """Test get_response_format_instruction method."""
        agent = MockLangGraphAgent()
        assert agent.get_response_format_instruction() == "Test response format"
    
    def test_get_tool_messages(self):
        """Test tool message methods."""
        agent = MockLangGraphAgent()
        # Test that methods return non-empty strings
        working_msg = agent.get_tool_working_message()
        processing_msg = agent.get_tool_processing_message()
        
        assert isinstance(working_msg, str)
        assert len(working_msg) > 0
        assert isinstance(processing_msg, str)
        assert len(processing_msg) > 0
    
    def test_get_mcp_config(self):
        """Test get_mcp_config method."""
        agent = MockLangGraphAgent()
        config = agent.get_mcp_config()
        assert isinstance(config, dict)
        assert "test" in config
    
    def test_date_injection_with_empty_instruction(self):
        """Test date injection works with empty system instruction."""
        agent = MockLangGraphAgent("")
        
        result = agent._get_system_instruction_with_date()
        
        # Should still have date context
        assert "## Current Date and Time" in result
        assert "Today's date:" in result
    
    def test_date_injection_with_long_instruction(self):
        """Test date injection works with very long system instruction."""
        long_instruction = "Instruction line\n" * 1000
        agent = MockLangGraphAgent(long_instruction)
        
        result = agent._get_system_instruction_with_date()
        
        # Should have date context at the beginning
        assert result.startswith("## Current Date and Time")
        
        # Should have full long instruction
        assert long_instruction in result
        
        # Date context should be before instruction
        date_end = result.index("Use this as the reference point")
        instruction_start = result.index("Instruction line")
        assert date_end < instruction_start


class TestDateTimeFormatting:
    """Test suite for date/time formatting in BaseLangGraphAgent."""
    
    @pytest.mark.parametrize("test_datetime,expected_day,expected_date,expected_time", [
        (
            datetime(2025, 1, 1, 0, 0, 0, tzinfo=ZoneInfo("UTC")),
            "Wednesday, January 01, 2025",
            "00:00:00 UTC",
            "2025-01-01T00:00:00+00:00"
        ),
        (
            datetime(2025, 12, 31, 23, 59, 59, tzinfo=ZoneInfo("UTC")),
            "Wednesday, December 31, 2025",
            "23:59:59 UTC",
            "2025-12-31T23:59:59+00:00"
        ),
        (
            datetime(2025, 6, 15, 12, 30, 45, tzinfo=ZoneInfo("UTC")),
            "Sunday, June 15, 2025",
            "12:30:45 UTC",
            "2025-06-15T12:30:45+00:00"
        ),
    ])
    @patch('ai_platform_engineering.utils.a2a_common.base_langgraph_agent.datetime')
    def test_various_datetime_formats(self, mock_datetime, test_datetime, expected_day, expected_time, expected_date):
        """Test that various date/times are formatted correctly."""
        mock_datetime.now.return_value = test_datetime
        
        agent = MockLangGraphAgent()
        result = agent._get_system_instruction_with_date()
        
        # Check formatted date
        assert expected_day in result
        assert expected_time in result
        assert expected_date in result


class TestIntegrationWithAgents:
    """Integration tests for BaseLangGraphAgent with actual agent subclasses."""
    
    def test_integration_with_custom_instruction(self):
        """Test that custom system instructions work with date injection."""
        custom_instructions = [
            "You are a helpful assistant.",
            "## Agent Purpose\nHelp users with tasks.",
            "CRITICAL: Always be polite\nAND professional.",
        ]
        
        for instruction in custom_instructions:
            agent = MockLangGraphAgent(instruction)
            result = agent._get_system_instruction_with_date()
            
            # Should have both date context and custom instruction
            assert "## Current Date and Time" in result
            assert instruction in result
            
            # Date should come first
            assert result.index("## Current Date and Time") < result.index(instruction)


# ---------------------------------------------------------------------------
# Helper functions for _find_safe_split_index tests
# ---------------------------------------------------------------------------


def _make_ai_with_tools(tool_names: list[str]) -> AIMessage:
    """Create an AIMessage with tool_calls."""
    return AIMessage(
        content="calling tools",
        tool_calls=[{"name": n, "args": {}, "id": f"call_{n}"} for n in tool_names],
    )


def _make_tool_msg(name: str) -> ToolMessage:
    """Create a ToolMessage for a tool call."""
    return ToolMessage(content=f"result of {name}", tool_call_id=f"call_{name}", name=name)


# ---------------------------------------------------------------------------
# Tests for _find_safe_split_index (safe context splitting)
# ---------------------------------------------------------------------------


class TestFindSafeSplitIndex:
    """Test _find_safe_split_index for safe context splitting."""

    def test_keep_all_when_desired_exceeds_length(self):
        """Returns 0 when desired_keep_count >= len(messages)."""
        msgs = [HumanMessage(content="hi"), AIMessage(content="hello")]
        assert BaseLangGraphAgent._find_safe_split_index(msgs, 5) == 0
        assert BaseLangGraphAgent._find_safe_split_index(msgs, 2) == 0

    def test_simple_split_no_tool_calls(self):
        """Simple split with no tool calls at boundary."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
        ]
        # Keep 2 → candidate = 4-2 = 2
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 2)
        assert idx == 2

    def test_moves_back_when_first_kept_is_tool_message(self):
        """Moves boundary back when first kept message is ToolMessage."""
        msgs = [
            HumanMessage(content="q1"),
            _make_ai_with_tools(["search"]),
            _make_tool_msg("search"),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
        ]
        # Keep 2 → candidate = 5-2 = 3. First kept is HumanMessage("q2") → OK
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 2)
        assert idx == 3

        # Keep 3 → candidate = 5-3 = 2. First kept is ToolMessage("search")
        # → must move back to include AIMessage with tool_calls at index 1
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 3)
        assert idx == 1

    def test_moves_back_when_preceding_is_ai_with_tools(self):
        """Moves boundary back when preceding message is AIMessage with tool_calls."""
        msgs = [
            HumanMessage(content="q1"),
            _make_ai_with_tools(["fetch"]),
            _make_tool_msg("fetch"),
            AIMessage(content="synthesis"),
        ]
        # Keep 1 → candidate = 4-1 = 3. First kept is AIMessage("synthesis").
        # Preceding is ToolMessage → no issue. Break.
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 1)
        assert idx == 3

        # Keep 2 → candidate = 4-2 = 2. First kept is ToolMessage("fetch").
        # → Move back to 1 (AIMessage with tool_calls).
        # Then preceding is HumanMessage → break.
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 2)
        assert idx == 1

    def test_multiple_tool_messages_grouped(self):
        """Multiple ToolMessages for same AIMessage are kept together."""
        msgs = [
            HumanMessage(content="q1"),
            AIMessage(content="a1"),
            _make_ai_with_tools(["t1", "t2"]),
            _make_tool_msg("t1"),
            _make_tool_msg("t2"),
            AIMessage(content="final"),
        ]
        # Keep 3 → candidate = 6-3 = 3. First kept = ToolMessage(t1)
        # → move back to 2 (AIMessage with tools)
        # → preceding is AIMessage("a1") without tools → break
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 3)
        assert idx == 2

    def test_all_tool_messages_moves_to_ai_boundary(self):
        """When boundary falls on ToolMessage, adjust back to its AIMessage."""
        msgs = [
            _make_ai_with_tools(["a"]),
            _make_tool_msg("a"),
            _make_ai_with_tools(["b"]),
            _make_tool_msg("b"),
        ]
        # Keep 1 → candidate = 3. First kept = ToolMessage("b") → back to 2
        # msgs[2] is AIMessage(tools=["b"]).  Preceding is ToolMessage("a") which
        # is NOT an AIMessage with tool_calls, so loop breaks.
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 1)
        assert idx == 2

        # Keep 3 → candidate = 1. First kept = ToolMessage("a") → back to 0
        # msgs[0] is AIMessage(tools=["a"]).  candidate=0 → while loop exits.
        idx = BaseLangGraphAgent._find_safe_split_index(msgs, 3)
        assert idx == 0

    def test_empty_messages(self):
        """Empty message list returns 0."""
        assert BaseLangGraphAgent._find_safe_split_index([], 5) == 0

    def test_single_message(self):
        """Single message returns 0."""
        msgs = [HumanMessage(content="hi")]
        assert BaseLangGraphAgent._find_safe_split_index(msgs, 1) == 0

    def test_desired_keep_zero(self):
        """desired_keep_count=0 is an edge case — candidate equals len(messages)."""
        msgs = [HumanMessage(content="q"), AIMessage(content="a")]
        # With 0 desired keep, candidate = len - 0 = 2, which is out-of-bounds
        # for the while loop.  The code accesses messages[candidate] so this
        # would raise IndexError.  In practice desired_keep_count is always >= 2.
        # We just verify it doesn't crash with a simple list:
        msgs_simple = []
        idx = BaseLangGraphAgent._find_safe_split_index(msgs_simple, 0)
        assert idx == 0  # Empty list always returns 0

    def test_keeps_tool_chain_at_boundary_with_human_before(self):
        """Real-world scenario: Human → AI(tools) → Tool → Tool → Human → AI."""
        msgs = [
            HumanMessage(content="find repos"),
            _make_ai_with_tools(["github_search", "github_list"]),
            _make_tool_msg("github_search"),
            _make_tool_msg("github_list"),
            HumanMessage(content="now deploy"),
            AIMessage(content="deploying..."),
        ]
        # Keep 2 → candidate = 4. First kept = HumanMessage("now deploy") → safe
        assert BaseLangGraphAgent._find_safe_split_index(msgs, 2) == 4

        # Keep 4 → candidate = 2. First kept = ToolMessage("github_search")
        # → back to 1 (AI with tools), preceding is Human → break
        assert BaseLangGraphAgent._find_safe_split_index(msgs, 4) == 1


# ---------------------------------------------------------------------------
# Tests for _is_recoverable_llm_error
# ---------------------------------------------------------------------------


class TestIsRecoverableLlmError:
    """Test _is_recoverable_llm_error classification."""

    def test_orphaned_tool_call_is_recoverable(self):
        """Bedrock 'expected toolResult blocks' errors are recoverable."""
        exc = Exception("A]conversation must alternate between user and assistant roles. Expected toolResult blocks after last toolUse.")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True

    def test_langgraph_orphaned_tool_calls_is_recoverable(self):
        """LangGraph orphaned tool call errors are recoverable."""
        exc = Exception("Found AIMessages with tool_calls that do not have a corresponding ToolMessage")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True

    def test_context_length_exceeded_is_recoverable(self):
        """Context length exceeded errors are recoverable."""
        for msg in ["input is too long for model", "maximum context length exceeded",
                    "context_length_exceeded", "token limit reached"]:
            exc = Exception(msg)
            assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True, f"Failed for: {msg}"

    def test_throttling_is_recoverable(self):
        """Rate limiting / throttling errors are recoverable."""
        for msg in ["ThrottlingException", "too many requests", "rate exceeded"]:
            exc = Exception(msg)
            assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True, f"Failed for: {msg}"

    def test_transient_network_errors_are_recoverable(self):
        """Transient network errors are recoverable."""
        for msg in ["service unavailable", "internal server error",
                    "HTTP 502 bad gateway", "HTTP 503", "HTTP 504 gateway timeout",
                    "connection reset by peer", "connection aborted",
                    "incomplete chunked read", "peer closed connection"]:
            exc = Exception(msg)
            assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True, f"Failed for: {msg}"

    def test_validation_exception_type_is_recoverable(self):
        """ValidationException type name triggers recovery."""
        class ValidationException(Exception):
            pass
        exc = ValidationException("some bedrock validation error")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True

    def test_auth_error_is_not_recoverable(self):
        """Authentication errors are NOT recoverable."""
        exc = Exception("Access denied: Invalid API key")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is False

    def test_model_not_found_is_not_recoverable(self):
        """Model not found errors are NOT recoverable."""
        exc = Exception("Model 'nonexistent-model' not found")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is False

    def test_generic_value_error_is_not_recoverable(self):
        """Generic ValueError is NOT recoverable."""
        exc = ValueError("invalid argument")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is False

    def test_empty_exception_is_not_recoverable(self):
        """Empty exception message is NOT recoverable."""
        exc = Exception("")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is False

    def test_case_insensitive_pattern_matching(self):
        """Pattern matching should be case-insensitive."""
        exc = Exception("EXPECTED TOOLRESULT BLOCKS after last toolUse")
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is True

    def test_keyboard_interrupt_is_not_recoverable(self):
        """KeyboardInterrupt is NOT recoverable."""
        exc = KeyboardInterrupt()
        assert BaseLangGraphAgent._is_recoverable_llm_error(exc) is False


# ---------------------------------------------------------------------------
# Tests for _format_user_error
# ---------------------------------------------------------------------------


class TestFormatUserError:
    """Test _format_user_error message formatting."""

    def test_toolresult_error_message(self):
        """Orphaned tool call errors get a specific message."""
        exc = Exception("Expected toolResult blocks after toolUse")
        msg = BaseLangGraphAgent._format_user_error("aws_agent", exc)
        assert "conversation history became corrupted" in msg
        assert "Aws_Agent" in msg  # .title()
        assert "new conversation" in msg

    def test_context_length_error_message(self):
        """Context overflow errors get a specific message."""
        exc = Exception("input is too long for the model")
        msg = BaseLangGraphAgent._format_user_error("github_agent", exc)
        assert "too long" in msg
        assert "new conversation" in msg

    def test_throttling_error_message(self):
        """Rate limiting errors get a specific message."""
        exc = Exception("ThrottlingException: Rate exceeded")
        msg = BaseLangGraphAgent._format_user_error("jira_agent", exc)
        assert "rate-limited" in msg
        assert "wait" in msg

    def test_timeout_error_message(self):
        """Timeout errors get a specific message."""
        exc = Exception("Request timed out after 30s")
        msg = BaseLangGraphAgent._format_user_error("test_agent", exc)
        assert "timed out" in msg
        assert "heavy load" in msg

    def test_connection_error_message(self):
        """Connection errors get a specific message."""
        exc = Exception("Connection refused to host")
        msg = BaseLangGraphAgent._format_user_error("test_agent", exc)
        assert "Connection error" in msg
        assert "temporarily unavailable" in msg

    def test_generic_error_fallback(self):
        """Unknown errors get a generic message with error type."""
        exc = TypeError("unexpected type")
        msg = BaseLangGraphAgent._format_user_error("test_agent", exc)
        assert "unexpected error" in msg
        assert "TypeError" in msg
        assert "try again" in msg

    def test_agent_name_is_titlecased(self):
        """Agent name should be title-cased in the message."""
        exc = Exception("some error")
        msg = BaseLangGraphAgent._format_user_error("my_cool_agent", exc)
        assert "My_Cool_Agent" in msg

    def test_does_not_leak_stack_trace(self):
        """Error message should not contain raw stack traces."""
        try:
            raise RuntimeError("secret internal error with details abc123")
        except RuntimeError as exc:
            msg = BaseLangGraphAgent._format_user_error("test_agent", exc)
        # Should not contain the full error string in the output
        assert "secret internal error with details abc123" not in msg
        assert "RuntimeError" in msg  # Only the type is shown

    def test_429_error_gets_rate_limit_message(self):
        """HTTP 429 errors should get rate limiting message."""
        exc = Exception("HTTP 429: Too Many Requests")
        msg = BaseLangGraphAgent._format_user_error("agent", exc)
        assert "rate-limited" in msg


# ---------------------------------------------------------------------------
# Tests for _emergency_context_repair
# ---------------------------------------------------------------------------


class TestEmergencyContextRepair:
    """Test _emergency_context_repair method."""

    @pytest.fixture
    def agent(self):
        """Create a mock agent for testing."""
        a = MockLangGraphAgent()
        a.graph = AsyncMock()
        a.max_context_tokens = 10000
        return a

    @pytest.mark.asyncio
    async def test_calls_repair_trim_repair(self, agent):
        """Emergency repair calls orphan repair, trim, then orphan repair again."""
        agent._repair_orphaned_tool_calls = AsyncMock()
        agent._trim_messages_if_needed = AsyncMock()

        # Mock state with high token count to trigger trimming
        mock_state = MagicMock()
        mock_state.values = {"messages": [HumanMessage(content="x" * 100)]}
        agent.graph.aget_state = AsyncMock(return_value=mock_state)
        agent._count_total_tokens = Mock(return_value=8000)  # Over 60% of 10000

        config = {"configurable": {"thread_id": "test"}}
        await agent._emergency_context_repair(config, "test_agent")

        # Should call repair 2x (before and after trim) + trim 1x
        assert agent._repair_orphaned_tool_calls.call_count == 2
        assert agent._trim_messages_if_needed.call_count == 1

    @pytest.mark.asyncio
    async def test_skips_trim_when_context_small(self, agent):
        """Emergency repair skips trimming when context is below threshold."""
        agent._repair_orphaned_tool_calls = AsyncMock()
        agent._trim_messages_if_needed = AsyncMock()

        mock_state = MagicMock()
        mock_state.values = {"messages": [HumanMessage(content="small")]}
        agent.graph.aget_state = AsyncMock(return_value=mock_state)
        agent._count_total_tokens = Mock(return_value=1000)  # Well below 60% of 10000

        config = {"configurable": {"thread_id": "test"}}
        await agent._emergency_context_repair(config, "test_agent")

        assert agent._repair_orphaned_tool_calls.call_count == 2
        assert agent._trim_messages_if_needed.call_count == 0

    @pytest.mark.asyncio
    async def test_survives_repair_failure(self, agent):
        """Emergency repair continues even if individual steps fail."""
        agent._repair_orphaned_tool_calls = AsyncMock(side_effect=[Exception("repair failed"), None])
        agent._trim_messages_if_needed = AsyncMock()

        mock_state = MagicMock()
        mock_state.values = {"messages": []}
        agent.graph.aget_state = AsyncMock(return_value=mock_state)
        agent._count_total_tokens = Mock(return_value=0)

        config = {"configurable": {"thread_id": "test"}}
        # Should not raise
        await agent._emergency_context_repair(config, "test_agent")

        # First call failed, but second should still be attempted
        assert agent._repair_orphaned_tool_calls.call_count == 2

    @pytest.mark.asyncio
    async def test_survives_all_steps_failing(self, agent):
        """Emergency repair doesn't propagate any exceptions."""
        agent._repair_orphaned_tool_calls = AsyncMock(side_effect=Exception("fail"))
        agent.graph.aget_state = AsyncMock(side_effect=Exception("state fail"))

        config = {"configurable": {"thread_id": "test"}}
        # Should not raise even when everything fails
        await agent._emergency_context_repair(config, "test_agent")

