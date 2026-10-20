"""Disconnect-independent execution with durable admission and producer fencing."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator
from contextlib import suppress
from uuid import uuid4

from harness_engine.brokers import PromptCompiler
from harness_engine.models import (
    TERMINAL_RUN_STATUSES,
    AgentVersion,
    CancelActiveRunResult,
    CanonicalEventDraft,
    ClearAgentSessionResult,
    CreateRunRequest,
    RunContext,
    RunRecord,
    RunStatus,
    TurnInput,
)
from harness_engine.registry import HarnessRegistry
from harness_engine.repository import RunAdmissionConflict, RunFencedError, RunRepository
from harness_engine.sessions import (
    AgentSessionClosedError,
    AgentSessionNotRunnableError,
    CAIPEAgentSessionManager,
)

logger = logging.getLogger(__name__)


class AgentNotRunnableError(Exception):
    """The requested agent or pinned version cannot be executed."""


class RunCoordinator:
    """Own provider tasks independently from subscribers, never replay lost work."""

    def __init__(
        self,
        repository: RunRepository,
        registry: HarnessRegistry,
        session_manager: CAIPEAgentSessionManager,
        prompt_compiler: PromptCompiler,
        *,
        lease_seconds: float = 30.0,
    ) -> None:
        self._repository = repository
        self._registry = registry
        self._session_manager = session_manager
        self._prompt_compiler = prompt_compiler
        self._lease_seconds = lease_seconds
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._run_bindings: dict[str, str] = {}
        self._producers: dict[str, str] = {}

    async def start_run(
        self,
        request: CreateRunRequest,
        owner_subject: str,
        traceparent: str | None = None,
    ) -> RunRecord:
        if await self._repository.is_context_deleted(request.conversation_id):
            raise RunAdmissionConflict("Execution context was permanently deleted")
        request_data = request.model_dump(mode="json", exclude={"client_request_id"})
        fingerprint = hashlib.sha256(
            json.dumps(request_data, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        request_identity = json.dumps(
            [owner_subject, request.agent_id, request.conversation_id, request.client_request_id or uuid4().hex],
            separators=(",", ":"),
        )
        run_id = "run-" + hashlib.sha256(request_identity.encode()).hexdigest()
        existing = await self._repository.lookup_request(run_id, fingerprint, owner_subject=owner_subject, request=request)
        if existing:
            return existing
        try:
            binding, version = await self._session_manager.resolve(
                owner_subject,
                request.agent_id,
                request.conversation_id,
                expected_harness_id=request.expected_harness_id,
            )
        except AgentSessionNotRunnableError as exc:
            raise AgentNotRunnableError(request.agent_id) from exc
        producer_id = uuid4().hex
        run = RunRecord(
            run_id=run_id,
            owner_subject=owner_subject,
            agent_id=request.agent_id,
            agent_version=version.version,
            conversation_id=request.conversation_id,
            binding_id=binding.binding_id,
            harness_id=binding.harness_id,
            profile_id=binding.profile_id,
            provider_session_id=binding.provider_session_id,
            client_request_id=request.client_request_id,
            protocol=request.protocol,
            traceparent=traceparent,
        )
        admitted, created = await self._repository.admit_run(run, fingerprint, producer_id, self._lease_seconds)
        if not created:
            return admitted
        task = asyncio.create_task(self._pump(admitted, version, request, producer_id), name=f"harness-run:{run_id}")
        self._tasks[run_id] = task
        self._run_bindings[run_id] = run.binding_id
        self._producers[run_id] = producer_id

        def forget(_: asyncio.Task[None]) -> None:
            self._tasks.pop(run_id, None)
            self._run_bindings.pop(run_id, None)
            self._producers.pop(run_id, None)
            if not task.cancelled() and (error := task.exception()):
                logger.error(
                    "Run owner ended without a clean terminal result for %s (%s)", run_id, type(error).__name__
                )

        task.add_done_callback(forget)
        return admitted

    async def _watch_claim(self, run_id: str, producer_id: str, task: asyncio.Task[None]) -> None:
        try:
            while True:
                await asyncio.sleep(self._lease_seconds / 4)
                if not await self._repository.renew_run(run_id, producer_id, self._lease_seconds):
                    task.cancel()
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # A worker must stop producing when it cannot renew authority.
            logger.error("Run claim renewal failed for %s (%s)", run_id, type(exc).__name__)
            task.cancel()

    async def _require_claim(self, run_id: str, producer_id: str) -> None:
        if not await self._repository.renew_run(run_id, producer_id, self._lease_seconds):
            raise RunFencedError(run_id)

    async def _terminal(
        self, run_id: str, producer_id: str, event: str, status: RunStatus, data: dict[str, object] | None = None
    ) -> None:
        try:
            await self._repository.append_event(run_id, event, data or {}, status, producer_id=producer_id)
        except RunFencedError:
            # Reconciliation or clear already published a terminal result.
            return

    async def _pump(self, run: RunRecord, version: AgentVersion, request: CreateRunRequest, producer_id: str) -> None:
        task = asyncio.current_task()
        assert task is not None
        heartbeat = asyncio.create_task(self._watch_claim(run.run_id, producer_id, task))
        provider_stream: AsyncIterator[CanonicalEventDraft] | None = None
        try:
            await self._require_claim(run.run_id, producer_id)
            rendered_prompt = await self._prompt_compiler.compile(version.blueprint)
            if request.context:
                rendered_prompt = rendered_prompt.model_copy(
                    update={
                        "system": (
                            f"{rendered_prompt.system}\n\n<client-system-context>\n{request.context}\n</client-system-context>"
                        )
                    }
                )
            # Compilation may yield while another replica clears the session.
            # Fence again before invoking any provider code or tools.
            await self._require_claim(run.run_id, producer_id)
            binding = await self._session_manager.current(run.owner_subject, run.agent_id, run.conversation_id)
            if binding is None or binding.binding_id != run.binding_id:
                raise RunFencedError(run.run_id)
            context = RunContext(
                blueprint=version.blueprint,
                binding=binding,
                prompt=rendered_prompt,
                turn=TurnInput(run_id=run.run_id, message=request.message, traceparent=run.traceparent),
                producer_token=producer_id,
            )
            await self._repository.append_event(
                run.run_id,
                "run.started",
                {
                    "harness_id": run.harness_id,
                    "agent_version": run.agent_version,
                    "binding_id": run.binding_id,
                },
                RunStatus.RUNNING,
                producer_id=producer_id,
            )
            await self._require_claim(run.run_id, producer_id)
            if not await self._repository.begin_provider(run.run_id, producer_id, self._lease_seconds):
                raise RunFencedError(run.run_id)
            adapter = self._registry.adapter(run.harness_id)
            provider_stream = adapter.stream(context)
            async for event in provider_stream:
                await self._require_claim(run.run_id, producer_id)
                updated_binding = await self._session_manager.observe_provider_event(context.binding, event)
                if updated_binding.provider_session_id != context.binding.provider_session_id:
                    context = context.model_copy(update={"binding": updated_binding})
                    if updated_binding.provider_session_id:
                        await self._repository.update_run_provider_id(run.run_id, updated_binding.provider_session_id)
                await self._repository.append_event(run.run_id, event.event_type, event.data, producer_id=producer_id)
            await self._require_claim(run.run_id, producer_id)
            await self._session_manager.ensure_active(context.binding)
            await self._terminal(run.run_id, producer_id, "run.completed", RunStatus.COMPLETED)
        except asyncio.CancelledError:
            current = await self._repository.get_run(run.run_id)
            if current and current.status not in TERMINAL_RUN_STATUSES:
                if await self._repository.cancellation_requested(run.run_id):
                    await self._terminal(run.run_id, producer_id, "run.cancelled", RunStatus.CANCELLED)
                else:
                    await self._repository.interrupt_run(run.run_id, producer_id)
            raise
        except (AgentSessionClosedError, RunFencedError):
            current = await self._repository.get_run(run.run_id)
            if current and current.status not in TERMINAL_RUN_STATUSES:
                await self._terminal(run.run_id, producer_id, "run.cancelled", RunStatus.CANCELLED)
        except Exception as exc:
            logger.error("Harness execution failed for %s (%s)", run.run_id, type(exc).__name__)
            await self._terminal(
                run.run_id,
                producer_id,
                "run.failed",
                RunStatus.FAILED,
                {
                    "code": "provider_error",
                    "message": "Harness execution failed; inspect the correlated server trace",
                },
            )
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            if provider_stream is not None and (close_stream := getattr(provider_stream, "aclose", None)):
                await close_stream()
            # A failed terminal append keeps its lease until bounded read-side
            # reconciliation reports interruption; it must not admit overlap.
            await self._repository.release_run(run.run_id, producer_id)

    async def cancel(self, run_id: str) -> RunRecord | None:
        await self._repository.request_cancel(run_id)
        task = self._tasks.get(run_id)
        producer_id = self._producers.get(run_id)
        if task and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            # A task cancelled before its first await never enters its finally
            # block. Its local producer is stopped, so acknowledge that cancel.
            current = await self._repository.get_run(run_id)
            if producer_id and current and current.status not in TERMINAL_RUN_STATUSES:
                await self._terminal(run_id, producer_id, "run.cancelled", RunStatus.CANCELLED)
            if producer_id:
                await self._repository.release_run(run_id, producer_id)
        return await self._repository.get_run(run_id)

    async def cancel_active(
        self, owner_subject: str, agent_id: str, conversation_id: str, client_request_id: str | None = None
    ) -> CancelActiveRunResult:
        run = await self._repository.get_active_run(owner_subject, agent_id, conversation_id, client_request_id)
        if run is None:
            return CancelActiveRunResult(cancelled=False)
        cancelled = await self.cancel(run.run_id)
        return CancelActiveRunResult(
            cancelled=cancelled is not None and cancelled.status == RunStatus.CANCELLED,
            cancellation_requested=True,
            run_id=run.run_id,
        )

    async def clear_session(self, owner_subject: str, agent_id: str, conversation_id: str) -> ClearAgentSessionResult:
        binding = await self._session_manager.current(owner_subject, agent_id, conversation_id)
        if binding is None or binding.status == "closed":
            return ClearAgentSessionResult(
                cleared=False,
                closed_binding_id=binding.binding_id if binding else None,
                next_epoch=binding.epoch + 1 if binding else 0,
            )
        # Closing the durable binding is the linearization point. Remote pumps
        # lose renewal authority before local cancellation or provider cleanup.
        closed = await self._repository.close_session(binding.binding_id)
        for run_id, binding_id in list(self._run_bindings.items()):
            if binding_id == binding.binding_id:
                await self.cancel(run_id)
        # A remote producer observes the closed binding via its renewable claim.
        await self._registry.adapter(binding.harness_id).session_manager.close(binding)
        return ClearAgentSessionResult(cleared=True, closed_binding_id=closed.binding_id, next_epoch=closed.epoch + 1)

    async def delete_session(self, owner_subject: str, agent_id: str, conversation_id: str) -> None:
        if not await self._repository.is_context_deleted(conversation_id):
            raise RunAdmissionConflict("Permanent deletion must first fence the canonical conversation")
        bindings = await self._repository.context_sessions(owner_subject, agent_id, conversation_id)
        run_bindings = await self._repository.context_run_binding_ids(owner_subject, agent_id, conversation_id)
        if run_bindings - {binding.binding_id for binding in bindings}:
            raise RunAdmissionConflict("Retained execution has no binding; provider cleanup requires reconciliation")
        for binding in bindings:
            if binding.status != "closed":
                await self._repository.close_session(binding.binding_id)
        ids = {binding.binding_id for binding in bindings}
        for run_id, binding_id in list(self._run_bindings.items()):
            if binding_id in ids:
                await self.cancel(run_id)
        if not await self._repository.context_is_drained(owner_subject, agent_id, conversation_id):
            raise RunAdmissionConflict(
                "Deletion is waiting for the execution owner to stop; an unknown owner requires reconciliation"
            )
        for binding in bindings:
            adapter = self._registry.adapter(binding.harness_id)
            await adapter.session_manager.close(binding)
            if delete_provider_state := getattr(adapter, "delete_session", None):
                await delete_provider_state(binding)
        await self._repository.purge_context(owner_subject, agent_id, conversation_id)

    async def shutdown(self) -> None:
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
