"""Provider-neutral adapter contract."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol


class HarnessAdapter(Protocol):
    harness_id: str

    async def stream(
        self,
        *,
        runtime_alias: str,
        provider_session_id: str,
        agent_id: str,
        conversation_id: str,
        message: str,
        traceparent: str | None,
    ) -> AsyncIterator[str]: ...
