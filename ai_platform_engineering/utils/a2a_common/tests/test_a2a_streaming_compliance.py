import asyncio
import sys
import types
from typing import Any, Iterable


def _ensure_strands_stubs() -> None:
    if "strands" in sys.modules:
        return

    strands_module = types.ModuleType("strands")

    class _StubAgent:
        def __init__(self, *args, **kwargs):
            pass

        async def stream_async(self, *args, **kwargs):
            if hasattr(self, "_events"):
                for event in self._events:
                    yield event
            else:
                if False:
                    yield None  # pragma: no cover

        def __call__(self, *args, **kwargs):
            return ""

    strands_module.Agent = _StubAgent

    models_module = types.ModuleType("strands.models")

    class _StubBedrockModel:  # pragma: no cover - stub container
        pass

    models_module.BedrockModel = _StubBedrockModel

    tools_module = types.ModuleType("strands.tools")
    mcp_module = types.ModuleType("strands.tools.mcp")

    class _StubMCPClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def list_tools_sync(self):
            return []

    mcp_module.MCPClient = _StubMCPClient
    tools_module.mcp = mcp_module

    sys.modules["strands"] = strands_module
    sys.modules["strands.models"] = models_module
    sys.modules["strands.tools"] = tools_module
    sys.modules["strands.tools.mcp"] = mcp_module


_ensure_strands_stubs()

import pytest

from a2a.server.agent_execution import RequestContext
from a2a.types import (
    Message,
    MessageSendParams,
    Part,
    Role,
    Task,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
    TextPart,
)

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.a2a_common.base_langgraph_agent_executor import (
    BaseLangGraphAgentExecutor,
)
from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent
from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import (
    BaseStrandsAgentExecutor,
)


class RecordingEventQueue:
    def __init__(self) -> None:
        self.events: list[Any] = []

    async def enqueue_event(self, event: Any) -> None:  # noqa: ANN401 - matches EventQueue signature
        self.events.append(event)


def _build_request_context(user_input: str = "test input") -> RequestContext:
    message = Message(
        messageId="msg-id",
        role=Role.user,
        parts=[Part(root=TextPart(text=user_input))],
    )
    params = MessageSendParams(message=message)
    return RequestContext(request=params)


class DummyLangGraphAgent(BaseLangGraphAgent):
    def __init__(self, events: Iterable[dict[str, Any]], name: str = "dummy_langgraph") -> None:
        self._events = list(events)
        self._name = name

    def get_agent_name(self) -> str:  # pragma: no cover - trivial
        return self._name

    def get_system_instruction(self) -> str:  # pragma: no cover - not used
        return ""

    def get_response_format_instruction(self) -> str:  # pragma: no cover - not used
        return ""

    def get_response_format_class(self):  # pragma: no cover - not used
        return None

    def get_tool_working_message(self) -> str:  # pragma: no cover - not used
        return ""

    def get_tool_processing_message(self) -> str:  # pragma: no cover - not used
        return ""

    def get_mcp_config(self, server_path: str | None = None):  # pragma: no cover - not used
        return {}

    def get_mcp_http_config(self):  # pragma: no cover - not used
        return None

    async def stream(self, query: str, sessionId: str, trace_id: str | None = None):  # type: ignore[override]
        for event in self._events:
            yield event


class DummyStrandsAgent(BaseStrandsAgent):
    def __init__(self, events: Iterable[dict[str, Any]], name: str = "dummy_strands") -> None:
        self._events = list(events)
        self._name = name

    def get_agent_name(self) -> str:  # pragma: no cover - trivial
        return self._name

    def get_system_prompt(self) -> str:  # pragma: no cover - not used
        return ""

    def create_mcp_clients(self):  # pragma: no cover - not used
        return []

    def get_model_config(self):  # pragma: no cover - not used
        return None

    def get_tool_working_message(self) -> str:  # pragma: no cover - not used
        return "Working"

    def get_tool_processing_message(self) -> str:  # pragma: no cover - not used
        return "Processing"

    async def stream_chat(self, message: str):  # type: ignore[override]
        for event in self._events:
            yield event


def test_langgraph_executor_streaming_emits_artifacts():
    asyncio.run(_run_langgraph_executor_streaming_emits_artifacts())


async def _run_langgraph_executor_streaming_emits_artifacts():
    events = [
        {
            "is_task_complete": False,
            "require_user_input": False,
            "kind": "tool_call",
            "tool_call": {"id": "tool-1", "name": "github"},
            "content": "🔧 DummyLangGraph: Calling tool: Github\n",
        },
        {
            "is_task_complete": False,
            "require_user_input": False,
            "kind": "text_chunk",
            "content": "Profile summary ",
        },
        {
            "is_task_complete": False,
            "require_user_input": False,
            "kind": "text_chunk",
            "content": "for user\n",
        },
        {
            "is_task_complete": False,
            "require_user_input": False,
            "kind": "tool_result",
            "tool_result": {"name": "github", "status": "completed", "is_error": False},
            "content": "✅ DummyLangGraph: Tool Github completed\n",
        },
        {
            "is_task_complete": True,
            "require_user_input": False,
            "content": "",
        },
    ]

    agent = DummyLangGraphAgent(events)
    executor = BaseLangGraphAgentExecutor(agent)
    context = _build_request_context("get github profile info")
    event_queue = RecordingEventQueue()

    await executor.execute(context, event_queue)

    recorded = event_queue.events

    assert isinstance(recorded[0], Task)

    status_events = [e for e in recorded if isinstance(e, TaskStatusUpdateEvent)]
    assert len(status_events) == 2
    assert status_events[0].status.state == TaskState.working and status_events[0].final is False
    assert status_events[-1].status.state == TaskState.completed and status_events[-1].final is True

    tool_start = next(
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'tool_notification_start'
    )
    assert tool_start.append is False
    assert tool_start.last_chunk is False

    tool_end = next(
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'tool_notification_end'
    )
    assert tool_end.append is False
    assert tool_end.last_chunk is False

    streaming_events = [
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'streaming_result'
    ]
    assert len(streaming_events) >= 3  # first chunk, second chunk, closing chunk

    first_chunk, second_chunk = streaming_events[0], streaming_events[1]
    assert first_chunk.append is False
    assert first_chunk.last_chunk is False
    assert first_chunk.artifact.parts[0].root.text == "Profile summary "

    assert second_chunk.append is True
    assert second_chunk.last_chunk is False
    assert second_chunk.artifact.parts[0].root.text == "for user\n"

    closing_chunk = next(e for e in streaming_events if e.last_chunk is True)
    assert closing_chunk.append is True
    assert closing_chunk.artifact.parts[0].root.text == ""

    artifact_ids = {evt.artifact.artifact_id for evt in streaming_events}
    assert len(artifact_ids) == 1  # same artifact ID reused across chunks

    complete_artifact = next(
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'complete_result'
    )
    assert complete_artifact.last_chunk is True
    assert ''.join(part.root.text for part in complete_artifact.artifact.parts) == 'Profile summary for user\n'


def test_strands_executor_streaming_emits_artifacts():
    asyncio.run(_run_strands_executor_streaming_emits_artifacts())


async def _run_strands_executor_streaming_emits_artifacts():
    events = [
        {"tool_call": {"name": "jira", "id": "tool-42"}},
        {"data": "Ticket A\n"},
        {"data": "Ticket B\n"},
        {"tool_result": {"name": "jira", "is_error": False}},
    ]

    agent = DummyStrandsAgent(events)
    executor = BaseStrandsAgentExecutor(agent)
    context = _build_request_context("list jira tickets")
    event_queue = RecordingEventQueue()

    await executor.execute(context, event_queue)

    recorded = event_queue.events

    assert isinstance(recorded[0], Task)

    status_events = [e for e in recorded if isinstance(e, TaskStatusUpdateEvent)]
    assert status_events[0].status.state == TaskState.working
    assert status_events[-1].status.state == TaskState.completed and status_events[-1].final is True

    streaming_events = [
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'streaming_result'
    ]
    assert len(streaming_events) >= 3

    first_chunk = streaming_events[0]
    second_chunk = streaming_events[1]
    closing_chunk = next(e for e in streaming_events if e.last_chunk is True)

    assert first_chunk.append is False and first_chunk.last_chunk is False
    assert first_chunk.artifact.parts[0].root.text == 'Ticket A\n'

    assert second_chunk.append is True and second_chunk.last_chunk is False
    assert second_chunk.artifact.parts[0].root.text == 'Ticket B\n'

    assert closing_chunk.append is True
    assert closing_chunk.artifact.parts[0].root.text == ''

    assert len({evt.artifact.artifact_id for evt in streaming_events}) == 1

    complete_artifact = next(
        e for e in recorded if isinstance(e, TaskArtifactUpdateEvent) and e.artifact.name == 'complete_result'
    )
    assert complete_artifact.last_chunk is True
    assert ''.join(part.root.text for part in complete_artifact.artifact.parts) == 'Ticket A\nTicket B\n'

