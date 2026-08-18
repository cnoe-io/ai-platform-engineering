"""Disconnect-independent run lifecycle and replay coordination."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from contextlib import suppress
from uuid import uuid4

from harness_engine.brokers import PromptCompiler
from harness_engine.models import (
    CreateRunRequest,
    RunContext,
    RunRecord,
    RunStatus,
    SessionBinding,
    TurnInput,
)
from harness_engine.registry import HarnessRegistry
from harness_engine.repository import RunRepository


class AgentNotRunnableError(Exception):
    """The requested agent or pinned version cannot be executed."""


class RunCoordinator:
    """Own provider tasks independently from any browser/BFF response stream."""

    def __init__(
        self,
        repository: RunRepository,
        registry: HarnessRegistry,
        prompt_compiler: PromptCompiler,
        session_key: bytes,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._prompt_compiler = prompt_compiler
        self._session_key = session_key
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def _binding_id(self, owner_subject: str, agent_id: str, conversation_id: str) -> str:
        identity = "\0".join((owner_subject, agent_id, conversation_id, "0")).encode()
        digest = hmac.new(self._session_key, identity, hashlib.sha256).hexdigest()
        return f"binding-{digest}"

    async def start_run(
        self,
        request: CreateRunRequest,
        owner_subject: str,
        traceparent: str | None = None,
    ) -> RunRecord:
        record = await self._repository.get_agent(request.agent_id)
        if not record or not record.enabled:
            raise AgentNotRunnableError(request.agent_id)

        binding_id = self._binding_id(owner_subject, request.agent_id, request.conversation_id)
        binding = await self._repository.get_session(binding_id)
        version_number = binding.agent_version if binding else record.current_version
        version = await self._repository.get_agent_version(request.agent_id, version_number)
        if version is None:
            raise AgentNotRunnableError(request.agent_id)
        try:
            adapter = self._registry.adapter(version.blueprint.harness.id)
        except Exception as exc:
            raise AgentNotRunnableError(version.blueprint.harness.id) from exc
        evaluation = adapter.evaluate(version.blueprint)

        if binding is None:
            binding = await self._repository.create_session(
                SessionBinding(
                    binding_id=binding_id,
                    owner_subject=owner_subject,
                    agent_id=request.agent_id,
                    agent_version=version.version,
                    conversation_id=request.conversation_id,
                    harness_id=version.blueprint.harness.id,
                    profile_id=version.blueprint.harness.profile_id,
                    provider_session_id=adapter.initial_provider_session_id(binding_id),
                    checkpoint_strategy=evaluation.checkpoint_strategy,
                )
            )

        run = RunRecord(
            run_id=f"run-{uuid4().hex}",
            owner_subject=owner_subject,
            agent_id=request.agent_id,
            agent_version=version.version,
            conversation_id=request.conversation_id,
            binding_id=binding.binding_id,
            harness_id=binding.harness_id,
            profile_id=binding.profile_id,
            provider_session_id=binding.provider_session_id,
            client_request_id=request.client_request_id,
            traceparent=traceparent,
        )
        await self._repository.create_run(run)
        context = RunContext(
            blueprint=version.blueprint,
            binding=binding,
            prompt=await self._prompt_compiler.compile(version.blueprint),
            turn=TurnInput(run_id=run.run_id, message=request.message, traceparent=traceparent),
        )
        task = asyncio.create_task(self._pump(run, context), name=f"harness-run:{run.run_id}")
        self._tasks[run.run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run.run_id, None))
        return run

    async def _pump(self, run: RunRecord, context: RunContext) -> None:
        try:
            await self._repository.append_event(
                run.run_id,
                "run.started",
                {
                    "harness_id": run.harness_id,
                    "agent_version": run.agent_version,
                    "binding_id": run.binding_id,
                },
                RunStatus.RUNNING,
            )
            adapter = self._registry.adapter(run.harness_id)
            async for event in adapter.stream(context):
                if event.event_type == "session.updated":
                    provider_session_id = str(event.data.get("provider_session_id", ""))
                    if provider_session_id:
                        await self._repository.update_session_provider_id(
                            run.binding_id, provider_session_id
                        )
                        await self._repository.update_run_provider_id(
                            run.run_id, provider_session_id
                        )
                await self._repository.append_event(
                    run.run_id, event.event_type, event.data
                )
            await self._repository.append_event(
                run.run_id, "run.completed", {}, RunStatus.COMPLETED
            )
        except asyncio.CancelledError:
            await self._repository.append_event(
                run.run_id, "run.cancelled", {}, RunStatus.CANCELLED
            )
            raise
        except Exception:
            await self._repository.append_event(
                run.run_id,
                "run.failed",
                {
                    "code": "provider_error",
                    "message": "Harness execution failed; inspect the correlated server trace",
                },
                RunStatus.FAILED,
            )

    async def cancel(self, run_id: str) -> RunRecord | None:
        task = self._tasks.get(run_id)
        if task and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        return await self._repository.get_run(run_id)

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
