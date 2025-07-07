import pytest
from agent_komodor.agent import _async_komodor_agent
from agent_komodor.state import AgentState, InputState, Message, MsgType

@pytest.mark.asyncio
async def test_async_komodor_agent_success():
    mock_messages = [
        Message(type=MsgType.human, content="sync app test-app")
    ]

    mock_state = AgentState(
        input=InputState(messages=mock_messages)
    )

    mock_config = {
        "komodor_server": "https://dummy-server",
        "komodor_token": "dummy-token",
        "verify_ssl": False
    }

    # Inject required LangGraph metadata directly into state or override how `ainvoke()` is called
    # If `_async_komodor_agent()` doesn't currently support that, mock `ainvoke()` instead:
    from unittest.mock import AsyncMock, patch

    # Mock necessary dependencies
    with patch("agent_komodor.agent.os.getenv") as mock_getenv, \
       patch("agent_komodor.agent.LLMFactory") as mock_llm_factory, \
       patch("agent_komodor.agent.MultiServerMCPClient") as mock_client_class, \
       patch("agent_komodor.agent.create_react_agent") as mock_create_agent:

      # Configure mocks
      mock_getenv.side_effect = lambda key: {"KOMODOR_TOKEN": "dummy-token", "KOMODOR_API_URL": "https://dummy-server"}[key]
      mock_llm = AsyncMock()
      mock_llm_factory.return_value.get_llm.return_value = mock_llm

      mock_client = AsyncMock()
      mock_client.get_tools.return_value = []
      mock_client_class.return_value = mock_client

      mock_agent = AsyncMock()
      mock_agent.ainvoke.return_value = {
        "messages": [{"type": "assistant", "content": "Sync completed successfully"}]
      }
      mock_create_agent.return_value = mock_agent

      # Execute the function
      result = await _async_komodor_agent(mock_state, mock_config)

      # Verify the result
      assert "output" in result
      assert hasattr(result["output"], "messages")
      assert len(result["output"].messages) > 0
      assert any(msg.type == MsgType.assistant and "Sync completed successfully" in msg.content
            for msg in result["output"].messages)
