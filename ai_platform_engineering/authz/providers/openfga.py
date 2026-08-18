"""Async OpenFGA relationship and conditional-tuple provider."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Any

import httpx

from ai_platform_engineering.authz.core.context import provider_context
from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest
from ai_platform_engineering.authz.core.registry import relation_for
from ai_platform_engineering.authz.providers.base import ConditionalTuple, ProviderResult


class OpenFgaError(RuntimeError):
    """OpenFGA returned an unavailable or malformed result."""


@dataclass(frozen=True)
class ModelDescriptor:
    store_id: str
    authorization_model_id: str
    model_sha256: str
    provider: str = "openfga-cel"
    template_revision: str = "v1"


def canonical_model_sha256(model: dict[str, Any]) -> str:
    """Hash model semantics after removing OpenFGA response-only defaults."""

    def clean(value: Any) -> Any:
        if isinstance(value, dict):
            normalized: dict[str, Any] = {}
            for key, item in value.items():
                if key == "id":
                    continue
                cleaned = clean(item)
                if cleaned is None or cleaned == "" or cleaned == []:
                    continue
                normalized[key] = cleaned
            return normalized
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value

    encoded = json.dumps(clean(model), sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


class OpenFgaProvider:
    def __init__(
        self,
        *,
        base_url: str,
        store_name: str,
        store_id: str = "",
        authorization_model_id: str = "",
        expected_model_sha256: str = "",
        timeout_seconds: float = 2.0,
        max_concurrency: int = 64,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.store_name = store_name
        self._store_id = store_id
        self.authorization_model_id = authorization_model_id
        self.expected_model_sha256 = expected_model_sha256
        self.timeout_seconds = timeout_seconds
        self._client = client
        self._owns_client = client is None
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._store_lock = asyncio.Lock()

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout_seconds)
        return self._client

    async def close(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def store_id(self) -> str:
        if self._store_id:
            return self._store_id
        async with self._store_lock:
            if self._store_id:
                return self._store_id
            response = await self.client.get(f"{self.base_url}/stores")
            response.raise_for_status()
            stores = response.json().get("stores", [])
            match = next((item for item in stores if item.get("name") == self.store_name), None)
            if not match or not isinstance(match.get("id"), str):
                raise OpenFgaError(f"OpenFGA store {self.store_name!r} was not found")
            self._store_id = match["id"]
            return self._store_id

    async def check(
        self,
        request: CanonicalDecisionRequest,
        *,
        context: dict[str, object] | None = None,
    ) -> ProviderResult:
        store_id = await self.store_id()
        relation = relation_for(request.resource.type, request.action)
        body: dict[str, Any] = {
            "tuple_key": {
                "user": request.subject.openfga_ref,
                "relation": relation,
                "object": request.resource.openfga_ref,
            }
        }
        check_context = context if context is not None else provider_context(request.context)
        if check_context is not None:
            body["context"] = check_context
        if self.authorization_model_id:
            body["authorization_model_id"] = self.authorization_model_id
        async with self._semaphore:
            response = await self.client.post(f"{self.base_url}/stores/{store_id}/check", json=body)
        if response.status_code == 404 and not self.authorization_model_id:
            self._store_id = ""
        if response.status_code >= 500:
            raise OpenFgaError(f"OpenFGA check unavailable: {response.status_code}")
        if not response.is_success:
            raise OpenFgaError(f"OpenFGA check rejected: {response.status_code}")
        payload = response.json()
        if not isinstance(payload.get("allowed"), bool):
            raise OpenFgaError("OpenFGA check returned no boolean decision")
        return ProviderResult(
            allowed=payload["allowed"],
            authorization_model_id=self.authorization_model_id or None,
        )

    async def batch_check(
        self,
        requests: list[CanonicalDecisionRequest],
        *,
        contexts: list[dict[str, object] | None] | None = None,
    ) -> list[ProviderResult]:
        if contexts is not None and len(contexts) != len(requests):
            raise ValueError("contexts must match requests")
        return list(
            await asyncio.gather(
                *(
                    self.check(
                        request,
                        context=contexts[index] if contexts is not None else None,
                    )
                    for index, request in enumerate(requests)
                )
            )
        )

    async def _write(self, key: str, tuples: list[ConditionalTuple]) -> None:
        if not tuples:
            return
        store_id = await self.store_id()
        body: dict[str, Any] = {key: {"tuple_keys": [item.tuple_key() for item in tuples]}}
        if self.authorization_model_id:
            body["authorization_model_id"] = self.authorization_model_id
        response = await self.client.post(f"{self.base_url}/stores/{store_id}/write", json=body)
        if not response.is_success:
            raise OpenFgaError(f"OpenFGA tuple {key} failed: {response.status_code}")

    async def write_tuples(self, tuples: list[ConditionalTuple]) -> None:
        await self._write("writes", tuples)

    async def delete_tuples(self, tuples: list[ConditionalTuple]) -> None:
        await self._write("deletes", tuples)

    async def read_tuples(
        self,
        *,
        user: str | None = None,
        relation: str | None = None,
        object_ref: str | None = None,
        page_size: int = 100,
        continuation_token: str | None = None,
    ) -> tuple[list[ConditionalTuple], str | None]:
        store_id = await self.store_id()
        tuple_key = {
            key: value
            for key, value in {"user": user, "relation": relation, "object": object_ref}.items()
            if value
        }
        body: dict[str, Any] = {"page_size": min(page_size, 100)}
        if tuple_key:
            body["tuple_key"] = tuple_key
        if continuation_token:
            body["continuation_token"] = continuation_token
        response = await self.client.post(f"{self.base_url}/stores/{store_id}/read", json=body)
        if not response.is_success:
            raise OpenFgaError(f"OpenFGA tuple read failed: {response.status_code}")
        payload = response.json()
        tuples = []
        for item in payload.get("tuples", []):
            key = item.get("key", {})
            condition = key.get("condition") or {}
            tuples.append(
                ConditionalTuple(
                    user=key.get("user", ""),
                    relation=key.get("relation", ""),
                    object=key.get("object", ""),
                    condition_name=condition.get("name"),
                    condition_context=condition.get("context"),
                )
            )
        return tuples, payload.get("continuation_token") or None

    async def get_model(self) -> dict[str, Any]:
        store_id = await self.store_id()
        if self.authorization_model_id:
            url = f"{self.base_url}/stores/{store_id}/authorization-models/{self.authorization_model_id}"
        else:
            url = f"{self.base_url}/stores/{store_id}/authorization-models"
        response = await self.client.get(url)
        if not response.is_success:
            raise OpenFgaError(f"OpenFGA model read failed: {response.status_code}")
        payload = response.json()
        if "authorization_models" in payload:
            models = payload["authorization_models"]
            if not models:
                raise OpenFgaError("OpenFGA has no authorization model")
            return models[0]
        return payload.get("authorization_model", payload)

    async def descriptor(self) -> ModelDescriptor:
        model = await self.get_model()
        model_id = self.authorization_model_id or str(model.get("id", ""))
        return ModelDescriptor(
            store_id=await self.store_id(),
            authorization_model_id=model_id,
            model_sha256=canonical_model_sha256(model),
        )

    async def ready(self) -> bool:
        try:
            descriptor = await self.descriptor()
            return not self.expected_model_sha256 or (
                descriptor.model_sha256 == self.expected_model_sha256
            )
        except (httpx.HTTPError, OpenFgaError):
            return False
