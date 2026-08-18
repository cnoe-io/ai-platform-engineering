from __future__ import annotations

from collections.abc import Iterator

from harness_engine.adapters.agentcore import AgentCoreAdapter
from harness_engine.config import Settings


class StreamingBody:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def iter_lines(self, chunk_size: int) -> Iterator[bytes]:
        assert chunk_size == 64
        return iter(self._lines)


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def invoke_agent_runtime(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(kwargs)
        return {
            "contentType": "text/event-stream",
            "response": StreamingBody([b"data: first", b"", b"data: second"]),
        }


async def test_agentcore_adapter_uses_operator_target_and_provider_session(settings: Settings) -> None:
    client = FakeClient()
    adapter = AgentCoreAdapter(settings, clients={"default": client})

    chunks = [
        chunk
        async for chunk in adapter.stream(
            runtime_alias="primary",
            provider_session_id="harness-session-12345678901234567890123456789012",
            agent_id="agent-example",
            conversation_id="conversation-example",
            message="hello",
            traceparent="00-11111111111111111111111111111111-2222222222222222-01",
        )
    ]

    assert chunks == ["first", "second"]
    assert client.calls == [
        {
            "agentRuntimeArn": "arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/example",
            "runtimeSessionId": "harness-session-12345678901234567890123456789012",
            "qualifier": "DEFAULT",
            "contentType": "application/json",
            "accept": "text/event-stream, application/json",
            "payload": b'{"prompt":"hello","agent_id":"agent-example","conversation_id":"conversation-example","traceparent":"00-11111111111111111111111111111111-2222222222222222-01"}',
        }
    ]
    assert "Authorization" not in client.calls[0]


async def test_agentcore_adapter_rejects_non_allowlisted_runtime_alias(settings: Settings) -> None:
    adapter = AgentCoreAdapter(settings, clients={"default": FakeClient()})

    try:
        _ = [
            chunk
            async for chunk in adapter.stream(
                runtime_alias="not-configured",
                provider_session_id="harness-session-12345678901234567890123456789012",
                agent_id="agent-example",
                conversation_id="conversation-example",
                message="hello",
                traceparent=None,
            )
        ]
    except ValueError as exc:
        assert "not configured" in str(exc)
    else:
        raise AssertionError("expected the runtime alias to be rejected")
