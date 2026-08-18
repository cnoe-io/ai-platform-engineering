"""Claude Agent SDK adapter implementing the portable harness contract."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from typing import Any

from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, TextBlock, query
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from harness_engine.config import ClaudeSDKProfile, Settings
from harness_engine.models import (
    AdapterEvaluation,
    AgentBlueprint,
    CanonicalEventDraft,
    CapabilityLevel,
    CapabilityResult,
    ExecutionMode,
    HarnessDescriptor,
    HarnessProfile,
    RunContext,
    ValidationIssue,
)


class ClaudeHarnessOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_turns: int = Field(20, ge=1, le=100)
    permission_mode: str | None = Field(
        None, pattern=r"^(default|acceptEdits|plan|dontAsk)$"
    )


ClaudeQuery = Callable[..., AsyncIterator[Any]]


class ClaudeSDKAdapter:
    def __init__(
        self,
        settings: Settings,
        *,
        query_fn: ClaudeQuery = query,
    ) -> None:
        self._profiles = settings.claude_sdk_profiles()
        self._query = query_fn

    @property
    def descriptor(self) -> HarnessDescriptor:
        profiles = [
            HarnessProfile(
                id=alias,
                harness_id="claude_agent_sdk",
                display_name=alias.replace("-", " ").replace("_", " ").title(),
                description=profile.description or "Operator-managed Claude SDK policy",
            )
            for alias, profile in sorted(self._profiles.items())
        ]
        return HarnessDescriptor(
            id="claude_agent_sdk",
            display_name="Claude Agent SDK",
            adapter_version="1.0.0",
            execution_mode=ExecutionMode.IN_PROCESS,
            availability="available" if profiles else "misconfigured",
            certification="experimental",
            profiles=profiles,
            options_schema={
                "type": "object",
                "properties": {
                    "max_turns": {
                        "type": "integer",
                        "title": "Maximum turns",
                        "minimum": 1,
                        "maximum": 100,
                        "default": 20,
                    },
                    "permission_mode": {
                        "type": "string",
                        "title": "Permission mode",
                        "enum": ["dontAsk", "plan"],
                    },
                },
                "additionalProperties": False,
            },
            ui_schema={"ui:order": ["max_turns", "permission_mode"]},
            capabilities={
                "stream.text": CapabilityResult(level=CapabilityLevel.NATIVE),
                "stream.replay": CapabilityResult(
                    level=CapabilityLevel.EMULATED,
                    explanation="Harness Engine persists the canonical event log",
                ),
                "thread.persistence": CapabilityResult(
                    level=CapabilityLevel.NATIVE,
                    explanation="Claude session IDs are persisted and supplied through resume",
                ),
                "session.cross_replica": CapabilityResult(
                    level=CapabilityLevel.EMULATED,
                    explanation="A shared Harness Engine session store carries the Claude session ID",
                ),
                "sandbox.isolation": CapabilityResult(
                    level=CapabilityLevel.UNAVAILABLE,
                    explanation="This first adapter runs in-process; sandbox pods are the target mode",
                ),
                "sandbox.workspace": CapabilityResult(
                    level=CapabilityLevel.UNAVAILABLE,
                    explanation="Sandbox workspace leasing is not connected yet",
                ),
                "memory.long_term": CapabilityResult(
                    level=CapabilityLevel.UNAVAILABLE,
                    explanation="Portable long-term memory is not connected yet",
                ),
                "tools.broker": CapabilityResult(
                    level=CapabilityLevel.UNAVAILABLE,
                    explanation="Portable tool bindings are not connected yet",
                ),
                "multi_agent.delegation": CapabilityResult(
                    level=CapabilityLevel.UNAVAILABLE,
                    explanation="Portable delegation is not connected yet",
                ),
            },
        )

    def _profile(self, profile_id: str) -> ClaudeSDKProfile:
        try:
            return self._profiles[profile_id]
        except KeyError as exc:
            raise ValueError("Claude SDK profile is not configured") from exc

    def evaluate(self, blueprint: AgentBlueprint) -> AdapterEvaluation:
        try:
            options = ClaudeHarnessOptions.model_validate(blueprint.harness.options)
        except ValidationError as exc:
            return AdapterEvaluation(
                normalized_options={},
                checkpoint_strategy="adapter_store",
                issues=[
                    ValidationIssue(
                        path="harness.options",
                        capability="configuration",
                        level=CapabilityLevel.UNSUPPORTED,
                        severity="error",
                        message=error["msg"],
                    )
                    for error in exc.errors()
                ],
            )
        profile = self._profiles.get(blueprint.harness.profile_id)
        if options.permission_mode and profile and options.permission_mode != profile.permission_mode:
            return AdapterEvaluation(
                normalized_options=options.model_dump(exclude_none=True),
                checkpoint_strategy="adapter_store",
                issues=[
                    ValidationIssue(
                        path="harness.options.permission_mode",
                        capability="configuration",
                        level=CapabilityLevel.UNSUPPORTED,
                        severity="error",
                        message="The permission mode must match the operator profile",
                    )
                ],
            )
        return AdapterEvaluation(
            normalized_options=options.model_dump(exclude_none=True),
            checkpoint_strategy="adapter_store",
        )

    def initial_provider_session_id(self, binding_id: str) -> None:
        return None

    async def stream(self, context: RunContext) -> AsyncIterator[CanonicalEventDraft]:
        profile = self._profile(context.binding.profile_id)
        options = ClaudeHarnessOptions.model_validate(context.blueprint.harness.options)
        sdk_options = ClaudeAgentOptions(
            system_prompt=context.prompt.system,
            model=profile.model,
            cwd=profile.cwd,
            max_turns=options.max_turns,
            permission_mode=profile.permission_mode,  # type: ignore[arg-type]
            resume=context.binding.provider_session_id,
            setting_sources=[],
        )
        async for message in self._query(prompt=context.turn.message, options=sdk_options):
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock) and block.text:
                        yield CanonicalEventDraft(
                            event_type="content.delta", data={"text": block.text}
                        )
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    raise RuntimeError("Claude Agent SDK run failed")
                if message.session_id != context.binding.provider_session_id:
                    yield CanonicalEventDraft(
                        event_type="session.updated",
                        data={"provider_session_id": message.session_id},
                    )
                if message.usage:
                    yield CanonicalEventDraft(
                        event_type="usage.updated", data={"usage": message.usage}
                    )
