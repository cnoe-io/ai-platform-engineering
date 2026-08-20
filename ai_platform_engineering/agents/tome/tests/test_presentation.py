from __future__ import annotations

import json

import pytest
from claude_agent_sdk import ResultMessage
from claude_agent_sdk.types import StreamEvent

from tome_agent.agent import http_client, presentation
from tome_agent.orchestrator.contract import (
    PresentationRequest,
    PresentationRequirementsRequest,
)


def request() -> PresentationRequest:
    return PresentationRequest(
        snapshot={
            "project_id": "project-1",
            "slug": "example-project",
            "name": "Example Project",
            "project_type": "project",
        },
        prompt="Create an eight-slide executive briefing.",
        sources=[
            {
                "path": "overview.md",
                "title": "Overview",
                "content": "The release is ready.",
            }
        ],
    )


def deck(source_ref: str = "overview.md") -> dict:
    return {
        "title": "Release briefing",
        "subtitle": "",
        "slides": [
            {
                "id": "status",
                "title": "Status",
                "subtitle": "",
                "bullets": [
                    {
                        "text": "The release is ready.",
                        "source_refs": [source_ref],
                        "generated": False,
                    }
                ],
                "visual": None,
                "speaker_notes": "",
            }
        ],
    }


def requirements_request() -> PresentationRequirementsRequest:
    base = request()
    return PresentationRequirementsRequest(
        snapshot=base.snapshot,
        sources=base.sources,
        current_requirements={"tone": "executive", "slide_count": 8},
        instruction="Focus on delivery readiness.",
    )


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def teardown_function() -> None:
    http_client.set_model_overrides(None)


def test_presentation_model_reuses_deployment_chat_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TTT_PRESENTATION_MODEL", raising=False)
    monkeypatch.setenv(
        "TTT_CHAT_MODEL",
        "bedrock/global.anthropic.claude-sonnet-example",
    )

    assert presentation._resolve_presentation_model() == {
        "model": "bedrock/global.anthropic.claude-sonnet-example",
        "source": "environment",
        "scope_id": "TTT_CHAT_MODEL",
    }


@pytest.mark.anyio
async def test_generate_presentation_uses_configured_model_and_serializes_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        http_client,
        "fetch_model_config",
        lambda *_args: {"presentation": {"model": "provider/model-present", "source": "exact"}},
    )

    async def fake_query(*, prompt: str, options: object):
        seen["prompt"] = prompt
        seen["options"] = options
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-present",
            result=json.dumps(deck()),
        )

    monkeypatch.setattr(presentation, "query", fake_query)
    result = await presentation.generate_presentation(request())

    assert result.model == "provider/model-present"
    assert result.model_source == "exact"
    assert result.deck["slides"][0]["bullets"][0]["source_refs"] == ["overview.md"]
    assert "The release is ready." in str(seen["prompt"])
    assert seen["options"].allowed_tools == []


@pytest.mark.anyio
async def test_stream_presentation_emits_tokens_before_validated_deck(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(http_client, "fetch_model_config", lambda *_args: None)
    monkeypatch.setenv("TTT_CHAT_MODEL", "provider/model-stream")

    async def fake_query(*, prompt: str, options: object):
        del prompt
        assert options.include_partial_messages is True
        yield StreamEvent(
            uuid="stream-deck",
            session_id="session-deck",
            event={
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": '{"title":'},
            },
        )
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-deck",
            result=json.dumps(deck()),
        )

    monkeypatch.setattr(presentation, "query", fake_query)
    events = [event async for event in presentation.stream_presentation(request())]

    assert events[0] == ("token", {"text": '{"title":'})
    assert events[1][0] == "complete"
    assert events[1][1]["deck"]["title"] == "Release briefing"
    assert events[1][1]["model"] == "provider/model-stream"


@pytest.mark.anyio
async def test_generate_presentation_rejects_unselected_model_citation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(http_client, "fetch_model_config", lambda *_args: None)

    async def fake_query(*, prompt: str, options: object):
        del prompt, options
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-present",
            result=json.dumps(deck("private.md")),
        )

    monkeypatch.setattr(presentation, "query", fake_query)
    with pytest.raises(ValueError, match="cites an unselected page: private.md"):
        await presentation.generate_presentation(request())


def test_presentation_request_refuses_oversized_source_payload() -> None:
    body = request()
    body.sources[0].content = "x" * (presentation.MAX_SOURCE_CHARS + 1)
    with pytest.raises(ValueError, match="too large"):
        presentation._request_prompt(body)


@pytest.mark.anyio
async def test_suggest_requirements_uses_sources_and_returns_typed_brief(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}
    monkeypatch.setattr(
        http_client,
        "fetch_model_config",
        lambda *_args: {"presentation": {"model": "provider/model-present", "source": "exact"}},
    )

    async def fake_query(*, prompt: str, options: object):
        seen["prompt"] = prompt
        seen["options"] = options
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-requirements",
            result=json.dumps(
                {
                    "goal": "Align sponsors on release readiness.",
                    "key_message": "The release is ready for the next decision.",
                    "audience": "Project sponsors",
                    "slide_count": 7,
                    "duration_minutes": 12,
                    "tone": "executive",
                    "technical_detail": "balanced",
                    "required_sections": "Context, readiness, risks, next steps",
                    "excluded_topics": "Unsupported forecasts",
                    "visual_mode": "both",
                    "visual_preferences": "Simple milestone and risk visuals",
                    "include_speaker_notes": True,
                }
            ),
        )

    monkeypatch.setattr(presentation, "query", fake_query)
    result = await presentation.suggest_presentation_requirements(
        requirements_request()
    )

    assert result.model == "provider/model-present"
    assert result.requirements.slide_count == 7
    assert result.requirements.audience == "Project sponsors"
    assert "The release is ready." in str(seen["prompt"])
    assert "Focus on delivery readiness." in str(seen["prompt"])
    assert seen["options"].allowed_tools == []


@pytest.mark.anyio
async def test_stream_requirements_emits_model_tokens_before_validated_brief(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(http_client, "fetch_model_config", lambda *_args: None)
    monkeypatch.setenv("TTT_CHAT_MODEL", "provider/model-stream")
    suggested = {
        "goal": "Align sponsors on release readiness.",
        "key_message": "The release is ready for the next decision.",
        "audience": "Project sponsors",
        "slide_count": 7,
        "duration_minutes": 12,
        "tone": "executive",
        "technical_detail": "balanced",
        "required_sections": "Context, readiness, risks, next steps",
        "excluded_topics": "Unsupported forecasts",
        "visual_mode": "graphics",
        "visual_preferences": "Simple milestone and risk visuals",
        "include_speaker_notes": True,
    }

    async def fake_query(*, prompt: str, options: object):
        del prompt
        assert options.include_partial_messages is True
        yield StreamEvent(
            uuid="stream-1",
            session_id="session-stream",
            event={
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": '{"goal":'},
            },
        )
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="session-stream",
            result=json.dumps(suggested),
        )

    monkeypatch.setattr(presentation, "query", fake_query)
    events = [
        event
        async for event in presentation.stream_presentation_requirements(
            requirements_request()
        )
    ]

    assert events[0] == ("token", {"text": '{"goal":'})
    assert events[1][0] == "complete"
    assert events[1][1]["requirements"]["goal"] == suggested["goal"]
    assert events[1][1]["requirements"]["visual_mode"] == "graphics"
    assert events[1][1]["model"] == "provider/model-stream"
