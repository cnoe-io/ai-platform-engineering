"""Mongo connection + schedule-doc CRUD."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pymongo import MongoClient
from pymongo.collection import Collection

from caipe_scheduler.config import Settings


class ScheduleStore:
    def __init__(self, settings: Settings):
        self._client: MongoClient[dict[str, Any]] = MongoClient(settings.mongodb_uri)
        self._db = self._client[settings.mongodb_database]
        self._col: Collection[dict[str, Any]] = self._db[settings.schedules_collection]
        self._dynamic_agents = self._db["dynamic_agents"]
        # schedule_id is the public unique handle; ensure it.
        self._col.create_index("schedule_id", unique=True)
        self._col.create_index("owner_user_id")
        self._col.create_index("pod_id")
        self._col.create_index("agent_id")

    # ── lookups ─────────────────────────────────────────────────────────
    def agent_exists(self, agent_id: str) -> bool:
        return self._dynamic_agents.count_documents({"_id": agent_id}, limit=1) > 0

    def count_for_owner(self, owner_user_id: str) -> int:
        return self._col.count_documents({"owner_user_id": owner_user_id})

    def get(self, schedule_id: str) -> dict[str, Any] | None:
        return self._col.find_one({"schedule_id": schedule_id})

    def list(
        self,
        *,
        owner_user_id: str | None = None,
        pod_id: str | None = None,
        agent_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {}
        if owner_user_id:
            query["owner_user_id"] = owner_user_id
        if pod_id:
            query["pod_id"] = pod_id
        if agent_id:
            query["agent_id"] = agent_id
        return list(self._col.find(query).sort("created_at", -1))

    # ── writes ──────────────────────────────────────────────────────────
    def insert(self, doc: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)
        doc.setdefault("created_at", now)
        doc.setdefault("updated_at", now)
        doc.setdefault("version", 1)
        doc.setdefault("versions", [])
        self._col.insert_one(doc)

    def patch(self, schedule_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        if not patch:
            return self.get(schedule_id)

        existing = self.get(schedule_id)
        if not existing:
            return None

        now = datetime.now(timezone.utc)
        versioned_fields = {
            "agent_id",
            "title",
            "message_template",
            "pod_id",
            "attributes",
            "cron",
            "tz",
            "enabled",
            "cronjob_name",
        }
        changed_fields = sorted(
            key
            for key, value in patch.items()
            if key in versioned_fields and existing.get(key) != value
        )
        patch["updated_at"] = now

        update: dict[str, Any] = {"$set": patch}
        if changed_fields:
            previous_version = {
                "version": int(existing.get("version") or 1),
                "superseded_at": now,
                "changed_fields": changed_fields,
                "title": existing.get("title"),
                "agent_id": existing.get("agent_id"),
                "message_template": existing.get("message_template"),
                "pod_id": existing.get("pod_id"),
                "attributes": existing.get("attributes") or {},
                "cron": existing.get("cron"),
                "tz": existing.get("tz"),
                "enabled": existing.get("enabled", True),
                "cronjob_name": existing.get("cronjob_name"),
                "created_at": existing.get("created_at"),
                "updated_at": existing.get("updated_at"),
            }
            update["$set"]["version"] = int(existing.get("version") or 1) + 1
            update["$push"] = {
                "versions": {
                    "$each": [previous_version],
                    "$slice": -50,
                }
            }

        return self._col.find_one_and_update(
            {"schedule_id": schedule_id},
            update,
            return_document=True,
        )

    def set_cronjob_name(self, schedule_id: str, cronjob_name: str) -> None:
        self._col.update_one(
            {"schedule_id": schedule_id},
            {"$set": {"cronjob_name": cronjob_name, "updated_at": datetime.now(timezone.utc)}},
        )

    def record_run(
        self,
        schedule_id: str,
        *,
        status: str,
        error: str | None = None,
        http_status: int | None = None,
    ) -> None:
        self._col.update_one(
            {"schedule_id": schedule_id},
            {
                "$set": {
                    "last_run": {
                        "ts": datetime.now(timezone.utc),
                        "status": status,
                        "error": error,
                        "http_status": http_status,
                    },
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    def delete(self, schedule_id: str) -> int:
        return self._col.delete_one({"schedule_id": schedule_id}).deleted_count
