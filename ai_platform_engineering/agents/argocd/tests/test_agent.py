import types
import pytest
from unittest import mock
from agent_argocd.protocol_bindings.a2a_server.agent import ArgoCDAgent, ResponseFormat
from agent_argocd.protocol_bindings.a2a_server import agent

@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
  monkeypatch.setenv("ARGOCD_TOKEN", "dummy-token")
  monkeypatch.setenv("ARGOCD_API_URL", "https://dummy-argocd/api")

def test_response_format_defaults():
  resp = ResponseFormat(message="Test message")
  assert resp.status == "input_required"
  assert resp.message == "Test message"

def test_debug_print_banner(capsys, monkeypatch):
  monkeypatch.setenv("A2A_SERVER_DEBUG", "true")
  agent.debug_print("hello", banner=True)
  out = capsys.readouterr().out
  assert "DEBUG: hello" in out
  assert "=" * 80 in out

def test_debug_print_no_banner(capsys, monkeypatch):
  monkeypatch.setenv("A2A_SERVER_DEBUG", "true")
  agent.debug_print("no-banner", banner=False)
  out = capsys.readouterr().out
  assert "DEBUG: no-banner" in out
  assert "=" * 80 not in out

def test_debug_print_disabled(capsys, monkeypatch):
  monkeypatch.setenv("ACP_SERVER_DEBUG", "false")
  agent.debug_print("should not print")
  out = capsys.readouterr().out
  assert out == ""

def test_supported_content_types():
  assert 'text' in ArgoCDAgent.SUPPORTED_CONTENT_TYPES
  assert 'text/plain' in ArgoCDAgent.SUPPORTED_CONTENT_TYPES

def test_get_agent_response_completed(monkeypatch):
  agent = ArgoCDAgent.__new__(ArgoCDAgent)
  mock_graph = mock.Mock()
  mock_config = mock.Mock()
  resp = ResponseFormat(status="completed", message="Done")
  mock_graph.get_state.return_value = types.SimpleNamespace(values={'structured_response': resp})
  agent.graph = mock_graph
  result = agent.get_agent_response(mock_config)
  assert result['is_task_complete'] is True
  assert result['require_user_input'] is False
  assert result['content'] == "Done"

def test_get_agent_response_input_required(monkeypatch):
  agent = ArgoCDAgent.__new__(ArgoCDAgent)
  mock_graph = mock.Mock()
  mock_config = mock.Mock()
  resp = ResponseFormat(status="input_required", message="Need input")
  mock_graph.get_state.return_value = types.SimpleNamespace(values={'structured_response': resp})
  agent.graph = mock_graph
  result = agent.get_agent_response(mock_config)
  assert result['is_task_complete'] is False
  assert result['require_user_input'] is True
  assert result['content'] == "Need input"

def test_get_agent_response_error(monkeypatch):
  agent = ArgoCDAgent.__new__(ArgoCDAgent)
  mock_graph = mock.Mock()
  mock_config = mock.Mock()
  resp = ResponseFormat(status="error", message="Error occurred")
  mock_graph.get_state.return_value = types.SimpleNamespace(values={'structured_response': resp})
  agent.graph = mock_graph
  result = agent.get_agent_response(mock_config)
  assert result['is_task_complete'] is False
  assert result['require_user_input'] is True
  assert result['content'] == "Error occurred"

def test_get_agent_response_no_structured(monkeypatch):
  agent = ArgoCDAgent.__new__(ArgoCDAgent)
  mock_graph = mock.Mock()
  mock_config = mock.Mock()
  mock_graph.get_state.return_value = types.SimpleNamespace(values={})
  agent.graph = mock_graph
  result = agent.get_agent_response(mock_config)
  assert result['is_task_complete'] is False
  assert result['require_user_input'] is True
  assert "unable to process" in result['content'].lower()