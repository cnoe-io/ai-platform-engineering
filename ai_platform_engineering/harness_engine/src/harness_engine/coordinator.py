"""Disconnect-independent run lifecycle and replay coordination."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from uuid import uuid4

from harness_engine.brokers import PromptCompiler
from harness_engine.models import (
    CancelActiveRunResult,
    ClearAgentSessionResult,
    CreateRunRequest,
    RunContext,
    RunRecord,
    RunStatus,
    TurnInput,
)
from harness_engine.registry import HarnessRegistry
from harness_engine.repository import RunRepository
from harness_engine.sessions import (
    AgentSessionClosedError,
    AgentSessionNotRunnableError,
    CAIPEAgentSessionManager,
)


class AgentNotRunnableError(Exception):
    """The requested agent or pinned version cannot be executed."""


class RunCoordinator:
    """Own provider tasks independently from any browser/BFF response stream."""

    def __init__(
        self,
        repository: RunRepository,
        registry: HarnessRegistry,
        session_manager: CAIPEAgentSessionManager,
        prompt_compiler: PromptCompiler,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._session_manager = session_manager
        self._prompt_compiler = prompt_compiler
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._run_bindings: dict[str, str] = {}

    async def start_run(
        self,
        request: CreateRunRequest,
        owner_subject: str,
        traceparent: str | None = None,
    ) -> RunRecord:
        try:
            binding, version = await self._session_manager.resolve(
                owner_subject, request.agent_id, request.conversation_id
            )
        except AgentSessionNotRunnableError as exc:
            raise AgentNotRunnableError(request.agent_id) from exc

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
        rendered_prompt = await self._prompt_compiler.compile(version.blueprint)
        if request.context:
            rendered_prompt = rendered_prompt.model_copy(
                update={
                    "system": (
                        f"{rendered_prompt.system}\n\n"
                        f"<client-system-context>\n{request.context}\n"
                        "</client-system-context>"
                    )
                }
            )
        context = RunContext(
            blueprint=version.blueprint,
            binding=binding,
            prompt=rendered_prompt,
            turn=TurnInput(run_id=run.run_id, message=request.message, traceparent=traceparent),
        )
        task = asyncio.create_task(self._pump(run, context), name=f"harness-run:{run.run_id}")
        self._tasks[run.run_id] = task
        self._run_bindings[run.run_id] = binding.binding_id

        def forget(_: asyncio.Task[None]) -> None:
            self._tasks.pop(run.run_id, None)
            self._run_bindings.pop(run.run_id, None)

        task.add_done_callback(forget)
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
                updated_binding = await self._session_manager.observe_provider_event(
                    context.binding, event
                )
                if updated_binding.provider_session_id != context.binding.provider_session_id:
                    context = context.model_copy(update={"binding": updated_binding})
                    if updated_binding.provider_session_id:
                        await self._repository.update_run_provider_id(
                            run.run_id, updated_binding.provider_session_id
                        )
                await self._repository.append_event(
                    run.run_id, event.event_type, event.data
                )
            await self._session_manager.ensure_active(context.binding)
            await self._repository.append_event(
                run.run_id, "run.completed", {}, RunStatus.COMPLETED
            )
        except asyncio.CancelledError:
            await self._repository.append_event(
                run.run_id, "run.cancelled", {}, RunStatus.CANCELLED
            )
            raise
        except AgentSessionClosedError:
            await self._repository.append_event(
                run.run_id, "run.cancelled", {}, RunStatus.CANCELLED
            )
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

    async def cancel_active(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> CancelActiveRunResult:
        run = await self._repository.get_active_run(
            owner_subject, agent_id, conversation_id
        )
        if run is None:
            return CancelActiveRunResult(cancelled=False)
        cancelled = await self.cancel(run.run_id)
        return CancelActiveRunResult(
            cancelled=cancelled is not None and cancelled.status == RunStatus.CANCELLED,
            run_id=run.run_id,
        )

    async def clear_session(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> ClearAgentSessionResult:
        binding = await self._session_manager.current(
            owner_subject, agent_id, conversation_id
        )
        if binding is not None and binding.status == "active":
            run_ids = [
                run_id
                for run_id, binding_id in self._run_bindings.items()
                if binding_id == binding.binding_id
            ]
            for run_id in run_ids:
                await self.cancel(run_id)
        return await self._session_manager.clear(
            owner_subject, agent_id, conversation_id
        )

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
