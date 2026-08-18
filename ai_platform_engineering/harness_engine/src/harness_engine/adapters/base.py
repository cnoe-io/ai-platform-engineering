"""Provider-neutral adapter contract."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from harness_engine.models import (
    AdapterEvaluation,
    AgentBlueprint,
    CanonicalEventDraft,
    HarnessDescriptor,
    RunContext,
)


class HarnessAdapter(Protocol):
    @property
    def descriptor(self) -> HarnessDescriptor: ...

    def evaluate(self, blueprint: AgentBlueprint) -> AdapterEvaluation: ...

    def initial_provider_session_id(self, binding_id: str) -> str | None: ...

    def stream(self, context: RunContext) -> AsyncIterator[CanonicalEventDraft]: ...
