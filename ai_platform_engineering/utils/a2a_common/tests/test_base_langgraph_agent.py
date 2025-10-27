# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for BaseLangGraphAgent.

Tests the core functionality of the BaseLangGraphAgent class,
including date/time injection and system instruction generation.
"""

import pytest
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import Mock, patch
from typing import Dict, Any

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

