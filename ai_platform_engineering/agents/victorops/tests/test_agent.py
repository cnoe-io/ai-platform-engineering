import json

import pytest
from agent_victorops.protocol_bindings.a2a_server.agent import VictorOpsAgent, ResponseFormat


@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
    """Set required environment variables for VictorOps agent tests."""
    monkeypatch.setenv("VICTOROPS_API_URL", "https://dummy-victorops/api")
    monkeypatch.setenv("X_VO_API_KEY", "dummy-key")
    monkeypatch.setenv("X_VO_API_ID", "dummy-id")
    # Ensure multi-org var is not set by default
    monkeypatch.delenv("VICTOROPS_ORGS", raising=False)


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
    """Test that VictorOpsAgent initializes properly."""
    agent = VictorOpsAgent()
    assert agent.get_agent_name() == "victorops"
    assert agent.get_system_instruction() is not None
    assert "VictorOps" in agent.get_system_instruction()


def test_agent_system_instruction():
    """Test that system instruction contains expected content."""
    agent = VictorOpsAgent()
    instruction = agent.get_system_instruction()
    assert "VictorOps" in instruction
    assert "incident" in instruction.lower()


def test_agent_response_format():
    """Test that agent returns correct response format class."""
    agent = VictorOpsAgent()
    response_class = agent.get_response_format_class()
    assert response_class == ResponseFormat


def test_agent_tool_messages():
    """Test agent tool messages."""
    agent = VictorOpsAgent()
    assert "VictorOps" in agent.get_tool_working_message()
    assert "VictorOps" in agent.get_tool_processing_message()


def test_agent_mcp_config():
    """Test MCP configuration generation with single-org env vars."""
    agent = VictorOpsAgent()
    config = agent.get_mcp_config("/fake/server/path")

    assert config is not None
    assert "command" in config
    assert "args" in config
    assert "env" in config
    assert "VICTOROPS_API_URL" in config["env"]
    assert "X_VO_API_KEY" in config["env"]
    assert "X_VO_API_ID" in config["env"]


def test_agent_mcp_config_multi_org(monkeypatch):
    """Test MCP configuration passes through VICTOROPS_ORGS when set."""
    orgs_json = json.dumps({
        "org-alpha": {
            "api_url": "https://api.victorops.com",
            "api_key": "key-alpha",
            "api_id": "id-alpha",
        },
        "org-beta": {
            "api_url": "https://api.victorops.com",
            "api_key": "key-beta",
            "api_id": "id-beta",
        },
    })
    monkeypatch.setenv("VICTOROPS_ORGS", orgs_json)

    agent = VictorOpsAgent()
    config = agent.get_mcp_config("/fake/server/path")

    assert config is not None
    assert "env" in config
    assert "VICTOROPS_ORGS" in config["env"]
    assert config["env"]["VICTOROPS_ORGS"] == orgs_json
    # Single-org vars should not be present when VICTOROPS_ORGS is set
    assert "VICTOROPS_API_URL" not in config["env"]
    assert "X_VO_API_KEY" not in config["env"]
    assert "X_VO_API_ID" not in config["env"]
