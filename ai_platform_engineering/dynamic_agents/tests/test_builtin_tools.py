import importlib


def test_self_identity_returns_agent_id() -> None:
    create_self_identity_tool = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "create_self_identity_tool",
    )

    identity_tool = create_self_identity_tool(
        agent_id="agent-123",
        name="Test Agent",
        description="A test dynamic agent",
        model_id="test-model",
        model_provider="test-provider",
        gradient_theme="ocean",
    )

    result = identity_tool.invoke({"thought": "verify identity"})

    assert result == {
        "id": "agent-123",
        "name": "Test Agent",
        "description": "A test dynamic agent",
        "model_id": "test-model",
        "model_provider": "test-provider",
        "gradient_theme": "ocean",
    }
