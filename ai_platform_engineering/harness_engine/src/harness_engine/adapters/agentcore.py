"""Amazon Bedrock AgentCore Runtime adapter."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from typing import Any, Protocol

import boto3

from harness_engine.config import AgentCoreRuntimeTarget, Settings


class AgentCoreDataClient(Protocol):
    def invoke_agent_runtime(self, **kwargs: Any) -> dict[str, Any]: ...


_END = object()


def _next_or_end(iterator: Iterator[bytes]) -> bytes | object:
    try:
        return next(iterator)
    except StopIteration:
        return _END


class AgentCoreAdapter:
    """Invoke allowlisted AgentCore runtimes without forwarding user credentials."""

    harness_id = "agentcore"

    def __init__(
        self,
        settings: Settings,
        *,
        clients: dict[str, AgentCoreDataClient] | None = None,
    ) -> None:
        self._settings = settings
        self._targets = settings.agentcore_targets()
        self._clients = clients or {}

    @property
    def configured_aliases(self) -> list[str]:
        return sorted(self._targets)

    def _target(self, alias: str) -> AgentCoreRuntimeTarget:
        try:
            return self._targets[alias]
        except KeyError as exc:
            raise ValueError(f'AgentCore runtime alias "{alias}" is not configured') from exc

    def _client(self, target: AgentCoreRuntimeTarget) -> AgentCoreDataClient:
        key = target.region or "default"
        if key not in self._clients:
            self._clients[key] = boto3.client(
                "bedrock-agentcore",
                region_name=target.region,
                endpoint_url=self._settings.agentcore_endpoint_url,
            )
        return self._clients[key]

    async def stream(
        self,
        *,
        runtime_alias: str,
        provider_session_id: str,
        agent_id: str,
        conversation_id: str,
        message: str,
        traceparent: str | None,
    ) -> AsyncIterator[str]:
        target = self._target(runtime_alias)
        request_body = {
            "prompt": message,
            "agent_id": agent_id,
            "conversation_id": conversation_id,
        }
        if traceparent:
            request_body["traceparent"] = traceparent
        payload = json.dumps(
            request_body,
            separators=(",", ":"),
        ).encode()
        response = await asyncio.to_thread(
            self._client(target).invoke_agent_runtime,
            agentRuntimeArn=target.arn,
            runtimeSessionId=provider_session_id,
            qualifier=target.qualifier,
            contentType="application/json",
            accept="text/event-stream, application/json",
            payload=payload,
        )
        content_type = str(response.get("contentType", ""))
        body = response.get("response")
        if body is None:
            raise RuntimeError("AgentCore returned no response stream")

        if "text/event-stream" in content_type and hasattr(body, "iter_lines"):
            iterator = iter(body.iter_lines(chunk_size=64))
            while True:
                raw = await asyncio.to_thread(_next_or_end, iterator)
                if raw is _END:
                    break
                if not raw:
                    continue
                line = bytes(raw).decode("utf-8", errors="replace")
                if line.startswith("data:"):
                    line = line[5:].lstrip()
                if line:
                    yield line
            return

        chunks: list[bytes] = []
        if hasattr(body, "iter_chunks"):
            chunks.extend(chunk for chunk in body.iter_chunks() if chunk)
        elif hasattr(body, "read"):
            chunks.append(await asyncio.to_thread(body.read))
        else:
            chunks.extend(bytes(chunk) for chunk in body)
        decoded = b"".join(chunks).decode("utf-8", errors="replace")
        if not decoded:
            return
        try:
            parsed = json.loads(decoded)
            yield str(parsed.get("result") or parsed.get("response") or decoded)
        except json.JSONDecodeError:
            yield decoded
