"""Tests for generic client context propagation into chat turns."""

from dynamic_agents.models import ClientContext
from dynamic_agents.routes.chat import ResumeStreamRequest
from dynamic_agents.services.streaming import _build_turn_messages


def test_turn_messages_include_client_context_as_hidden_metadata():
    ctx = ClientContext(
        source="agentic-sdlc",
        screen="repo-detail",
        owner="cnoe-io",
        repo="ai-platform-engineering",
    )

    messages = _build_turn_messages("Create tasks for this repo", ctx)

    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "Client context metadata" in messages[0]["content"]
    assert '"screen": "repo-detail"' in messages[0]["content"]
    assert '"repo": "ai-platform-engineering"' in messages[0]["content"]
    assert "Create tasks for this repo" in messages[0]["content"]


def test_turn_messages_redact_sensitive_context_keys():
    ctx = ClientContext(
        source="webui",
        screen="settings",
        github_token="secret-value",
        api_key="secret-value",
    )

    messages = _build_turn_messages("Use the current page", ctx)

    assert "secret-value" not in messages[0]["content"]
    assert '"github_token": "[redacted]"' in messages[0]["content"]
    assert '"api_key": "[redacted]"' in messages[0]["content"]


def test_turn_messages_without_client_context_are_plain_user_messages():
    messages = _build_turn_messages("Hello", None)

    assert messages == [{"role": "user", "content": "Hello"}]


def test_resume_stream_request_accepts_client_context():
    request = ResumeStreamRequest(
        agent_id="agent-1",
        conversation_id="conv-1",
        form_data='{"answer":"yes"}',
        client_context={"source": "webui", "screen": "repo-detail"},
    )

    assert request.client_context is not None
    assert request.client_context.source == "webui"
    assert request.client_context.model_extra["screen"] == "repo-detail"
