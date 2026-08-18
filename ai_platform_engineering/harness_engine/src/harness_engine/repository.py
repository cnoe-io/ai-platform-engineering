"""Run persistence abstractions and memory/Mongo implementations."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Protocol

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

from harness_engine.models import AgentHarnessConfig, RunEvent, RunRecord, RunStatus, utc_now


class RevisionConflictError(Exception):
    """Optimistic harness-overlay update failed."""


class RunRepository(Protocol):
    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def get_agent_config(self, agent_id: str) -> AgentHarnessConfig | None: ...

    async def put_agent_config(
        self, config: AgentHarnessConfig, expected_revision: int | None
    ) -> AgentHarnessConfig: ...

    async def delete_agent_config(self, agent_id: str) -> bool: ...

    async def create_run(self, run: RunRecord) -> RunRecord: ...

    async def get_run(self, run_id: str) -> RunRecord | None: ...

    async def append_event(
        self, run_id: str, event_type: str, data: dict[str, object], status: RunStatus | None = None
    ) -> RunEvent: ...

    async def list_events(self, run_id: str, after: int) -> list[RunEvent]: ...

    async def wait_for_events(self, run_id: str, after: int, timeout: float) -> list[RunEvent]: ...


class InMemoryRunRepository:
    """Deterministic repository for local development and tests."""

    def __init__(self) -> None:
        self._configs: dict[str, AgentHarnessConfig] = {}
        self._runs: dict[str, RunRecord] = {}
        self._events: dict[str, list[RunEvent]] = defaultdict(list)
        self._conditions: dict[str, asyncio.Condition] = defaultdict(asyncio.Condition)
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def get_agent_config(self, agent_id: str) -> AgentHarnessConfig | None:
        config = self._configs.get(agent_id)
        return config.model_copy(deep=True) if config else None

    async def put_agent_config(
        self, config: AgentHarnessConfig, expected_revision: int | None
    ) -> AgentHarnessConfig:
        async with self._lock:
            current = self._configs.get(config.agent_id)
            if expected_revision is not None and (current is None or current.revision != expected_revision):
                raise RevisionConflictError(config.agent_id)
            next_revision = (current.revision + 1) if current else 1
            stored = config.model_copy(update={"revision": next_revision, "updated_at": utc_now()})
            self._configs[stored.agent_id] = stored
            return stored.model_copy(deep=True)

    async def delete_agent_config(self, agent_id: str) -> bool:
        async with self._lock:
            return self._configs.pop(agent_id, None) is not None

    async def create_run(self, run: RunRecord) -> RunRecord:
        async with self._lock:
            if run.run_id in self._runs:
                raise RevisionConflictError(run.run_id)
            self._runs[run.run_id] = run
            return run.model_copy(deep=True)

    async def get_run(self, run_id: str) -> RunRecord | None:
        run = self._runs.get(run_id)
        return run.model_copy(deep=True) if run else None

    async def append_event(
        self, run_id: str, event_type: str, data: dict[str, object], status: RunStatus | None = None
    ) -> RunEvent:
        async with self._lock:
            run = self._runs[run_id]
            sequence = run.last_sequence + 1
            event = RunEvent(run_id=run_id, sequence=sequence, event_type=event_type, data=data)
            run = run.model_copy(
                update={"last_sequence": sequence, "status": status or run.status, "updated_at": utc_now()}
            )
            self._runs[run_id] = run
            self._events[run_id].append(event)
        async with self._conditions[run_id]:
            self._conditions[run_id].notify_all()
        return event

    async def list_events(self, run_id: str, after: int) -> list[RunEvent]:
        return [event.model_copy(deep=True) for event in self._events[run_id] if event.sequence > after]

    async def wait_for_events(self, run_id: str, after: int, timeout: float) -> list[RunEvent]:
        events = await self.list_events(run_id, after)
        if events:
            return events
        async with self._conditions[run_id]:
            try:
                await asyncio.wait_for(self._conditions[run_id].wait(), timeout=timeout)
            except TimeoutError:
                pass
        return await self.list_events(run_id, after)


class MongoRunRepository:
    """Mongo-backed replay store; long polls work across Harness Engine replicas."""

    def __init__(self, uri: str, database: str, retention_seconds: int) -> None:
        self._client = MongoClient(uri, tz_aware=True)
        self._db = self._client[database]
        self._retention_seconds = retention_seconds

    async def initialize(self) -> None:
        def ensure_indexes() -> None:
            self._db.harness_agent_configs.create_index("agent_id", unique=True)
            self._db.harness_runs.create_index("run_id", unique=True)
            self._db.harness_runs.create_index([("owner_subject", ASCENDING), ("created_at", ASCENDING)])
            self._db.harness_events.create_index([("run_id", ASCENDING), ("sequence", ASCENDING)], unique=True)
            self._db.harness_events.create_index(
                "created_at", expireAfterSeconds=self._retention_seconds
            )

        await asyncio.to_thread(ensure_indexes)

    async def close(self) -> None:
        await asyncio.to_thread(self._client.close)

    async def get_agent_config(self, agent_id: str) -> AgentHarnessConfig | None:
        doc = await asyncio.to_thread(self._db.harness_agent_configs.find_one, {"agent_id": agent_id}, {"_id": 0})
        return AgentHarnessConfig.model_validate(doc) if doc else None

    async def put_agent_config(
        self, config: AgentHarnessConfig, expected_revision: int | None
    ) -> AgentHarnessConfig:
        def write() -> dict[str, object]:
            current = self._db.harness_agent_configs.find_one({"agent_id": config.agent_id})
            if expected_revision is not None and (current is None or current.get("revision") != expected_revision):
                raise RevisionConflictError(config.agent_id)
            revision = int(current.get("revision", 0)) + 1 if current else 1
            stored = config.model_copy(update={"revision": revision, "updated_at": utc_now()})
            self._db.harness_agent_configs.replace_one(
                {"agent_id": config.agent_id}, stored.model_dump(mode="python"), upsert=True
            )
            return stored.model_dump(mode="python")

        return AgentHarnessConfig.model_validate(await asyncio.to_thread(write))

    async def delete_agent_config(self, agent_id: str) -> bool:
        result = await asyncio.to_thread(
            self._db.harness_agent_configs.delete_one, {"agent_id": agent_id}
        )
        return result.deleted_count == 1

    async def create_run(self, run: RunRecord) -> RunRecord:
        try:
            await asyncio.to_thread(self._db.harness_runs.insert_one, run.model_dump(mode="python"))
        except DuplicateKeyError as exc:
            raise RevisionConflictError(run.run_id) from exc
        return run

    async def get_run(self, run_id: str) -> RunRecord | None:
        doc = await asyncio.to_thread(self._db.harness_runs.find_one, {"run_id": run_id}, {"_id": 0})
        return RunRecord.model_validate(doc) if doc else None

    async def append_event(
        self, run_id: str, event_type: str, data: dict[str, object], status: RunStatus | None = None
    ) -> RunEvent:
        def append() -> dict[str, object]:
            update: dict[str, object] = {"$inc": {"last_sequence": 1}, "$set": {"updated_at": utc_now()}}
            if status is not None:
                update["$set"]["status"] = status.value  # type: ignore[index]
            run = self._db.harness_runs.find_one_and_update(
                {"run_id": run_id}, update, return_document=ReturnDocument.AFTER
            )
            if not run:
                raise KeyError(run_id)
            event = RunEvent(
                run_id=run_id,
                sequence=int(run["last_sequence"]),
                event_type=event_type,
                data=data,
            )
            self._db.harness_events.insert_one(event.model_dump(mode="python"))
            return event.model_dump(mode="python")

        return RunEvent.model_validate(await asyncio.to_thread(append))

    async def list_events(self, run_id: str, after: int) -> list[RunEvent]:
        def read() -> list[dict[str, object]]:
            return list(
                self._db.harness_events.find(
                    {"run_id": run_id, "sequence": {"$gt": after}}, {"_id": 0}
                ).sort("sequence", ASCENDING)
            )

        return [RunEvent.model_validate(doc) for doc in await asyncio.to_thread(read)]

    async def wait_for_events(self, run_id: str, after: int, timeout: float) -> list[RunEvent]:
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            events = await self.list_events(run_id, after)
            if events or asyncio.get_running_loop().time() >= deadline:
                return events
            await asyncio.sleep(min(0.25, max(0.0, deadline - asyncio.get_running_loop().time())))
