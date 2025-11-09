# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for AIPlatformEngineerA2ABinding.

Tests cover:
- Agent binding initialization
- Streaming from Deep Agent
- Sub-agent coordination via A2A client
- Response parsing (structured and unstructured)
- Event transformation (tool calls, artifacts, status updates)
- Streaming content accumulation
- Final response synthesis
- DataPart and TextPart handling
- JSON parsing and fallback logic
"""

import pytest
import json
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from typing import AsyncIterator, Dict, Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding,
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import (
    PlatformEngineerResponse,
    InputField,
)


class TestAIPlatformEngineerA2ABindingInit:
    """Test agent binding initialization."""

    def test_agent_binding_initializes(self):
        """Test agent binding can be initialized."""
        agent = AIPlatformEngineerA2ABinding()
        assert agent is not None

    @patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent')
    def test_agent_binding_creates_deep_agent(self, mock_create_agent):
        """Test agent binding creates Deep Agent."""
        mock_agent_instance = Mock()
        mock_create_agent.return_value = mock_agent_instance

        agent = AIPlatformEngineerA2ABinding()
        mock_create_agent.assert_called_once()


class TestHandleStructuredResponse:
    """Test handle_structured_response method."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    def test_handle_platform_engineer_response_object(self, agent):
        """Test handling PlatformEngineerResponse object."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Need information",
            metadata={
                "user_input": True,
                "input_fields": [
                    InputField(
                        field_name="project_name",
                        field_description="Project name",
                        field_values=["project1", "project2"]
                    )
                ]
            }
        )

        result = agent.handle_structured_response(response)
        assert result['is_task_complete'] is False
        assert result['require_user_input'] is True
        assert result['content'] == "Need information"
        assert 'metadata' in result
        assert result['metadata']['user_input'] is True

    def test_handle_json_string_response(self, agent):
        """Test handling JSON string response."""
        json_str = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Task completed",
            "metadata": {}
        })

        result = agent.handle_structured_response(json_str)
        assert result['is_task_complete'] is True
        assert result['require_user_input'] is False
        assert result['content'] == "Task completed"

    def test_handle_plain_text_response(self, agent):
        """Test handling plain text response (non-JSON)."""
        plain_text = "This is just plain text, not JSON"

        result = agent.handle_structured_response(plain_text)
        assert result['is_task_complete'] is False
        assert result['require_user_input'] is False
        assert result['content'] == ''  # Empty after fix for duplication

    def test_handle_json_wrapped_in_markdown(self, agent):
        """Test handling JSON wrapped in markdown code blocks."""
        json_str = """```json
{
  "is_task_complete": true,
  "require_user_input": false,
  "content": "Done"
}
```"""

        result = agent.handle_structured_response(json_str)
        assert result['is_task_complete'] is True
        assert result['content'] == "Done"

    def test_handle_invalid_json_returns_default(self, agent):
        """Test invalid JSON returns default response."""
        invalid_json = '{"broken": json structure'

        result = agent.handle_structured_response(invalid_json)
        # Should return default values for invalid JSON
        assert 'is_task_complete' in result
        assert 'require_user_input' in result

    def test_handle_dict_response(self, agent):
        """Test handling dict response."""
        response_dict = {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Working on it",
            "metadata": {"status": "processing"}
        }

        result = agent.handle_structured_response(response_dict)
        assert result['is_task_complete'] is False
        assert result['require_user_input'] is True
        assert result['content'] == "Working on it"

    def test_handle_input_fields_mapping(self, agent):
        """Test input_fields are correctly mapped to field_name, field_description, field_values."""
        json_str = json.dumps({
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Need input",
            "metadata": {
                "user_input": True,
                "input_fields": [
                    {
                        "field_name": "environment",
                        "field_description": "Target environment",
                        "field_values": ["dev", "staging", "prod"]
                    }
                ]
            }
        })

        result = agent.handle_structured_response(json_str)
        assert result['metadata']['user_input'] is True
        fields = result['metadata']['input_fields']
        assert len(fields) == 1
        assert fields[0]['field_name'] == "environment"
        assert fields[0]['field_description'] == "Target environment"
        assert "dev" in fields[0]['field_values']


class TestStreamMethod:
    """Test stream method (main streaming logic)."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    @pytest.fixture
    def mock_deep_agent(self):
        """Create mock Deep Agent."""
        agent = Mock()
        agent.astream_events = AsyncMock()
        return agent

    @pytest.mark.asyncio
    async def test_stream_yields_simple_text_chunks(self, agent, mock_deep_agent):
        """Test streaming simple text chunks from Deep Agent."""
        # Mock Deep Agent streaming events
        async def mock_stream_events(*args, **kwargs):
            # Simulate streaming chunks
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessage(content="Hello ")}
            }
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessage(content="world")}
            }
            # Final AIMessage with full content
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="Hello world")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Should receive streaming chunks + final response
            assert len(events) >= 2
            # Check that some events have content
            content_events = [e for e in events if isinstance(e, dict) and e.get('content')]
            assert len(content_events) > 0

    @pytest.mark.asyncio
    async def test_stream_handles_tool_calls(self, agent, mock_deep_agent):
        """Test streaming handles tool call events."""
        async def mock_stream_events(*args, **kwargs):
            # Simulate tool call event
            yield {
                "event": "on_tool_start",
                "name": "github_agent",
                "data": {"input": {"query": "list repos"}}
            }
            # Tool result
            yield {
                "event": "on_tool_end",
                "name": "github_agent",
                "data": {"output": "3 repositories found"}
            }
            # Final message
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="Found 3 repos")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Should include tool call events
            assert len(events) > 0

    @pytest.mark.asyncio
    async def test_stream_accumulates_content_correctly(self, agent, mock_deep_agent):
        """Test streaming accumulates all content chunks."""
        async def mock_stream_events(*args, **kwargs):
            for word in ["First ", "Second ", "Third"]:
                yield {
                    "event": "on_chat_model_stream",
                    "data": {"chunk": AIMessage(content=word)}
                }
            # Final full message
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="First Second Third")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Final event should have complete content detection
            final_event = events[-1]
            assert isinstance(final_event, dict)
            # Should have is_task_complete flag
            assert 'is_task_complete' in final_event

    @pytest.mark.asyncio
    async def test_stream_handles_empty_content(self, agent, mock_deep_agent):
        """Test streaming handles empty content gracefully."""
        async def mock_stream_events(*args, **kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessage(content="")}
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Should handle empty content without errors
            assert len(events) >= 1

    @pytest.mark.asyncio
    async def test_stream_final_response_has_no_duplicate_content(self, agent, mock_deep_agent):
        """Test final response has empty content to avoid duplication (after fix)."""
        async def mock_stream_events(*args, **kwargs):
            # Stream tokens
            for char in ["H", "i"]:
                yield {
                    "event": "on_chat_model_stream",
                    "data": {"chunk": AIMessage(content=char)}
                }
            # Final message
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="Hi")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Final event should have empty content (fix for duplication)
            final_event = events[-1]
            assert final_event.get('content') == ''


class TestSubAgentCoordination:
    """Test sub-agent coordination via A2A."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    @pytest.mark.asyncio
    async def test_stream_forwards_sub_agent_artifact_update(self, agent):
        """Test streaming forwards sub-agent artifact-update events."""
        mock_deep_agent = Mock()

        async def mock_stream_events(*args, **kwargs):
            # Simulate sub-agent artifact-update event (from a2a_remote_agent_connect)
            yield {
                "event": "on_custom_event",
                "name": "artifact-update",
                "data": {
                    "type": "artifact-update",
                    "result": {
                        "artifact": {
                            "artifactId": "test-artifact",
                            "name": "streaming_result",
                            "description": "Result from sub-agent",
                            "parts": [{"text": "Sub-agent response"}]
                        },
                        "lastChunk": False
                    }
                }
            }
            # Final completion
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="Done")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Should forward the artifact-update event
            artifact_events = [e for e in events if isinstance(e, dict) and e.get('type') == 'artifact-update']
            assert len(artifact_events) > 0

    @pytest.mark.asyncio
    async def test_stream_forwards_sub_agent_datapart(self, agent):
        """Test streaming forwards sub-agent DataPart (structured data)."""
        mock_deep_agent = Mock()

        async def mock_stream_events(*args, **kwargs):
            # Sub-agent sends DataPart with structured data
            yield {
                "event": "on_custom_event",
                "name": "artifact-update",
                "data": {
                    "type": "artifact-update",
                    "result": {
                        "artifact": {
                            "artifactId": "jarvis-datapart",
                            "name": "complete_result",
                            "description": "Structured result from Jarvis",
                            "parts": [{
                                "data": {
                                    "require_user_input": True,
                                    "metadata": {
                                        "input_fields": [
                                            {
                                                "field_name": "llm_model",
                                                "field_description": "LLM model",
                                                "field_values": ["gpt-4", "claude-3"]
                                            }
                                        ]
                                    }
                                }
                            }]
                        },
                        "lastChunk": True
                    }
                }
            }
            # Final
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test query", "test-context", "test-trace"):
                events.append(event)

            # Should have artifact-update with DataPart
            artifact_events = [e for e in events if isinstance(e, dict) and e.get('type') == 'artifact-update']
            assert len(artifact_events) > 0


class TestResponseParsing:
    """Test response parsing logic."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    def test_parse_structured_json_response(self, agent):
        """Test parsing structured JSON response."""
        json_response = {
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Task completed successfully",
            "metadata": {"status": "success"}
        }

        result = agent.handle_structured_response(json_response)
        assert result['is_task_complete'] is True
        assert result['content'] == "Task completed successfully"

    def test_parse_response_with_metadata(self, agent):
        """Test parsing response with metadata."""
        response = {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Need more info",
            "metadata": {
                "user_input": True,
                "input_fields": [
                    {
                        "field_name": "api_key",
                        "field_description": "API Key",
                        "field_values": []
                    }
                ]
            }
        }

        result = agent.handle_structured_response(response)
        assert result['require_user_input'] is True
        assert 'metadata' in result
        assert 'input_fields' in result['metadata']

    def test_parse_response_strips_markdown_json_blocks(self, agent):
        """Test parsing strips markdown JSON code blocks."""
        markdown_json = """```json
{
  "is_task_complete": true,
  "content": "Done"
}
```"""

        result = agent.handle_structured_response(markdown_json)
        assert result['is_task_complete'] is True

    def test_parse_plain_text_as_default_response(self, agent):
        """Test plain text returns default structured response."""
        plain_text = "This is just a regular text response"

        result = agent.handle_structured_response(plain_text)
        assert 'is_task_complete' in result
        assert 'require_user_input' in result
        # Content should be empty (fix for duplication)
        assert result['content'] == ''


class TestContentAccumulation:
    """Test content accumulation during streaming."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    @pytest.mark.asyncio
    async def test_accumulates_streaming_chunks(self, agent):
        """Test accumulates all streaming chunks."""
        mock_deep_agent = Mock()

        async def mock_stream_events(*args, **kwargs):
            chunks = ["First", " ", "Second", " ", "Third"]
            for chunk in chunks:
                yield {
                    "event": "on_chat_model_stream",
                    "data": {"chunk": AIMessage(content=chunk)}
                }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="First Second Third")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test", "ctx", "trace"):
                events.append(event)

            # Should yield multiple streaming events
            streaming_events = [e for e in events if isinstance(e, dict) and e.get('content') and not e.get('is_task_complete')]
            assert len(streaming_events) >= len(chunks)

    @pytest.mark.asyncio
    async def test_final_event_does_not_duplicate_content(self, agent):
        """Test final event has empty content (no duplication)."""
        mock_deep_agent = Mock()

        async def mock_stream_events(*args, **kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": AIMessage(content="Test")}
            }
            yield {
                "event": "on_chat_model_end",
                "data": {"output": AIMessage(content="Test")}
            }

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            events = []
            async for event in agent.stream("test", "ctx", "trace"):
                events.append(event)

            # Final event should have empty content
            final = events[-1]
            assert final['content'] == ''


class TestErrorHandling:
    """Test error handling in agent binding."""

    @pytest.fixture
    def agent(self):
        """Create agent binding instance."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.create_platform_engineer_agent'):
            return AIPlatformEngineerA2ABinding()

    @pytest.mark.asyncio
    async def test_stream_handles_deep_agent_error(self, agent):
        """Test streaming handles Deep Agent errors."""
        mock_deep_agent = Mock()

        async def mock_stream_events(*args, **kwargs):
            raise ValueError("Deep Agent error")
            yield  # Make it a generator

        with patch.object(agent, 'deep_agent', mock_deep_agent):
            mock_deep_agent.astream_events = mock_stream_events

            with pytest.raises(ValueError):
                async for event in agent.stream("test", "ctx", "trace"):
                    pass

    def test_handle_structured_response_invalid_json(self, agent):
        """Test handle_structured_response with invalid JSON."""
        invalid_json = '{"broken": json'

        result = agent.handle_structured_response(invalid_json)
        # Should return default response without crashing
        assert 'is_task_complete' in result
        assert 'require_user_input' in result

    def test_handle_structured_response_none_input(self, agent):
        """Test handle_structured_response with None input."""
        result = agent.handle_structured_response(None)
        # Should handle gracefully
        assert isinstance(result, dict)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


