"""Disconnect-independent run lifecycle and replay coordination."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
from contextlib import suppress
from uuid import uuid4

from harness_engine.adapters.base import HarnessAdapter
from harness_engine.models import CreateRunRequest, RunRecord, RunStatus
from harness_engine.repository import RunRepository


class AgentHarnessNotConfiguredError(Exception):
    """The requested agent has no enabled Harness Engine overlay."""


class RunCoordinator:
    """Own provider tasks independently from any browser/BFF response stream."""

    def __init__(
        self,
        repository: RunRepository,
        adapters: dict[str, HarnessAdapter],
        session_key: bytes,
    ) -> None:
        self._repository = repository
        self._adapters = adapters
        self._session_key = session_key
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def _provider_session_id(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> str:
        identity = "\0".join((owner_subject, agent_id, conversation_id)).encode()
        digest = hmac.new(self._session_key, identity, hashlib.sha256).hexdigest()
        return f"harness-session-{digest}"

    async def start_run(
        self,
        request: CreateRunRequest,
        owner_subject: str,
        traceparent: str | None = None,
    ) -> RunRecord:
        config = await self._repository.get_agent_config(request.agent_id)
        if not config or not config.enabled:
            raise AgentHarnessNotConfiguredError(request.agent_id)
        adapter = self._adapters.get(config.harness_id)
        if adapter is None:
            raise AgentHarnessNotConfiguredError(config.harness_id)

        run = RunRecord(
            run_id=f"run-{uuid4().hex}",
            owner_subject=owner_subject,
            agent_id=request.agent_id,
            conversation_id=request.conversation_id,
            harness_id=config.harness_id,
            runtime_alias=config.runtime_alias,
            provider_session_id=self._provider_session_id(
                owner_subject, request.agent_id, request.conversation_id
            ),
            client_request_id=request.client_request_id,
            traceparent=traceparent,
        )
        await self._repository.create_run(run)
        task = asyncio.create_task(self._pump(run, request.message, adapter), name=f"harness-run:{run.run_id}")
        self._tasks[run.run_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run.run_id, None))
        return run

    async def _pump(self, run: RunRecord, message: str, adapter: HarnessAdapter) -> None:
        try:
            await self._repository.append_event(
                run.run_id,
                "run.started",
                {"harness_id": run.harness_id, "provider_session_id": run.provider_session_id},
                RunStatus.RUNNING,
            )
            async for text in adapter.stream(
                runtime_alias=run.runtime_alias,
                provider_session_id=run.provider_session_id,
                agent_id=run.agent_id,
                conversation_id=run.conversation_id,
                message=message,
                traceparent=run.traceparent,
            ):
                await self._repository.append_event(run.run_id, "content.delta", {"text": text})
            await self._repository.append_event(run.run_id, "run.completed", {}, RunStatus.COMPLETED)
        except asyncio.CancelledError:
            await self._repository.append_event(run.run_id, "run.cancelled", {}, RunStatus.CANCELLED)
            raise
        except Exception as exc:
            await self._repository.append_event(
                run.run_id,
                "run.failed",
                {"code": "provider_error", "message": str(exc)},
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
