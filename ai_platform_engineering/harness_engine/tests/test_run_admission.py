from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import mongomock
import pytest

from harness_engine.brokers import DefaultPromptCompiler
from harness_engine.coordinator import RunCoordinator
from harness_engine.models import AgentBlueprint, CreateRunRequest, RenderedPrompt, RunRecord, RunStatus
from harness_engine.registry import HarnessRegistry
from harness_engine.repository import InMemoryRunRepository, MongoRunRepository, RunAdmissionConflict, RunRepository
from harness_engine.sessions import CAIPEAgentSessionManager
from tests.conftest import FakeHarnessAdapter, blueprint


@pytest.fixture(params=["memory", "mongo"])
async def durable_repository(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[RunRepository]:
    if request.param == "memory":
        repository = InMemoryRunRepository()
    else:
        client = mongomock.MongoClient(tz_aware=True)
        monkeypatch.setattr("harness_engine.repository.MongoClient", lambda *args, **kwargs: client)
        repository = MongoRunRepository("mongodb://example.test", "test", 3600)
    await repository.initialize()
    yield repository
    await repository.close()


class PausingCompiler(DefaultPromptCompiler):
    def __init__(self) -> None:
        self.entered = asyncio.Event()
        self.resume = asyncio.Event()

    async def compile(self, agent: AgentBlueprint) -> RenderedPrompt:
        self.entered.set()
        await self.resume.wait()
        return await super().compile(agent)


async def coordinators(
    repository: RunRepository,
) -> tuple[RunCoordinator, RunCoordinator, PausingCompiler, FakeHarnessAdapter]:
    adapter = FakeHarnessAdapter()
    registry = HarnessRegistry([adapter])
    validation = registry.validate(AgentBlueprint.model_validate(blueprint()))
    await repository.save_agent(
        validation.normalized_blueprint, validation.config_fingerprint, validation.catalog_revision, None
    )
    compiler = PausingCompiler()

    def coordinator() -> RunCoordinator:
        return RunCoordinator(
            repository, registry, CAIPEAgentSessionManager(repository, registry, b"test-key"), compiler
        )

    return coordinator(), coordinator(), compiler, adapter


def request(request_id: str = "request-1", message: str = "hello") -> CreateRunRequest:
    return CreateRunRequest(
        agent_id="agent-example", conversation_id="conversation-example", message=message, client_request_id=request_id
    )


async def test_duplicate_requests_join_one_producer_and_busy_turns_are_rejected(
    durable_repository: RunRepository,
) -> None:
    first, second, compiler, adapter = await coordinators(durable_repository)
    run = await first.start_run(request(), "test-user")
    await asyncio.wait_for(compiler.entered.wait(), 1)
    duplicate = await second.start_run(request(), "test-user")
    assert duplicate.run_id == run.run_id
    with pytest.raises(RunAdmissionConflict, match="active run"):
        await second.start_run(request("request-2"), "test-user")
    with pytest.raises(RunAdmissionConflict, match="different input"):
        await second.start_run(request(message="different"), "test-user")
    compiler.resume.set()
    await asyncio.wait_for(first._tasks[run.run_id], 1)
    assert len(adapter.calls) == 1
    retry = await second.start_run(request(), "test-user")
    assert retry.run_id == run.run_id
    assert retry.status == RunStatus.COMPLETED
    assert len(adapter.calls) == 1


async def test_clear_from_another_coordinator_fences_a_start_paused_in_compile(
    durable_repository: RunRepository,
) -> None:
    first, second, compiler, adapter = await coordinators(durable_repository)
    run = await first.start_run(request(), "test-user")
    task = first._tasks[run.run_id]
    await asyncio.wait_for(compiler.entered.wait(), 1)
    cleared = await second.clear_session("test-user", "agent-example", "conversation-example")
    assert cleared.cleared
    compiler.resume.set()
    await asyncio.wait_for(task, 1)
    assert adapter.calls == []
    stored = await durable_repository.get_run(run.run_id)
    assert stored and stored.status == RunStatus.CANCELLED
    assert [event.event_type for event in await durable_repository.list_events(run.run_id, 0)] == ["run.cancelled"]


async def test_simultaneous_admission_and_dispatch_are_unique(durable_repository: RunRepository) -> None:
    first, _, _, _ = await coordinators(durable_repository)
    binding, version = await first._session_manager.resolve("test-user", "agent-example", "conversation-example")

    def run(number: int) -> RunRecord:
        return RunRecord(
            run_id="run-same-request",
            owner_subject="test-user",
            agent_id="agent-example",
            agent_version=version.version,
            conversation_id="conversation-example",
            binding_id=binding.binding_id,
            harness_id=binding.harness_id,
            profile_id=binding.profile_id,
            client_request_id="same-request",
        )

    results = await asyncio.gather(*(durable_repository.admit_run(run(number), "same-input", f"producer-{number}", 30.0) for number in range(8)))
    assert len({item.run_id for item, _ in results}) == 1
    assert sum(admitted for _, admitted in results) == 1
    run_id = results[0][0].run_id
    winner = next(index for index, (_, admitted) in enumerate(results) if admitted)
    producer_id = f"producer-{winner}"
    await durable_repository.append_event(run_id, "run.started", {}, RunStatus.RUNNING, producer_id=producer_id)
    dispatched = await asyncio.gather(
        *(durable_repository.begin_provider(run_id, producer_id, 30.0) for _ in range(8))
    )
    assert sum(dispatched) == 1
    await durable_repository.close_session(binding.binding_id)
    assert not await durable_repository.begin_provider(run_id, producer_id, 30.0)


async def test_cancel_before_preparation_starts_releases_the_reservation(durable_repository: RunRepository) -> None:
    first, second, _, adapter = await coordinators(durable_repository)
    run = await first.start_run(request(), "test-user")
    cancelled = await first.cancel(run.run_id)
    assert cancelled and cancelled.status == RunStatus.CANCELLED
    assert adapter.calls == []
    binding = await second._session_manager.current("test-user", "agent-example", "conversation-example")
    assert binding and not (await durable_repository._read_binding(binding.binding_id)).get("_active_run_id")
