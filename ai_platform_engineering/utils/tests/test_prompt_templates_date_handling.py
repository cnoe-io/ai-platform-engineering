# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for date handling functionality in prompt_templates.py.

Tests the DATE_HANDLING_NOTES and include_date_handling parameter
added for automatic date/time awareness in agents.
"""

from ai_platform_engineering.utils.prompt_templates import (
    DATE_HANDLING_NOTES,
    scope_limited_agent_instruction,
    build_system_instruction,
)


class TestDateHandlingNotes:
    """Test suite for DATE_HANDLING_NOTES constant."""
    
    def test_date_handling_notes_exists(self):
        """Test that DATE_HANDLING_NOTES is defined."""
        assert DATE_HANDLING_NOTES is not None
        assert isinstance(DATE_HANDLING_NOTES, list)
    
    def test_date_handling_notes_not_empty(self):
        """Test that DATE_HANDLING_NOTES contains guidance."""
        assert len(DATE_HANDLING_NOTES) > 0
    
    def test_date_handling_notes_contains_key_concepts(self):
        """Test that DATE_HANDLING_NOTES contains key date handling concepts."""
        notes_text = " ".join(DATE_HANDLING_NOTES)
        
        # Check for key concepts
        assert "current date" in notes_text.lower()
        assert "reference point" in notes_text.lower()
        
        # Check for relative date examples
        assert any(word in notes_text.lower() for word in ["today", "tomorrow", "yesterday"])
        
        # Check for format guidance
        assert "YYYY-MM-DD" in notes_text or "format" in notes_text.lower()
    
    def test_date_handling_notes_are_strings(self):
        """Test that all DATE_HANDLING_NOTES items are strings."""
        for note in DATE_HANDLING_NOTES:
            assert isinstance(note, str)
            assert len(note) > 0


class TestScopeLimitedAgentInstructionWithDateHandling:
    """Test suite for scope_limited_agent_instruction with date handling."""
    
    def test_scope_limited_agent_instruction_default_no_date(self):
        """Test that date handling is not included by default."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations"
        )
        
        # Should not contain date handling notes by default
        for note in DATE_HANDLING_NOTES:
            assert note not in result
    
    def test_scope_limited_agent_instruction_with_date_handling(self):
        """Test that date handling is included when enabled."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            include_date_handling=True
        )
        
        # Should contain date handling concepts
        result_lower = result.lower()
        assert "current date" in result_lower or "date" in result_lower
    
    def test_scope_limited_agent_instruction_date_handling_with_other_features(self):
        """Test that date handling works alongside other features."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            additional_guidelines=["Guideline 1", "Guideline 2"],
            include_error_handling=True,
            include_date_handling=True
        )
        
        # Should contain service name
        assert "TestService" in result or "TESTSERVICE" in result
        
        # Should contain operations
        assert "test operations" in result
        
        # Should contain additional guidelines
        assert "Guideline 1" in result
        assert "Guideline 2" in result
        
        # Should contain error handling
        assert "error" in result.lower()
        
        # Should contain date handling
        result_lower = result.lower()
        assert "date" in result_lower
    
    def test_scope_limited_agent_instruction_date_handling_false(self):
        """Test that date handling is excluded when explicitly disabled."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            include_date_handling=False
        )
        
        # Should not contain date handling notes
        for note in DATE_HANDLING_NOTES:
            assert note not in result


class TestBuildSystemInstructionWithDateHandling:
    """Test suite for build_system_instruction with date handling."""
    
    def test_build_system_instruction_with_date_notes(self):
        """Test that date notes can be included in important_notes."""
        result = build_system_instruction(
            agent_name="TEST AGENT",
            agent_purpose="Test purpose",
            important_notes=DATE_HANDLING_NOTES
        )
        
        # Should contain date handling guidance
        result_lower = result.lower()
        assert "date" in result_lower
        assert any(word in result_lower for word in ["today", "tomorrow", "yesterday"])
    
    def test_build_system_instruction_date_notes_with_other_notes(self):
        """Test that date notes can be combined with other important notes."""
        other_notes = ["Important note 1", "Important note 2"]
        combined_notes = other_notes + DATE_HANDLING_NOTES
        
        result = build_system_instruction(
            agent_name="TEST AGENT",
            agent_purpose="Test purpose",
            important_notes=combined_notes
        )
        
        # Should contain all notes
        assert "Important note 1" in result
        assert "Important note 2" in result
        
        # Should contain date handling
        result_lower = result.lower()
        assert "date" in result_lower


class TestDateHandlingIntegration:
    """Integration tests for date handling across different agent types."""
    
    def test_date_handling_for_time_sensitive_agent(self):
        """Test date handling for agents that need temporal awareness."""
        result = scope_limited_agent_instruction(
            service_name="PagerDuty",
            service_operations="manage incidents and schedules",
            additional_guidelines=[
                "Query incidents by date range",
                "Check on-call schedules"
            ],
            include_date_handling=True
        )
        
        # Should have service-specific content
        assert "PagerDuty" in result or "PAGERDUTY" in result
        assert "incidents" in result.lower()
        assert "schedules" in result.lower()
        
        # Should have date handling
        result_lower = result.lower()
        assert "date" in result_lower
    
    def test_date_handling_for_log_search_agent(self):
        """Test date handling for agents that search time-based data."""
        result = scope_limited_agent_instruction(
            service_name="Splunk",
            service_operations="search logs and analyze data",
            additional_guidelines=[
                "Use time ranges for log queries",
                "Search by earliest and latest timestamps"
            ],
            include_date_handling=True
        )
        
        # Should have service-specific content
        assert "Splunk" in result or "SPLUNK" in result
        assert "logs" in result.lower()
        
        # Should have date handling
        result_lower = result.lower()
        assert "date" in result_lower or "time" in result_lower
    
    def test_date_handling_for_issue_tracking_agent(self):
        """Test date handling for agents that track issues over time."""
        result = scope_limited_agent_instruction(
            service_name="Jira",
            service_operations="manage issues and projects",
            additional_guidelines=[
                "Search issues by created date",
                "Filter by resolution date"
            ],
            include_date_handling=True
        )
        
        # Should have service-specific content
        assert "Jira" in result or "JIRA" in result
        assert "issues" in result.lower()
        
        # Should have date handling
        result_lower = result.lower()
        assert "date" in result_lower


class TestDateHandlingEdgeCases:
    """Test edge cases for date handling functionality."""
    
    def test_empty_service_name_with_date_handling(self):
        """Test that date handling works even with empty service name."""
        result = scope_limited_agent_instruction(
            service_name="",
            service_operations="test operations",
            include_date_handling=True
        )
        
        # Should still include date handling
        result_lower = result.lower()
        assert "date" in result_lower
    
    def test_empty_operations_with_date_handling(self):
        """Test that date handling works even with empty operations."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="",
            include_date_handling=True
        )
        
        # Should still include date handling
        result_lower = result.lower()
        assert "date" in result_lower
    
    def test_multiple_calls_same_result(self):
        """Test that multiple calls with same params return same result."""
        result1 = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            include_date_handling=True
        )
        
        result2 = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            include_date_handling=True
        )
        
        # Results should be identical
        assert result1 == result2
    
    def test_date_handling_with_all_optional_params(self):
        """Test date handling when all optional parameters are provided."""
        result = scope_limited_agent_instruction(
            service_name="TestService",
            service_operations="test operations",
            additional_guidelines=["Guideline 1"],
            include_error_handling=True,
            include_date_handling=True
        )
        
        # Should have all components
        assert "TestService" in result or "TESTSERVICE" in result
        assert "test operations" in result
        assert "Guideline 1" in result
        assert "error" in result.lower()
        assert "date" in result.lower()


class TestDateHandlingDocumentation:
    """Test that date handling notes are well-documented."""
    
    def test_date_handling_notes_have_clear_guidance(self):
        """Test that DATE_HANDLING_NOTES provide clear guidance."""
        notes_text = " ".join(DATE_HANDLING_NOTES)
        
        # Should have action words (guidance)
        action_words = ["use", "calculate", "convert", "provided"]
        assert any(word in notes_text.lower() for word in action_words)
    
    def test_date_handling_notes_mention_formats(self):
        """Test that DATE_HANDLING_NOTES mention date formats."""
        notes_text = " ".join(DATE_HANDLING_NOTES)
        
        # Should mention formats or how to use dates
        format_keywords = ["format", "YYYY-MM-DD", "absolute", "relative"]
        assert any(keyword in notes_text for keyword in format_keywords)
    
    def test_date_handling_notes_provide_examples(self):
        """Test that DATE_HANDLING_NOTES provide examples or context."""
        notes_text = " ".join(DATE_HANDLING_NOTES)
        
        # Should provide examples of relative dates
        examples = ["today", "tomorrow", "yesterday", "relative"]
        assert any(example in notes_text.lower() for example in examples)

