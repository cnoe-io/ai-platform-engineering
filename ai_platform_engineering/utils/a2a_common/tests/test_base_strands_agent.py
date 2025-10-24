# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BaseStrandsAgent."""

import pytest
from unittest.mock import Mock, patch
from typing import List, Tuple

from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent
from strands.tools.mcp import MCPClient


class TestStrandsAgent(BaseStrandsAgent):
    """Concrete test implementation of BaseStrandsAgent."""

    def __init__(self, config=None, mock_clients=None):
        self._mock_clients = mock_clients or []
        super().__init__(config)

    def get_agent_name(self) -> str:
        return "test_agent"

    def get_system_prompt(self) -> str:
        return "You are a test agent."

    def create_mcp_clients(self) -> List[Tuple[str, MCPClient]]:
        return self._mock_clients

    def get_model_config(self):
        return None


class TestBaseStrandsAgent:
    """Test cases for BaseStrandsAgent."""

    def test_initialization(self, mock_mcp_client):
        """Test agent initialization."""
        mock_clients = [("test", mock_mcp_client)]

        agent = TestStrandsAgent(mock_clients=mock_clients)

        assert agent.get_agent_name() == "test_agent"
        assert agent._agent is not None
        assert len(agent._tools) > 0

    def test_get_agent_name(self, mock_mcp_client):
        """Test get_agent_name method."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        assert agent.get_agent_name() == "test_agent"

    def test_get_system_prompt(self, mock_mcp_client):
        """Test get_system_prompt method."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        prompt = agent.get_system_prompt()
        assert "test agent" in prompt.lower()

    def test_create_mcp_clients(self, mock_mcp_client):
        """Test create_mcp_clients method."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        clients = agent.create_mcp_clients()
        assert len(clients) == 1
        assert clients[0][0] == "test"

    def test_multi_mcp_clients(self, mock_mcp_client):
        """Test with multiple MCP clients."""
        client1 = Mock()
        client1.__enter__ = Mock(return_value=client1)
        client1.__exit__ = Mock(return_value=None)

        tool1 = Mock()
        tool1.name = "tool1"
        tool1.tool_name = "tool1"
        client1.list_tools_sync = Mock(return_value=[tool1])

        client2 = Mock()
        client2.__enter__ = Mock(return_value=client2)
        client2.__exit__ = Mock(return_value=None)

        tool2 = Mock()
        tool2.name = "tool2"
        tool2.tool_name = "tool2"
        client2.list_tools_sync = Mock(return_value=[tool2])

        mock_clients = [("server1", client1), ("server2", client2)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        # Should have tools from both servers
        assert len(agent._tools) == 2
        assert len(agent._mcp_clients) == 2

    def test_tool_deduplication(self):
        """Test that duplicate tools are removed."""
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=None)

        # Create duplicate tools - set tool_name as an attribute
        tool1 = Mock()
        tool1.name = "duplicate_tool"
        tool1.tool_name = "duplicate_tool"

        tool2 = Mock()
        tool2.name = "duplicate_tool"
        tool2.tool_name = "duplicate_tool"

        tool3 = Mock()
        tool3.name = "unique_tool"
        tool3.tool_name = "unique_tool"

        client.list_tools_sync = Mock(return_value=[tool1, tool2, tool3])

        mock_clients = [("test", client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        # Should only have 2 unique tools
        assert len(agent._tools) == 2

    @patch('ai_platform_engineering.utils.a2a_common.base_strands_agent.Agent')
    def test_chat_method(self, mock_agent_class, mock_mcp_client):
        """Test chat method."""
        mock_strands_agent = Mock()
        mock_strands_agent.return_value = "Test response"
        mock_agent_class.return_value = mock_strands_agent

        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)
        agent._agent = mock_strands_agent

        result = agent.chat("Test message")

        assert "answer" in result
        assert "metadata" in result
        assert result["metadata"]["agent_name"] == "test_agent"

    @patch('ai_platform_engineering.utils.a2a_common.base_strands_agent.Agent')
    @pytest.mark.asyncio
    async def test_stream_chat_method(self, mock_agent_class, mock_mcp_client):
        """Test stream_chat method."""
        mock_strands_agent = Mock()
        
        # Create an async generator for stream_async
        async def mock_stream_async(message):
            yield {"data": "Hello "}
            yield {"data": "world!"}
        
        mock_strands_agent.stream_async = mock_stream_async
        mock_agent_class.return_value = mock_strands_agent

        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)
        agent._agent = mock_strands_agent

        events = []
        async for event in agent.stream_chat("Test message"):
            events.append(event)

        assert len(events) == 2
        assert events[0]["data"] == "Hello "
        assert events[1]["data"] == "world!"

    def test_cleanup(self, mock_mcp_client):
        """Test cleanup of MCP resources."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        agent.close()

        assert len(agent._mcp_contexts) == 0
        assert len(agent._mcp_clients) == 0
        assert agent._agent is None

    def test_context_manager(self, mock_mcp_client):
        """Test agent as context manager."""
        mock_clients = [("test", mock_mcp_client)]

        with TestStrandsAgent(mock_clients=mock_clients) as agent:
            assert agent._agent is not None

        # After exiting context, resources should be cleaned up
        assert len(agent._mcp_contexts) == 0

    def test_error_handling_in_initialization(self):
        """Test error handling during initialization."""
        bad_client = Mock()
        bad_client.__enter__ = Mock(side_effect=Exception("Connection failed"))

        mock_clients = [("bad", bad_client)]

        with pytest.raises(Exception) as exc_info:
            TestStrandsAgent(mock_clients=mock_clients)

        assert "Connection failed" in str(exc_info.value)

    def test_get_tool_working_message(self, mock_mcp_client):
        """Test get_tool_working_message method."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        message = agent.get_tool_working_message()
        assert "test_agent" in message
        assert "tools" in message.lower()

    def test_get_tool_processing_message(self, mock_mcp_client):
        """Test get_tool_processing_message method."""
        mock_clients = [("test", mock_mcp_client)]
        agent = TestStrandsAgent(mock_clients=mock_clients)

        message = agent.get_tool_processing_message()
        assert "test_agent" in message
        assert "processing" in message.lower()

