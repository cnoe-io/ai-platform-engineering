"""Agent, session, run, and canonical event persistence."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Protocol

from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

from harness_engine.models import (
    AgentBlueprint,
    AgentRecord,
    AgentVersion,
    ProviderResource,
    RunEvent,
    RunRecord,
    RunStatus,
    SessionBinding,
    utc_now,
)


class RevisionConflictError(Exception):
    """An optimistic agent update or unique insert failed."""


class RunRepository(Protocol):
    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def get_agent(self, agent_id: str) -> AgentRecord | None: ...

    async def get_agent_version(
        self, agent_id: str, version: int | None = None
    ) -> AgentVersion | None: ...

    async def save_agent(
        self,
        blueprint: AgentBlueprint,
        config_fingerprint: str,
        catalog_revision: str,
        expected_revision: int | None,
    ) -> tuple[AgentRecord, AgentVersion]: ...

    async def delete_agent(self, agent_id: str) -> bool: ...

    async def get_provider_resource(self, agent_id: str) -> ProviderResource | None: ...

    async def save_provider_resource(self, resource: ProviderResource) -> ProviderResource: ...

    async def delete_provider_resource(self, agent_id: str) -> bool: ...

    async def get_session(self, binding_id: str) -> SessionBinding | None: ...

    async def get_latest_session(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> SessionBinding | None: ...

    async def create_session(self, binding: SessionBinding) -> SessionBinding: ...

    async def update_session_provider_id(
        self, binding_id: str, provider_session_id: str
    ) -> SessionBinding: ...

    async def close_session(self, binding_id: str) -> SessionBinding: ...

    async def create_run(self, run: RunRecord) -> RunRecord: ...

    async def get_run(self, run_id: str) -> RunRecord | None: ...

    async def get_active_run(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> RunRecord | None: ...

    async def update_run_provider_id(self, run_id: str, provider_session_id: str) -> None: ...

    async def append_event(
        self, run_id: str, event_type: str, data: dict[str, object], status: RunStatus | None = None
    ) -> RunEvent: ...

    async def list_events(self, run_id: str, after: int) -> list[RunEvent]: ...

    async def wait_for_events(self, run_id: str, after: int, timeout: float) -> list[RunEvent]: ...


class InMemoryRunRepository:
    """Deterministic repository for local development and tests."""

    def __init__(self) -> None:
        self._agents: dict[str, AgentRecord] = {}
        self._versions: dict[tuple[str, int], AgentVersion] = {}
        self._sessions: dict[str, SessionBinding] = {}
        self._provider_resources: dict[str, ProviderResource] = {}
        self._runs: dict[str, RunRecord] = {}
        self._events: dict[str, list[RunEvent]] = defaultdict(list)
        self._conditions: dict[str, asyncio.Condition] = defaultdict(asyncio.Condition)
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def get_agent(self, agent_id: str) -> AgentRecord | None:
        record = self._agents.get(agent_id)
        return record.model_copy(deep=True) if record else None

    async def get_agent_version(
        self, agent_id: str, version: int | None = None
    ) -> AgentVersion | None:
        if version is None:
            record = self._agents.get(agent_id)
            version = record.current_version if record else None
        stored = self._versions.get((agent_id, version)) if version else None
        return stored.model_copy(deep=True) if stored else None

    async def save_agent(
        self,
        blueprint: AgentBlueprint,
        config_fingerprint: str,
        catalog_revision: str,
        expected_revision: int | None,
    ) -> tuple[AgentRecord, AgentVersion]:
        async with self._lock:
            current = self._agents.get(blueprint.id)
            if expected_revision is not None and (
                current is None or current.revision != expected_revision
            ):
                raise RevisionConflictError(blueprint.id)
            now = utc_now()
            version_number = current.current_version + 1 if current else 1
            version = AgentVersion(
                agent_id=blueprint.id,
                version=version_number,
                blueprint=blueprint,
                config_fingerprint=config_fingerprint,
                catalog_revision=catalog_revision,
                created_at=now,
            )
            record = AgentRecord(
                agent_id=blueprint.id,
                current_version=version_number,
                revision=(current.revision + 1) if current else 1,
                enabled=current.enabled if current else True,
                created_at=current.created_at if current else now,
                updated_at=now,
            )
            self._versions[(record.agent_id, version_number)] = version
            self._agents[record.agent_id] = record
            return record.model_copy(deep=True), version.model_copy(deep=True)

    async def delete_agent(self, agent_id: str) -> bool:
        async with self._lock:
            existed = self._agents.pop(agent_id, None) is not None
            for key in [key for key in self._versions if key[0] == agent_id]:
                del self._versions[key]
            for key in [
                key for key, session in self._sessions.items() if session.agent_id == agent_id
            ]:
                del self._sessions[key]
            return existed

    async def get_provider_resource(self, agent_id: str) -> ProviderResource | None:
        resource = self._provider_resources.get(agent_id)
        return resource.model_copy(deep=True) if resource else None

    async def save_provider_resource(self, resource: ProviderResource) -> ProviderResource:
        async with self._lock:
            self._provider_resources[resource.agent_id] = resource
            return resource.model_copy(deep=True)

    async def delete_provider_resource(self, agent_id: str) -> bool:
        async with self._lock:
            return self._provider_resources.pop(agent_id, None) is not None

    async def get_session(self, binding_id: str) -> SessionBinding | None:
        session = self._sessions.get(binding_id)
        return session.model_copy(deep=True) if session else None

    async def get_latest_session(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> SessionBinding | None:
        matches = [
            session
            for session in self._sessions.values()
            if session.owner_subject == owner_subject
            and session.agent_id == agent_id
            and session.conversation_id == conversation_id
        ]
        latest = max(matches, key=lambda session: session.epoch) if matches else None
        return latest.model_copy(deep=True) if latest else None

    async def create_session(self, binding: SessionBinding) -> SessionBinding:
        async with self._lock:
            current = self._sessions.get(binding.binding_id)
            if current:
                return current.model_copy(deep=True)
            self._sessions[binding.binding_id] = binding
            return binding.model_copy(deep=True)

    async def update_session_provider_id(
        self, binding_id: str, provider_session_id: str
    ) -> SessionBinding:
        async with self._lock:
            session = self._sessions[binding_id]
            if session.status != "active":
                raise RevisionConflictError(binding_id)
            stored = session.model_copy(
                update={
                    "provider_session_id": provider_session_id,
                    "revision": session.revision + 1,
                    "updated_at": utc_now(),
                }
            )
            self._sessions[binding_id] = stored
            return stored.model_copy(deep=True)

    async def close_session(self, binding_id: str) -> SessionBinding:
        async with self._lock:
            session = self._sessions[binding_id]
            if session.status == "closed":
                return session.model_copy(deep=True)
            stored = session.model_copy(
                update={
                    "status": "closed",
                    "revision": session.revision + 1,
                    "updated_at": utc_now(),
                }
            )
            self._sessions[binding_id] = stored
            return stored.model_copy(deep=True)

    async def create_run(self, run: RunRecord) -> RunRecord:
        async with self._lock:
            if run.run_id in self._runs:
                raise RevisionConflictError(run.run_id)
            self._runs[run.run_id] = run
            return run.model_copy(deep=True)

    async def get_run(self, run_id: str) -> RunRecord | None:
        run = self._runs.get(run_id)
        return run.model_copy(deep=True) if run else None

    async def get_active_run(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> RunRecord | None:
        matches = [
            run
            for run in self._runs.values()
            if run.owner_subject == owner_subject
            and run.agent_id == agent_id
            and run.conversation_id == conversation_id
            and run.status not in {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}
        ]
        latest = max(matches, key=lambda run: run.created_at) if matches else None
        return latest.model_copy(deep=True) if latest else None

    async def update_run_provider_id(self, run_id: str, provider_session_id: str) -> None:
        async with self._lock:
            run = self._runs[run_id]
            self._runs[run_id] = run.model_copy(
                update={"provider_session_id": provider_session_id, "updated_at": utc_now()}
            )

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
    """Mongo-backed repository supporting replay and cross-replica sessions."""

    def __init__(self, uri: str, database: str, retention_seconds: int) -> None:
        self._client = MongoClient(uri, tz_aware=True)
        self._db = self._client[database]
        self._retention_seconds = retention_seconds

    async def initialize(self) -> None:
        def ensure_indexes() -> None:
            self._db.harness_agents.create_index("agent_id", unique=True)
            self._db.harness_agent_versions.create_index(
                [("agent_id", ASCENDING), ("version", ASCENDING)], unique=True
            )
            self._db.harness_provider_resources.create_index("agent_id", unique=True)
            self._db.harness_sessions.create_index("binding_id", unique=True)
            self._db.harness_sessions.create_index(
                [
                    ("owner_subject", ASCENDING),
                    ("agent_id", ASCENDING),
                    ("conversation_id", ASCENDING),
                    ("epoch", ASCENDING),
                ],
                unique=True,
            )
            self._db.harness_runs.create_index("run_id", unique=True)
            self._db.harness_runs.create_index([("owner_subject", ASCENDING), ("created_at", ASCENDING)])
            self._db.harness_events.create_index([("run_id", ASCENDING), ("sequence", ASCENDING)], unique=True)
            self._db.harness_events.create_index("created_at", expireAfterSeconds=self._retention_seconds)

        await asyncio.to_thread(ensure_indexes)

    async def close(self) -> None:
        await asyncio.to_thread(self._client.close)

    async def get_agent(self, agent_id: str) -> AgentRecord | None:
        doc = await asyncio.to_thread(self._db.harness_agents.find_one, {"agent_id": agent_id}, {"_id": 0})
        return AgentRecord.model_validate(doc) if doc else None

    async def get_agent_version(
        self, agent_id: str, version: int | None = None
    ) -> AgentVersion | None:
        if version is None:
            record = await self.get_agent(agent_id)
            version = record.current_version if record else None
        if version is None:
            return None
        doc = await asyncio.to_thread(
            self._db.harness_agent_versions.find_one,
            {"agent_id": agent_id, "version": version},
            {"_id": 0},
        )
        return AgentVersion.model_validate(doc) if doc else None

    async def delete_agent(self, agent_id: str) -> bool:
        def delete() -> bool:
            result = self._db.harness_agents.delete_one({"agent_id": agent_id})
            self._db.harness_agent_versions.delete_many({"agent_id": agent_id})
            self._db.harness_sessions.delete_many({"agent_id": agent_id})
            return result.deleted_count > 0

        return await asyncio.to_thread(delete)

    async def get_provider_resource(self, agent_id: str) -> ProviderResource | None:
        doc = await asyncio.to_thread(
            self._db.harness_provider_resources.find_one,
            {"agent_id": agent_id},
            {"_id": 0},
        )
        return ProviderResource.model_validate(doc) if doc else None

    async def save_provider_resource(self, resource: ProviderResource) -> ProviderResource:
        await asyncio.to_thread(
            self._db.harness_provider_resources.replace_one,
            {"agent_id": resource.agent_id},
            resource.model_dump(mode="python"),
            upsert=True,
        )
        return resource

    async def delete_provider_resource(self, agent_id: str) -> bool:
        result = await asyncio.to_thread(
            self._db.harness_provider_resources.delete_one, {"agent_id": agent_id}
        )
        return result.deleted_count > 0

    async def save_agent(
        self,
        blueprint: AgentBlueprint,
        config_fingerprint: str,
        catalog_revision: str,
        expected_revision: int | None,
    ) -> tuple[AgentRecord, AgentVersion]:
        def write() -> tuple[dict[str, object], dict[str, object]]:
            current_doc = self._db.harness_agents.find_one({"agent_id": blueprint.id})
            current = AgentRecord.model_validate(current_doc) if current_doc else None
            if expected_revision is not None and (
                current is None or current.revision != expected_revision
            ):
                raise RevisionConflictError(blueprint.id)
            now = utc_now()
            number = current.current_version + 1 if current else 1
            version = AgentVersion(
                agent_id=blueprint.id,
                version=number,
                blueprint=blueprint,
                config_fingerprint=config_fingerprint,
                catalog_revision=catalog_revision,
                created_at=now,
            )
            record = AgentRecord(
                agent_id=blueprint.id,
                current_version=number,
                revision=(current.revision + 1) if current else 1,
                enabled=current.enabled if current else True,
                created_at=current.created_at if current else now,
                updated_at=now,
            )
            try:
                self._db.harness_agent_versions.insert_one(version.model_dump(mode="python"))
                self._db.harness_agents.replace_one(
                    {"agent_id": blueprint.id}, record.model_dump(mode="python"), upsert=True
                )
            except DuplicateKeyError as exc:
                raise RevisionConflictError(blueprint.id) from exc
            return record.model_dump(mode="python"), version.model_dump(mode="python")

        record_doc, version_doc = await asyncio.to_thread(write)
        return AgentRecord.model_validate(record_doc), AgentVersion.model_validate(version_doc)

    async def get_session(self, binding_id: str) -> SessionBinding | None:
        doc = await asyncio.to_thread(
            self._db.harness_sessions.find_one, {"binding_id": binding_id}, {"_id": 0}
        )
        return SessionBinding.model_validate(doc) if doc else None

    async def get_latest_session(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> SessionBinding | None:
        doc = await asyncio.to_thread(
            self._db.harness_sessions.find_one,
            {
                "owner_subject": owner_subject,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
            },
            {"_id": 0},
            sort=[("epoch", DESCENDING)],
        )
        return SessionBinding.model_validate(doc) if doc else None

    async def create_session(self, binding: SessionBinding) -> SessionBinding:
        try:
            await asyncio.to_thread(
                self._db.harness_sessions.insert_one, binding.model_dump(mode="python")
            )
            return binding
        except DuplicateKeyError:
            current = await self.get_session(binding.binding_id)
            if current is None:
                raise
            return current

    async def update_session_provider_id(
        self, binding_id: str, provider_session_id: str
    ) -> SessionBinding:
        doc = await asyncio.to_thread(
            self._db.harness_sessions.find_one_and_update,
            {"binding_id": binding_id, "status": "active"},
            {
                "$set": {"provider_session_id": provider_session_id, "updated_at": utc_now()},
                "$inc": {"revision": 1},
            },
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            raise RevisionConflictError(binding_id)
        return SessionBinding.model_validate(doc)

    async def close_session(self, binding_id: str) -> SessionBinding:
        doc = await asyncio.to_thread(
            self._db.harness_sessions.find_one_and_update,
            {"binding_id": binding_id, "status": {"$ne": "closed"}},
            {"$set": {"status": "closed", "updated_at": utc_now()}, "$inc": {"revision": 1}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        if doc:
            return SessionBinding.model_validate(doc)
        current = await self.get_session(binding_id)
        if current is None:
            raise KeyError(binding_id)
        return current

    async def create_run(self, run: RunRecord) -> RunRecord:
        try:
            await asyncio.to_thread(self._db.harness_runs.insert_one, run.model_dump(mode="python"))
        except DuplicateKeyError as exc:
            raise RevisionConflictError(run.run_id) from exc
        return run

    async def get_run(self, run_id: str) -> RunRecord | None:
        doc = await asyncio.to_thread(self._db.harness_runs.find_one, {"run_id": run_id}, {"_id": 0})
        return RunRecord.model_validate(doc) if doc else None

    async def get_active_run(
        self, owner_subject: str, agent_id: str, conversation_id: str
    ) -> RunRecord | None:
        doc = await asyncio.to_thread(
            self._db.harness_runs.find_one,
            {
                "owner_subject": owner_subject,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
                "status": {"$in": [RunStatus.QUEUED.value, RunStatus.RUNNING.value]},
            },
            {"_id": 0},
            sort=[("created_at", DESCENDING)],
        )
        return RunRecord.model_validate(doc) if doc else None

    async def update_run_provider_id(self, run_id: str, provider_session_id: str) -> None:
        await asyncio.to_thread(
            self._db.harness_runs.update_one,
            {"run_id": run_id},
            {"$set": {"provider_session_id": provider_session_id, "updated_at": utc_now()}},
        )

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
