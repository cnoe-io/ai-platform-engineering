"""Bounded durable SQLite audit outbox."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

from ai_platform_engineering.authz.audit.events import AuthzAuditEvent


class AuditOutboxFull(RuntimeError):
    """The durable audit journal has reached its configured capacity."""


class AuditOutbox:
    def __init__(self, path: str, *, capacity: int = 10000) -> None:
        self.path = Path(path)
        self.capacity = capacity
        self._lock = threading.Lock()

    def initialize_sync(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS authz_audit_outbox (
                    event_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            connection.commit()

    async def initialize(self) -> None:
        await asyncio.to_thread(self.initialize_sync)

    def append_sync(self, event: AuthzAuditEvent) -> None:
        self.append_many_sync([event])

    def append_many_sync(self, events: list[AuthzAuditEvent]) -> None:
        if not events:
            return
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            event_ids = list(dict.fromkeys(event.event_id for event in events))
            placeholders = ",".join("?" for _ in event_ids)
            existing = {
                row[0]
                for row in connection.execute(
                    f"SELECT event_id FROM authz_audit_outbox WHERE event_id IN ({placeholders})",  # noqa: S608
                    event_ids,
                ).fetchall()
            }
            pending = [event for event in events if event.event_id not in existing]
            pending = list({event.event_id: event for event in pending}.values())
            count = connection.execute("SELECT COUNT(*) FROM authz_audit_outbox").fetchone()[0]
            if count + len(pending) > self.capacity:
                raise AuditOutboxFull("authorization audit outbox is full")
            connection.executemany(
                "INSERT OR IGNORE INTO authz_audit_outbox(event_id, payload, created_at) VALUES (?, ?, ?)",
                [
                    (event.event_id, event.model_dump_json(), event.occurred_at.isoformat())
                    for event in pending
                ],
            )
            connection.commit()

    async def append(self, event: AuthzAuditEvent) -> None:
        await asyncio.to_thread(self.append_sync, event)

    async def append_many(self, events: list[AuthzAuditEvent]) -> None:
        await asyncio.to_thread(self.append_many_sync, events)

    def batch_sync(self, limit: int) -> list[AuthzAuditEvent]:
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            rows = connection.execute(
                "SELECT payload FROM authz_audit_outbox ORDER BY created_at LIMIT ?",
                (limit,),
            ).fetchall()
        return [AuthzAuditEvent.model_validate_json(row[0]) for row in rows]

    async def batch(self, limit: int) -> list[AuthzAuditEvent]:
        return await asyncio.to_thread(self.batch_sync, limit)

    def acknowledge_sync(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        placeholders = ",".join("?" for _ in event_ids)
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            connection.execute(
                f"DELETE FROM authz_audit_outbox WHERE event_id IN ({placeholders})",  # noqa: S608
                event_ids,
            )
            connection.commit()

    async def acknowledge(self, event_ids: list[str]) -> None:
        await asyncio.to_thread(self.acknowledge_sync, event_ids)

    def mark_attempt_sync(self, event_ids: list[str]) -> None:
        if not event_ids:
            return
        placeholders = ",".join("?" for _ in event_ids)
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            connection.execute(
                f"UPDATE authz_audit_outbox SET attempts = attempts + 1 WHERE event_id IN ({placeholders})",  # noqa: S608
                event_ids,
            )
            connection.commit()

    async def mark_attempt(self, event_ids: list[str]) -> None:
        await asyncio.to_thread(self.mark_attempt_sync, event_ids)

    def size_sync(self) -> int:
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            return int(connection.execute("SELECT COUNT(*) FROM authz_audit_outbox").fetchone()[0])

    async def size(self) -> int:
        return await asyncio.to_thread(self.size_sync)

    def snapshot_sync(self) -> list[dict[str, object]]:
        with self._lock, closing(sqlite3.connect(self.path)) as connection:
            rows = connection.execute(
                "SELECT event_id, payload, created_at, attempts FROM authz_audit_outbox ORDER BY created_at"
            ).fetchall()
        return [
            {
                "event_id": event_id,
                "payload": json.loads(payload),
                "created_at": created_at,
                "attempts": attempts,
            }
            for event_id, payload, created_at, attempts in rows
        ]
