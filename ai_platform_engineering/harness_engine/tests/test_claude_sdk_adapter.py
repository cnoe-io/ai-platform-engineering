from __future__ import annotations

from collections.abc import AsyncIterator

from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from harness_engine.adapters.claude_sdk import ClaudeSDKAdapter
from harness_engine.models import (
    AgentBlueprint,
    HarnessSelection,
    PromptDefinition,
    RenderedPrompt,
    RunContext,
    SessionBinding,
    TurnInput,
)


async def test_claude_adapter_maps_messages_and_resumes_session(settings) -> None:
    captured = {}

    async def fake_query(**kwargs: object) -> AsyncIterator[object]:
        captured.update(kwargs)
        yield AssistantMessage(content=[TextBlock(text="hello")], model="claude-example")
        yield ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=False,
            num_turns=1,
            session_id="claude-session-next",
            usage={"input_tokens": 2},
        )

    adapter = ClaudeSDKAdapter(settings, query_fn=fake_query)
    blueprint = AgentBlueprint(
        id="agent-example",
        name="Claude example",
        harness=HarnessSelection(
            id="claude_agent_sdk", profile_id="safe", options={"max_turns": 7}
        ),
        prompt=PromptDefinition(system="Be careful."),
    )
    context = RunContext(
        blueprint=blueprint,
        binding=SessionBinding(
            binding_id="binding-example",
            owner_subject="test-user",
            agent_id=blueprint.id,
            agent_version=1,
            conversation_id="conversation-example",
            harness_id="claude_agent_sdk",
            profile_id="safe",
            provider_session_id="claude-session-old",
            checkpoint_strategy="adapter_store",
        ),
        prompt=RenderedPrompt(system="Be careful."),
        turn=TurnInput(run_id="run-example", message="hello"),
    )

    events = [event async for event in adapter.stream(context)]

    assert [event.event_type for event in events] == [
        "content.delta",
        "session.updated",
        "usage.updated",
    ]
    options = captured["options"]
    assert options.resume == "claude-session-old"
    assert options.max_turns == 7
    assert options.permission_mode == "dontAsk"


def test_claude_descriptor_and_validation_are_declarative(settings) -> None:
    adapter = ClaudeSDKAdapter(settings)
    assert adapter.descriptor.execution_mode == "in_process"
    assert adapter.descriptor.options_schema["properties"]["max_turns"]["maximum"] == 100
    assert adapter.descriptor.capabilities["sandbox.isolation"].level == "unavailable"
