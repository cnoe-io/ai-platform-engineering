"""MongoDB and in-memory policy metadata repositories."""

from __future__ import annotations

import asyncio
from typing import Protocol

from pymongo import ASCENDING, MongoClient, ReturnDocument
from pymongo.collection import Collection
from pymongo.errors import DuplicateKeyError

from ai_platform_engineering.authz.policy.models import ExpressionPolicy, SanitizedSchema


class PolicyConflict(RuntimeError):
    """Optimistic policy version did not match."""


class PolicyRepository(Protocol):
    async def get(self, policy_id: str) -> ExpressionPolicy | None: ...

    async def list(
        self,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ExpressionPolicy]: ...

    async def put(
        self,
        policy: ExpressionPolicy,
        *,
        expected_version: int | None,
    ) -> ExpressionPolicy: ...

    async def delete(self, policy_id: str, *, expected_version: int) -> ExpressionPolicy | None: ...

    async def get_schema(self, resource_type: str, resource_id: str) -> SanitizedSchema | None: ...

    async def put_schema(self, schema: SanitizedSchema) -> SanitizedSchema: ...


class InMemoryPolicyRepository:
    def __init__(self) -> None:
        self.policies: dict[str, ExpressionPolicy] = {}
        self.schemas: dict[tuple[str, str], SanitizedSchema] = {}
        self._lock = asyncio.Lock()

    async def get(self, policy_id: str) -> ExpressionPolicy | None:
        return self.policies.get(policy_id)

    async def list(
        self,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ExpressionPolicy]:
        return [
            item
            for item in self.policies.values()
            if (resource_type is None or item.resource_type == resource_type)
            and (resource_id is None or item.resource_id == resource_id)
        ]

    async def put(
        self,
        policy: ExpressionPolicy,
        *,
        expected_version: int | None,
    ) -> ExpressionPolicy:
        async with self._lock:
            current = self.policies.get(policy.policy_id)
            if current is None and expected_version not in {None, 0}:
                raise PolicyConflict("policy does not exist")
            if current is not None and expected_version != current.version:
                raise PolicyConflict("policy version mismatch")
            self.policies[policy.policy_id] = policy
            return policy

    async def delete(self, policy_id: str, *, expected_version: int) -> ExpressionPolicy | None:
        async with self._lock:
            current = self.policies.get(policy_id)
            if current is None:
                return None
            if current.version != expected_version:
                raise PolicyConflict("policy version mismatch")
            return self.policies.pop(policy_id)

    async def get_schema(self, resource_type: str, resource_id: str) -> SanitizedSchema | None:
        return self.schemas.get((resource_type, resource_id))

    async def put_schema(self, schema: SanitizedSchema) -> SanitizedSchema:
        self.schemas[(schema.resource_type, schema.resource_id)] = schema
        return schema


class MongoPolicyRepository:
    def __init__(self, url: str, database: str) -> None:
        self.client = MongoClient(url, serverSelectionTimeoutMS=3000)
        db = self.client[database]
        self.policies: Collection = db["authz_expression_policies"]
        self.schemas: Collection = db["authz_resource_schemas"]

    async def initialize(self) -> None:
        await asyncio.to_thread(self.policies.create_index, [("policy_id", ASCENDING)], unique=True)
        await asyncio.to_thread(
            self.policies.create_index,
            [("resource_type", ASCENDING), ("resource_id", ASCENDING)],
        )
        await asyncio.to_thread(
            self.schemas.create_index,
            [("resource_type", ASCENDING), ("resource_id", ASCENDING)],
            unique=True,
        )

    async def get(self, policy_id: str) -> ExpressionPolicy | None:
        value = await asyncio.to_thread(self.policies.find_one, {"policy_id": policy_id})
        return ExpressionPolicy.model_validate(value) if value else None

    async def list(
        self,
        *,
        resource_type: str | None = None,
        resource_id: str | None = None,
    ) -> list[ExpressionPolicy]:
        query = {
            key: value
            for key, value in {"resource_type": resource_type, "resource_id": resource_id}.items()
            if value is not None
        }

        def read() -> list[dict]:
            return list(self.policies.find(query).sort("updated_at", -1).limit(500))

        values = await asyncio.to_thread(read)
        return [ExpressionPolicy.model_validate(value) for value in values]

    async def put(
        self,
        policy: ExpressionPolicy,
        *,
        expected_version: int | None,
    ) -> ExpressionPolicy:
        document = policy.model_dump(mode="python")
        if expected_version in {None, 0}:
            try:
                await asyncio.to_thread(self.policies.insert_one, document)
            except DuplicateKeyError as exc:
                raise PolicyConflict("policy already exists") from exc
            return policy
        value = await asyncio.to_thread(
            self.policies.find_one_and_replace,
            {"policy_id": policy.policy_id, "version": expected_version},
            document,
            return_document=ReturnDocument.AFTER,
        )
        if value is None:
            raise PolicyConflict("policy version mismatch")
        return ExpressionPolicy.model_validate(value)

    async def delete(self, policy_id: str, *, expected_version: int) -> ExpressionPolicy | None:
        value = await asyncio.to_thread(
            self.policies.find_one_and_delete,
            {"policy_id": policy_id, "version": expected_version},
        )
        return ExpressionPolicy.model_validate(value) if value else None

    async def get_schema(self, resource_type: str, resource_id: str) -> SanitizedSchema | None:
        value = await asyncio.to_thread(
            self.schemas.find_one,
            {"resource_type": resource_type, "resource_id": resource_id},
        )
        return SanitizedSchema.model_validate(value) if value else None

    async def put_schema(self, schema: SanitizedSchema) -> SanitizedSchema:
        await asyncio.to_thread(
            self.schemas.replace_one,
            {"resource_type": schema.resource_type, "resource_id": schema.resource_id},
            schema.model_dump(mode="python"),
            upsert=True,
        )
        return schema
