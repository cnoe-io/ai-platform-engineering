import pytest
from agent_argocd.agent import _async_argocd_agent
from agent_argocd.state import AgentState, InputState, Message, MsgType

@pytest.mark.asyncio
async def test_async_argocd_agent_success():
    mock_messages = [
        Message(type=MsgType.human, content="sync app test-app")
    ]

    mock_state = AgentState(
        argocd_input=InputState(messages=mock_messages)
    )

    mock_config = {
        "argocd_server": "https://dummy-server",
        "argocd_token": "dummy-token",
        "verify_ssl": False
    }

    # Inject required LangGraph metadata directly into state or override how `ainvoke()` is called
    # If `_async_argocd_agent()` doesn't currently support that, mock `ainvoke()` instead:
    from unittest.mock import AsyncMock, patch

    # Mock necessary dependencies
    with patch("agent_argocd.agent.os.getenv") as mock_getenv, \
       patch("agent_argocd.agent.LLMFactory") as mock_llm_factory, \
       patch("agent_argocd.agent.MultiServerMCPClient") as mock_client_class, \
       patch("agent_argocd.agent.create_react_agent") as mock_create_agent:

      # Configure mocks
      mock_getenv.side_effect = lambda key: {"ARGOCD_TOKEN": "dummy-token", "ARGOCD_API_URL": "https://dummy-server"}[key]
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
      result = await _async_argocd_agent(mock_state, mock_config)

      # Verify the result
      assert "argocd_output" in result
      assert hasattr(result["argocd_output"], "messages")
      assert len(result["argocd_output"].messages) > 0
      assert any(msg.type == MsgType.assistant and "Sync completed successfully" in msg.content
            for msg in result["argocd_output"].messages)
