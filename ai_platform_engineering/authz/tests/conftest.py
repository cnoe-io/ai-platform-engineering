from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.providers.base import ConditionalTuple, ProviderResult
from ai_platform_engineering.authz.providers.openfga import ModelDescriptor


class FakeProvider:
    def __init__(self, *, default_allowed: bool = True) -> None:
        self.default_allowed = default_allowed
        self.results: dict[tuple[str, str, str], bool | None] = {}
        self.tuples: list[ConditionalTuple] = []
        self.contexts: list[dict[str, object] | None] = []
        self.closed = False

    async def check(self, request, *, context=None) -> ProviderResult:
        self.contexts.append(context)
        key = (request.subject.openfga_ref, request.action, request.resource.openfga_ref)
        return ProviderResult(
            allowed=self.results.get(key, self.default_allowed),
            authorization_model_id="model-example",
        )

    async def batch_check(self, requests, *, contexts=None):
        return [
            await self.check(
                request,
                context=contexts[index] if contexts is not None else None,
            )
            for index, request in enumerate(requests)
        ]

    async def read_tuples(
        self,
        *,
        user=None,
        relation=None,
        object_ref=None,
        page_size=100,
        continuation_token=None,
    ):
        values = [
            item
            for item in self.tuples
            if (user is None or item.user == user)
            and (relation is None or item.relation == relation)
            and (object_ref is None or item.object == object_ref)
        ]
        return values[:page_size], None

    async def write_tuples(self, tuples: list[ConditionalTuple]) -> None:
        self.tuples.extend(item for item in tuples if item not in self.tuples)

    async def delete_tuples(self, tuples: list[ConditionalTuple]) -> None:
        self.tuples = [item for item in self.tuples if item not in tuples]

    async def get_model(self) -> dict[str, Any]:
        return {"id": "model-example", "schema_version": "1.1", "type_definitions": []}

    async def descriptor(self) -> ModelDescriptor:
        return ModelDescriptor(
            store_id="store-example",
            authorization_model_id="model-example",
            model_sha256="sha256:" + "a" * 64,
        )

    async def ready(self) -> bool:
        return True

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def fake_provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        grpc_bind="127.0.0.1:0",
        allow_insecure_headers=True,
        admin_token="admin-example-token",
        audit_service_url="",
        audit_outbox_path=str(tmp_path / "audit.db"),
        mongo_url="mongodb://example.invalid:27017",
        rollout_json=(
            '{"revision":"test-revision","default_mode":"LEGACY",'
            '"canary_seed":"test-canary-seed-value","scopes":[]}'
        ),
    )
