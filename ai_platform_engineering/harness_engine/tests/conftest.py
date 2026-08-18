from __future__ import annotations

import json
from collections.abc import AsyncIterator

import pytest

from harness_engine.config import Settings
from harness_engine.repository import InMemoryRunRepository


class FakeAgentCoreAdapter:
    harness_id = "agentcore"
    configured_aliases = ["primary"]

    def __init__(self, chunks: list[str] | None = None, delay: float = 0.0) -> None:
        self.chunks = chunks or ["hello", " world"]
        self.delay = delay
        self.calls: list[dict[str, str]] = []

    async def stream(
        self,
        *,
        runtime_alias: str,
        provider_session_id: str,
        agent_id: str,
        conversation_id: str,
        message: str,
        traceparent: str | None,
    ) -> AsyncIterator[str]:
        import asyncio

        self.calls.append(
            {
                "runtime_alias": runtime_alias,
                "provider_session_id": provider_session_id,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
                "message": message,
                "traceparent": traceparent or "",
            }
        )
        for chunk in self.chunks:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield chunk


@pytest.fixture
def settings() -> Settings:
    return Settings(
        internal_token="test-internal-token-value",
        storage_backend="memory",
        long_poll_seconds=0.1,
        agentcore_runtimes_json=json.dumps(
            {
                "primary": {
                    "arn": "arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/example",
                    "qualifier": "DEFAULT",
                }
            }
        ),
    )


@pytest.fixture
def repository() -> InMemoryRunRepository:
    return InMemoryRunRepository()


def auth_headers(subject: str = "test-user") -> dict[str, str]:
    return {
        "Authorization": "Bearer test-internal-token-value",
        "X-Harness-Engine-Subject": subject,
    }
