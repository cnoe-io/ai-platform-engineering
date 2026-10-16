"""Client for an operator-configured sandbox control plane.

The control plane authenticates the same verified caller independently. Agent
definitions cannot supply URLs, images, commands, environment or credentials.
Only the selected profile and an idempotent conversation reference cross the
provisioning boundary; ACP remains an unmodified JSON-RPC stream.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import NAMESPACE_URL, uuid5

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from websockets.asyncio.client import connect

from dynamic_agents.auth.token_context import current_user_token
from dynamic_agents.config import Settings

MAX_CONTROL_BYTES = 1024 * 1024
MAX_ACP_BYTES = 8 * 1024 * 1024


class SandboxError(RuntimeError):
    """A sanitized failure at the qualified sandbox boundary."""


class SandboxNotFound(SandboxError):
    """The authenticated control plane no longer has this allocation."""


class _BoundConnection(connect):
    def process_redirect(self, exc: Exception) -> Exception:
        # Never forward a user's bearer to a location supplied by a redirect.
        return SandboxError("The sandbox ACP connection cannot be redirected")


class SandboxProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")
    name: str = Field(min_length=1, max_length=200)
    harness: Literal["claude-code", "codex"]
    revision: str = Field(min_length=1, max_length=256)
    capabilities: dict[str, bool] = Field(default_factory=dict)


class SandboxAllocation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,62}$")
    uid: str
    namespace: str
    conversation_id: str
    profile_id: str
    revision: str
    cwd: str
    state: str
    resource_version: str = ""


class SandboxACPTransport:
    """Bounded, non-TTY ACP messages over an authenticated remote stream."""

    def __init__(self, websocket: Any) -> None:
        self.websocket = websocket

    async def send(self, message: dict[str, Any]) -> None:
        payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
        if len(payload.encode()) > MAX_ACP_BYTES:
            raise SandboxError("ACP message exceeds the supported size")
        await self.websocket.send(payload + "\n")

    async def receive(self) -> dict[str, Any] | None:
        # The control plane emits exactly one JSON-RPC line per WS message;
        # terminal escape sequences, stderr and control messages are excluded.
        raw = await self.websocket.recv()
        if not isinstance(raw, str) or len(raw.encode()) > MAX_ACP_BYTES:
            raise SandboxError("Sandbox returned an invalid ACP message")
        try:
            message = json.loads(raw)
        except (json.JSONDecodeError, UnicodeError):
            raise SandboxError("Sandbox returned an invalid ACP message") from None
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            raise SandboxError("Sandbox returned an invalid ACP message")
        return message

    async def close(self) -> None:
        await self.websocket.close()


class SandboxClient:
    def __init__(self, settings: Settings, *, bearer: str | None = None) -> None:
        self.settings = settings
        self.base = settings.sandbox_service_url.rstrip("/")
        parsed = urlsplit(self.base)
        if not self.base or parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
            raise SandboxError("Sandbox execution is not configured")
        self.bearer = bearer or current_user_token.get()
        if not self.bearer:
            raise SandboxError("Sandbox execution requires an authenticated CAIPE caller")

    async def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        try:
            async with httpx.AsyncClient(follow_redirects=False, timeout=30) as client:
                async with client.stream(method, self.base + path, headers={"Authorization": f"Bearer {self.bearer}"}, json=body) as response:
                    if response.status_code in {401, 403}:
                        raise SandboxError("This caller is not authorized to use the sandbox execution profile")
                    if response.status_code == 404:
                        raise SandboxNotFound("The bound sandbox allocation is no longer available")
                    if response.status_code == 409:
                        raise SandboxError("The existing sandbox binding changed; start a new conversation")
                    if response.status_code >= 300:
                        raise SandboxError("The sandbox control plane is unavailable")
                    if response.status_code == 204:
                        return {}
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_CONTROL_BYTES:
                            raise SandboxError("Sandbox control response exceeds the supported size")
                        chunks.append(chunk)
            data = json.loads(b"".join(chunks))
            if not isinstance(data, dict):
                raise ValueError
            return data
        except (httpx.HTTPError, json.JSONDecodeError, ValueError):
            raise SandboxError("The sandbox control plane returned an invalid response") from None

    async def profiles(self) -> list[SandboxProfile]:
        data = await self._request("GET", "/api/caipe/profiles")
        try:
            if not isinstance(data["profiles"], list) or len(data["profiles"]) > 100:
                raise ValueError
            profiles = [SandboxProfile.model_validate(item) for item in data["profiles"]]
            if len({profile.id for profile in profiles}) != len(profiles):
                raise ValueError
            return profiles
        except (KeyError, TypeError, ValueError, ValidationError):
            raise SandboxError("The sandbox profile catalog is invalid") from None

    @staticmethod
    def conversation_reference(agent_id: str, session_id: str) -> str:
        return str(uuid5(NAMESPACE_URL, json.dumps([agent_id, session_id], separators=(",", ":"))))

    async def provision(self, agent_id: str, session_id: str, profile: SandboxProfile) -> SandboxAllocation:
        reference = self.conversation_reference(agent_id, session_id)
        data = await self._request("POST", "/api/caipe/sandboxes", {
            "conversation_id": reference, "profile_id": profile.id, "revision": profile.revision,
        })
        allocation = self._allocation(data, reference, profile)
        return await self._wait_ready(allocation, reference, profile)

    async def lookup(self, agent_id: str, session_id: str, profile: SandboxProfile) -> SandboxAllocation | None:
        """Recover allocation identity after an accepted provisioning request.

        This read never creates an environment and is used only by explicit
        cleanup of a saved provisioning intent.
        """
        reference = self.conversation_reference(agent_id, session_id)
        query = urlencode({"conversation_id": reference, "profile_id": profile.id})
        try:
            data = await self._request("GET", f"/api/caipe/sandboxes?{query}")
        except SandboxNotFound:
            return None
        return self._allocation(data, reference, profile)

    async def restore(self, saved: SandboxAllocation, profile: SandboxProfile) -> SandboxAllocation:
        data = await self._request("GET", f"/api/caipe/sandboxes/{quote(saved.id, safe='')}")
        current = self._allocation(data, saved.conversation_id, profile)
        if (current.id, current.uid, current.namespace, current.cwd) != (saved.id, saved.uid, saved.namespace, saved.cwd):
            raise SandboxError("The bound sandbox no longer exists; recovery requires an explicit migration")
        if current.state.lower() == "suspended":
            data = await self._request("POST", f"/api/caipe/sandboxes/{quote(saved.id, safe='')}/resume", {
                "conversation_id": saved.conversation_id, "uid": saved.uid, "resource_version": current.resource_version,
            })
            current = self._allocation(data, saved.conversation_id, profile)
        return await self._wait_ready(current, saved.conversation_id, profile, expected=saved)

    async def _wait_ready(self, allocation: SandboxAllocation, reference: str, profile: SandboxProfile,
                          *, expected: SandboxAllocation | None = None) -> SandboxAllocation:
        expected = expected or allocation

        def check_identity(value: SandboxAllocation) -> None:
            if (value.id, value.uid, value.namespace, value.cwd) != (expected.id, expected.uid, expected.namespace, expected.cwd):
                raise SandboxError("The sandbox identity changed; recovery requires an explicit migration")

        check_identity(allocation)
        deadline = asyncio.get_running_loop().time() + self.settings.sandbox_provision_timeout_seconds
        while allocation.state.lower() not in {"ready", "running"}:
            if allocation.state.lower() in {"error", "failed", "disabled"}:
                raise SandboxError("The sandbox cannot start; check its approved execution profile")
            if asyncio.get_running_loop().time() >= deadline:
                raise SandboxError("Sandbox provisioning is still pending; retry this conversation after it becomes ready")
            await asyncio.sleep(2)
            data = await self._request("GET", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}")
            refreshed = self._allocation(data, reference, profile)
            check_identity(refreshed)
            allocation = refreshed
        return allocation

    async def prepare(self, allocation: SandboxAllocation, files: dict[str, str]) -> None:
        await self._request("PUT", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}/workspace", {
            "conversation_id": allocation.conversation_id, "uid": allocation.uid, "files": files,
        })

    async def workspace_files(self, allocation: SandboxAllocation) -> dict:
        query = urlencode({"conversation_id": allocation.conversation_id, "uid": allocation.uid})
        return await self._request("GET", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}/workspace/files?{query}")

    async def workspace_content(self, allocation: SandboxAllocation, path: str) -> dict:
        query = urlencode({"conversation_id": allocation.conversation_id, "uid": allocation.uid, "path": path})
        return await self._request("GET", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}/workspace/content?{query}")

    async def write_workspace_content(self, allocation: SandboxAllocation, path: str, content: str) -> None:
        await self._request("PUT", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}/workspace/content", {
            "conversation_id": allocation.conversation_id, "uid": allocation.uid, "path": path, "content": content,
        })

    async def delete(self, allocation: SandboxAllocation, profile: SandboxProfile) -> None:
        try:
            data = await self._request("GET", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}")
        except SandboxNotFound:
            return  # An explicit deletion can be retried after storage failure.
        current = self._allocation(data, allocation.conversation_id, profile)
        if ((current.id, current.uid, current.namespace, current.cwd) !=
                (allocation.id, allocation.uid, allocation.namespace, allocation.cwd) or not current.resource_version):
            raise SandboxError("The sandbox identity changed; deletion requires operator recovery")
        try:
            await self._request("DELETE", f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}", {
                "conversation_id": allocation.conversation_id, "uid": allocation.uid, "resource_version": current.resource_version,
            })
        except SandboxNotFound:
            pass  # A concurrent authorized deletion already removed it.

    @staticmethod
    def _allocation(data: dict, reference: str, profile: SandboxProfile) -> SandboxAllocation:
        try:
            value = SandboxAllocation.model_validate(data)
        except ValidationError:
            raise SandboxError("The sandbox allocation is invalid") from None
        if (value.conversation_id, value.profile_id, value.revision) != (reference, profile.id, profile.revision):
            raise SandboxError("The sandbox profile or conversation binding changed")
        if not value.cwd.startswith("/") or "\x00" in value.cwd or ".." in value.cwd.split("/"):
            raise SandboxError("The sandbox workspace is invalid")
        return value

    @asynccontextmanager
    async def acp(self, allocation: SandboxAllocation) -> AsyncIterator[SandboxACPTransport]:
        parsed = urlsplit(self.base)
        path = parsed.path + f"/api/caipe/sandboxes/{quote(allocation.id, safe='')}/acp"
        query = urlencode({"conversation_id": allocation.conversation_id, "uid": allocation.uid})
        url = urlunsplit(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, path, query, ""))
        try:
            async with _BoundConnection(url, additional_headers={"Authorization": f"Bearer {self.bearer}"},
                               max_size=MAX_ACP_BYTES, max_queue=32, open_timeout=30, close_timeout=10) as websocket:
                yield SandboxACPTransport(websocket)
        except (OSError, TimeoutError) as exc:
            raise SandboxError("The sandbox ACP connection was interrupted; saved progress is retained") from exc
