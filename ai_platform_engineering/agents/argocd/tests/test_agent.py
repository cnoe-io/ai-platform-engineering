import pytest
from agent_argocd.protocol_bindings.a2a_server.agent import ArgoCDAgent, ResponseFormat


@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
    """Set required environment variables for ArgoCD agent tests."""
    monkeypatch.setenv("ARGOCD_TOKEN", "dummy-token")
    monkeypatch.setenv("ARGOCD_API_URL", "https://dummy-argocd/api")


def test_response_format_defaults():
    """Test ResponseFormat default values."""
    resp = ResponseFormat(message="Test message")
    assert resp.status == "input_required"
    assert resp.message == "Test message"


def test_response_format_completed():
    """Test ResponseFormat with completed status."""
    resp = ResponseFormat(status="completed", message="Task done")
    assert resp.status == "completed"
    assert resp.message == "Task done"


def test_response_format_error():
    """Test ResponseFormat with error status."""
    resp = ResponseFormat(status="error", message="Error occurred")
    assert resp.status == "error"
    assert resp.message == "Error occurred"


def test_agent_initialization():
    """Test that ArgoCDAgent initializes properly."""
    agent = ArgoCDAgent()
    assert agent.get_agent_name() == "argocd"
    assert agent.get_system_instruction() is not None
    assert "ArgoCD" in agent.get_system_instruction()


def test_agent_system_instruction():
    """Test that system instruction contains expected content."""
    agent = ArgoCDAgent()
    instruction = agent.get_system_instruction()
    assert "ArgoCD" in instruction
    assert "CRUD" in instruction
    assert "Create, Read, Update, Delete" in instruction


def test_agent_response_format():
    """Test that agent returns correct response format class."""
    agent = ArgoCDAgent()
    response_class = agent.get_response_format_class()
    assert response_class == ResponseFormat


def test_agent_tool_messages():
    """Test agent tool messages."""
    agent = ArgoCDAgent()
    assert "ArgoCD" in agent.get_tool_working_message()
    assert "ArgoCD" in agent.get_tool_processing_message()


def test_agent_mcp_config():
    """Test MCP configuration generation."""
    agent = ArgoCDAgent()
    config = agent.get_mcp_config("/fake/server/path")

    assert config is not None
    assert "command" in config
    assert "args" in config
    assert "env" in config
    assert "ARGOCD_TOKEN" in config["env"]
    assert "ARGOCD_API_URL" in config["env"]