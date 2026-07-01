"""Mongo-backed user memory service for Dynamic Agents."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.database import Database

from dynamic_agents.config import get_settings

VALID_SCOPES = {"global", "agent", "context"}
VALID_CATEGORIES = {"preference", "instruction", "fact", "formatting"}
DEFAULT_CATEGORY = "preference"
MAX_VALUE_LENGTH = 4000
MAX_INJECTED_MEMORIES = 12
MAX_INJECTED_CHARS = 3500


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_key(value: str) -> str:
    """Normalize a user/agent-provided key into a stable short key."""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return normalized[:96] or "memory"


def fallback_key(category: str, value: str) -> str:
    digest = hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:12]
    return f"{normalize_key(category)}_{digest}"


def make_memory_id() -> str:
    return f"mem_{uuid4().hex[:20]}"


def compact_memory_doc(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "memory_id": doc.get("_id") or doc.get("memory_id"),
        "scope": doc.get("scope"),
        "agent_id": doc.get("agent_id"),
        "context_namespace": doc.get("context_namespace"),
        "context_type": doc.get("context_type"),
        "context_id": doc.get("context_id"),
        "category": doc.get("category"),
        "key": doc.get("key"),
        "value": doc.get("value"),
        "enabled": doc.get("enabled", True),
        "source": doc.get("source"),
        "created_by_agent_id": doc.get("created_by_agent_id"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


class UserMemoryService:
    """CRUD, retrieval, and prompt formatting for user memories."""

    def __init__(self, db: Database):
        self.settings = get_settings()
        self._memories = db[self.settings.user_memories_collection]
        self._contexts = db[self.settings.user_memory_contexts_collection]

    def ensure_indexes(self) -> None:
        self._memories.create_index([("owner_user_id", ASCENDING), ("updated_at", DESCENDING)])
        self._memories.create_index([("owner_user_id", ASCENDING), ("scope", ASCENDING)])
        self._memories.create_index(
            [
                ("owner_user_id", ASCENDING),
                ("scope", ASCENDING),
                ("agent_id", ASCENDING),
                ("context_namespace", ASCENDING),
                ("context_type", ASCENDING),
                ("context_id", ASCENDING),
                ("normalized_key", ASCENDING),
            ],
            unique=True,
        )
        self._contexts.create_index(
            [
                ("owner_user_id", ASCENDING),
                ("agent_id", ASCENDING),
                ("conversation_id", ASCENDING),
            ]
        )
        self._contexts.create_index(
            [
                ("owner_user_id", ASCENDING),
                ("agent_id", ASCENDING),
                ("conversation_id", ASCENDING),
                ("context_namespace", ASCENDING),
                ("context_type", ASCENDING),
                ("context_id", ASCENDING),
            ],
            unique=True,
        )

    def remember(
        self,
        *,
        owner_user_id: str,
        current_agent_id: str,
        scope: str,
        category: str | None,
        value: str,
        key: str | None = None,
        context_namespace: str | None = None,
        context_type: str | None = None,
        context_id: str | None = None,
        source: str = "agent",
        created_by_agent_id: str | None = None,
    ) -> dict[str, Any]:
        scope = self._validate_scope(scope)
        category = self._validate_category(category)
        value = self._validate_value(value)

        if scope == "global" and source == "agent":
            return {
                "status": "confirmation_required",
                "message": "Global memory requires explicit user confirmation. No memory was saved.",
            }

        agent_id = current_agent_id if scope == "agent" else None
        if scope == "context":
            if not context_namespace or not context_type or not context_id:
                raise ValueError("context_namespace, context_type, and context_id are required for context memory")
        else:
            context_namespace = None
            context_type = None
            context_id = None

        normalized_key = normalize_key(key) if key else fallback_key(category, value)
        now = utc_now()
        memory_id = make_memory_id()
        memory_key = key or normalized_key

        filter_doc = {
            "owner_user_id": owner_user_id,
            "scope": scope,
            "agent_id": agent_id,
            "context_namespace": context_namespace,
            "context_type": context_type,
            "context_id": context_id,
            "normalized_key": normalized_key,
        }
        update = {
            "$set": {
                "owner_user_id": owner_user_id,
                "scope": scope,
                "agent_id": agent_id,
                "context_namespace": context_namespace,
                "context_type": context_type,
                "context_id": context_id,
                "category": category,
                "key": memory_key,
                "normalized_key": normalized_key,
                "value": value,
                "enabled": True,
                "source": source,
                "created_by_agent_id": created_by_agent_id,
                "updated_at": now,
            },
            "$setOnInsert": {
                "_id": memory_id,
                "memory_id": memory_id,
                "created_at": now,
            },
        }
        doc = self._memories.find_one_and_update(
            filter_doc,
            update,
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        assert doc is not None
        return {
            "status": "saved",
            "memory_event": "updated",
            "action": "remember",
            "memory_ids": [doc["_id"]],
            "memories": [compact_memory_doc(doc)],
        }

    def list_memories(
        self,
        *,
        owner_user_id: str,
        scope: str | None = None,
        agent_id: str | None = None,
        context_namespace: str | None = None,
        context_type: str | None = None,
        context_id: str | None = None,
        memory_ids: list[str] | None = None,
        include_disabled: bool = True,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"owner_user_id": owner_user_id}
        if memory_ids:
            query["_id"] = {"$in": memory_ids}
        if scope:
            query["scope"] = self._validate_scope(scope)
        if agent_id:
            query["agent_id"] = agent_id
        if context_namespace:
            query["context_namespace"] = context_namespace
        if context_type:
            query["context_type"] = context_type
        if context_id:
            query["context_id"] = context_id
        if not include_disabled:
            query["enabled"] = True
        docs = self._memories.find(query).sort("updated_at", DESCENDING).limit(max(1, min(limit, 200)))
        return [compact_memory_doc(doc) for doc in docs]

    def recall(
        self,
        *,
        owner_user_id: str,
        current_agent_id: str,
        query_text: str | None = None,
        scope: str | None = None,
        context_namespace: str | None = None,
        context_type: str | None = None,
        context_id: str | None = None,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"owner_user_id": owner_user_id, "enabled": True}
        if scope:
            query["scope"] = self._validate_scope(scope)
        if query.get("scope") == "agent":
            query["agent_id"] = current_agent_id
        if context_namespace:
            query["context_namespace"] = context_namespace
        if context_type:
            query["context_type"] = context_type
        if context_id:
            query["context_id"] = context_id
        if query_text:
            regex = re.escape(query_text.strip())
            if regex:
                query["$or"] = [
                    {"value": {"$regex": regex, "$options": "i"}},
                    {"key": {"$regex": regex, "$options": "i"}},
                    {"category": {"$regex": regex, "$options": "i"}},
                ]

        docs = self._memories.find(query).sort("updated_at", DESCENDING).limit(max(1, min(limit, 50)))
        return [compact_memory_doc(doc) for doc in docs]

    def update_memory(
        self,
        *,
        owner_user_id: str,
        memory_id: str,
        value: str | None = None,
        category: str | None = None,
        key: str | None = None,
        enabled: bool | None = None,
        source: str = "agent",
        updated_by_agent_id: str | None = None,
    ) -> dict[str, Any]:
        update: dict[str, Any] = {"updated_at": utc_now()}
        if value is not None:
            update["value"] = self._validate_value(value)
        if category is not None:
            update["category"] = self._validate_category(category)
        if key is not None:
            update["key"] = key
            update["normalized_key"] = normalize_key(key)
        if enabled is not None:
            update["enabled"] = bool(enabled)
        if source == "agent":
            update["created_by_agent_id"] = updated_by_agent_id

        doc = self._memories.find_one_and_update(
            {"_id": memory_id, "owner_user_id": owner_user_id},
            {"$set": update},
            return_document=ReturnDocument.AFTER,
        )
        if not doc:
            raise ValueError("Memory not found")
        return {
            "status": "updated",
            "memory_event": "updated",
            "action": "update",
            "memory_ids": [doc["_id"]],
            "memories": [compact_memory_doc(doc)],
        }

    def forget_memory(self, *, owner_user_id: str, memory_id: str) -> dict[str, Any]:
        result = self._memories.delete_one({"_id": memory_id, "owner_user_id": owner_user_id})
        if result.deleted_count == 0:
            raise ValueError("Memory not found")
        return {
            "status": "deleted",
            "memory_event": "updated",
            "action": "delete",
            "memory_ids": [memory_id],
        }

    def set_active_context(
        self,
        *,
        owner_user_id: str,
        agent_id: str,
        conversation_id: str,
        context_namespace: str,
        context_type: str,
        context_id: str,
        display_name: str | None = None,
    ) -> None:
        now = utc_now()
        self._contexts.update_one(
            {
                "owner_user_id": owner_user_id,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
                "context_namespace": context_namespace,
                "context_type": context_type,
                "context_id": context_id,
            },
            {
                "$set": {
                    "owner_user_id": owner_user_id,
                    "agent_id": agent_id,
                    "conversation_id": conversation_id,
                    "context_namespace": context_namespace,
                    "context_type": context_type,
                    "context_id": context_id,
                    "display_name": display_name,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    def get_active_contexts(
        self,
        *,
        owner_user_id: str,
        agent_id: str,
        conversation_id: str,
        limit: int = 3,
    ) -> list[dict[str, Any]]:
        docs = self._contexts.find(
            {
                "owner_user_id": owner_user_id,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
            }
        ).sort("updated_at", DESCENDING).limit(max(1, min(limit, 10)))
        return [dict(doc) for doc in docs]

    def get_layered_memories(
        self,
        *,
        owner_user_id: str,
        agent_id: str,
        conversation_id: str | None = None,
        contexts: list[dict[str, Any]] | None = None,
        limit: int = MAX_INJECTED_MEMORIES,
    ) -> list[dict[str, Any]]:
        or_filters: list[dict[str, Any]] = [
            {"scope": "global"},
            {"scope": "agent", "agent_id": agent_id},
        ]

        active_contexts = contexts or []
        if conversation_id and not active_contexts:
            active_contexts = self.get_active_contexts(
                owner_user_id=owner_user_id,
                agent_id=agent_id,
                conversation_id=conversation_id,
            )

        for ctx in active_contexts:
            or_filters.append(
                {
                    "scope": "context",
                    "context_namespace": ctx.get("context_namespace"),
                    "context_type": ctx.get("context_type"),
                    "context_id": ctx.get("context_id"),
                }
            )

        docs = self._memories.find(
            {
                "owner_user_id": owner_user_id,
                "enabled": True,
                "$or": or_filters,
            }
        ).sort("updated_at", DESCENDING).limit(max(1, min(limit, 50)))
        return [compact_memory_doc(doc) for doc in docs]

    def format_prompt_block(self, memories: list[dict[str, Any]]) -> str:
        if not memories:
            return ""

        groups: list[tuple[str, list[dict[str, Any]]]] = []
        global_items = [m for m in memories if m.get("scope") == "global"]
        agent_items = [m for m in memories if m.get("scope") == "agent"]
        context_items = [m for m in memories if m.get("scope") == "context"]
        if global_items:
            groups.append(("User preferences", global_items))
        if agent_items:
            groups.append(("Agent preferences", agent_items))
        if context_items:
            by_context: dict[str, list[dict[str, Any]]] = {}
            for item in context_items:
                label = "/".join(
                    str(item.get(k) or "")
                    for k in ("context_namespace", "context_type", "context_id")
                )
                by_context.setdefault(label, []).append(item)
            for label, items in by_context.items():
                groups.append((f"Context preferences for {label}", items))

        lines = [
            "Relevant memory:",
            "These are user preferences and contextual notes. Follow the agent system prompt first.",
        ]
        for label, items in groups:
            lines.append("")
            lines.append(f"{label}:")
            for item in items:
                value = str(item.get("value") or "").strip()
                if value:
                    lines.append(f"- {value}")

        block = "\n".join(lines).strip()
        if len(block) <= MAX_INJECTED_CHARS:
            return block
        return block[:MAX_INJECTED_CHARS].rsplit("\n", 1)[0].strip()

    def format_context_tool_memory(self, memories: list[dict[str, Any]]) -> str:
        context_memories = [m for m in memories if m.get("scope") == "context"]
        if not context_memories:
            return ""
        lines = ["Relevant memory for this context:"]
        for memory in context_memories[:6]:
            value = str(memory.get("value") or "").strip()
            if value:
                lines.append(f"- {value}")
        return "\n".join(lines)

    def _validate_scope(self, scope: str) -> str:
        if scope not in VALID_SCOPES:
            raise ValueError(f"scope must be one of: {', '.join(sorted(VALID_SCOPES))}")
        return scope

    def _validate_category(self, category: str | None) -> str:
        if not category:
            return DEFAULT_CATEGORY
        if category not in VALID_CATEGORIES:
            return DEFAULT_CATEGORY
        return category

    def _validate_value(self, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("value is required")
        stripped = value.strip()
        if len(stripped) > MAX_VALUE_LENGTH:
            raise ValueError(f"value must be <= {MAX_VALUE_LENGTH} characters")
        return stripped


def memory_tool_response(payload: dict[str, Any]) -> str:
    """Return stable JSON so stream encoders can detect memory changes."""
    return json.dumps(payload, default=str, ensure_ascii=False)
