"""Backend callback client.

The agent's persist hook and ingest log appender call back to
`ttt-backend/internal/...` instead of writing sqlite directly. This
module is the single httpx-based wrapper they go through.

All callbacks include the per-agent bearer token (`TTT_AGENT_TOKEN` env)
on the `Authorization` header. The backend's auth dependency validates
it against the orchestrator's in-memory map.

Synchronous fallbacks exist because the SDK's PostToolUse hooks run in
sync context inside the SDK loop — async-only would deadlock. We use
short timeouts and best-effort fire-and-forget for log appends; page
writes block so the agent doesn't run ahead of the backend's revision
log.
"""

from __future__ import annotations

import contextvars
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

import httpx

from tome_agent.orchestrator.contract import (
    AppendLogRequest,
    ProjectSnapshot,
    WritePageRequest,
)

log = logging.getLogger("tome_agent.agent.http_client")

DEFAULT_TIMEOUT = 10.0


def _backend_url() -> str:
    return os.environ.get("TTT_BACKEND_URL", "http://backend:8765").rstrip("/")


def _auth_headers() -> dict[str, str]:
    token = os.environ.get("TTT_AGENT_TOKEN", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


# The container is multi-project: each request scopes itself to the project in
# its snapshot. The active id is set per-request (set_active_project_id) and
# read here. ContextVars are task-local, so concurrent requests for different
# projects can't clobber each other. Callbacks that MUST hit the right project
# (page writes/reads) also accept an explicit `project_id` override, in case
# the SDK runs a hook outside this context.
_active_project_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tome_active_project_id", default=None
)


def set_active_project_id(project_id: str) -> None:
    """Scope this request's backend callbacks to `project_id`."""
    _active_project_id.set(project_id)


# Per-request OAuth credentials forwarded from the caller. Keyed by provider
# slug; each value is a dict with `access_token` and optional metadata
# (`expires_in`, `cloud_id`, `site_url`). Task-local so concurrent requests for
# different users in the same container can't see each other's tokens. Read by
# `build_agent_options` to wire MCPs with the right token per provider.
_active_credentials: contextvars.ContextVar[dict[str, dict[str, str]]] = (
    contextvars.ContextVar("tome_active_credentials", default={})
)


def set_active_credentials(credentials: dict[str, dict[str, str]]) -> None:
    """Scope this request's connector credential lookups."""
    _active_credentials.set(credentials or {})


def get_active_credentials() -> dict[str, dict[str, str]]:
    return _active_credentials.get()


# The chatting user's email, when known. Task-local, same rationale as
# credentials above. Read by `build_mycelium_mcp` so a `feed_promote` call
# attributes to the actual person instead of a generic "tome" handle.
_active_actor_email: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "tome_active_actor_email", default=None
)


def set_active_actor_email(email: str | None) -> None:
    """Scope this request's Feed-promotion attribution."""
    _active_actor_email.set(email)


def get_active_actor_email() -> str | None:
    return _active_actor_email.get()


def _project_id() -> str:
    # CAIPE project ids are Mongo ObjectId hex / slugs, not UUIDs. Treat as
    # an opaque string used only to build callback URLs.
    active = _active_project_id.get()
    if not active:
        raise RuntimeError(
            "no active project id — set_active_project_id() must be called at "
            "the start of every request (multi-project agent has no env fallback)"
        )
    return active


# ---------- async API used by the agent's request handlers ----------


async def fetch_snapshot() -> ProjectSnapshot:
    url = f"{_backend_url()}/api/internal/projects/{_project_id()}/snapshot"
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.get(url, headers=_auth_headers())
        resp.raise_for_status()
        return ProjectSnapshot.model_validate(resp.json())


async def fetch_stable_pages(paths: list[str]) -> dict[str, str]:
    """Fetch the stable pages the chat prompt references. The backend
    serves them out of sqlite in one round trip."""
    if not paths:
        return {}
    url = f"{_backend_url()}/api/internal/projects/{_project_id()}/stable-pages"
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers=_auth_headers(),
            json={"paths": paths},
        )
        resp.raise_for_status()
        return resp.json()


async def write_page(
    *,
    page_path: str,
    body: str,
    message: str,
    author: str,
    report_id: UUID | None = None,
    project_id: str | None = None,
) -> None:
    pid = project_id or _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/pages"
    payload = WritePageRequest(
        path=page_path,
        body=body,
        message=message,
        author=author,
        report_id=report_id,
    )
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers=_auth_headers(),
            json=payload.model_dump(mode="json"),
        )
        resp.raise_for_status()


async def delete_page(
    *,
    page_path: str,
    author: str,
    message: str | None = None,
    project_id: str | None = None,
) -> None:
    """Tombstone a page via the backend (soft delete — appends a deleted
    revision). Mirrors `write_page`'s routing; the DELETE handler lives on the
    same internal pages endpoint and takes the target `path` as a query param."""
    pid = project_id or _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/pages"
    params = {"path": page_path, "author": author}
    if message:
        params["message"] = message
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.request(
            "DELETE", url, headers=_auth_headers(), params=params
        )
        resp.raise_for_status()


async def append_log(run_id: UUID, line: str) -> None:
    """Best-effort log append. Failures are logged and swallowed — losing
    a log line is acceptable; failing the run is not."""
    pid = _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/runs/{run_id}/log"
    payload = AppendLogRequest(line=line)
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            resp = await client.post(
                url,
                headers=_auth_headers(),
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            log.warning("append_log failed for run %s", run_id, exc_info=True)


# ---------- sync wrappers for SDK PostToolUse hooks ----------

def fetch_all_projects() -> list[dict[str, str]]:
    """List every project the backend knows about, as `[{project_id, slug,
    name}]`. Used by the persistent-workspace loader/sync to enumerate which
    project dirs to materialize on disk. Agent-token authed; no per-request
    project scope needed."""
    url = f"{_backend_url()}/api/internal/projects"
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        resp = client.get(url, headers=_auth_headers())
        resp.raise_for_status()
        data = resp.json()
        projects = data.get("projects", data) if isinstance(data, dict) else data
        return projects if isinstance(projects, list) else []


def fetch_all_pages_sync(project_id: str | None = None) -> dict[str, str]:
    """All current pages as `{path: markdown}` from the backend. Used to
    materialize a project's on-disk working copy (startup load, periodic sync,
    and at the start of an ingest) so the agent's filesystem tools
    (Read/Glob/Grep) never see stale content. Sync so it can run off-thread."""
    pid = project_id or _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/pages"
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        resp = client.get(url, headers=_auth_headers())
        resp.raise_for_status()
        return resp.json()


def write_page_sync(
    *,
    page_path: str,
    body: str,
    message: str,
    author: str,
    report_id: UUID | None = None,
) -> None:
    """Sync sibling of `write_page` for use inside SDK PostToolUse hooks
    that aren't async-friendly. Uses a short-lived sync httpx client.

    NOTE: SDK PostToolUse hooks ARE async (`async def persist`), so this
    is here as a hatch — prefer `await write_page(...)` from those hooks
    when possible."""
    pid = _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/pages"
    payload = WritePageRequest(
        path=page_path,
        body=body,
        message=message,
        author=author,
        report_id=report_id,
    )
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        resp = client.post(
            url,
            headers=_auth_headers(),
            json=payload.model_dump(mode="json"),
        )
        resp.raise_for_status()


def append_log_sync(run_id: UUID, line: str) -> None:
    pid = _project_id()
    url = f"{_backend_url()}/api/internal/projects/{pid}/runs/{run_id}/log"
    payload = AppendLogRequest(line=line)
    with httpx.Client(timeout=DEFAULT_TIMEOUT) as client:
        try:
            resp = client.post(
                url,
                headers=_auth_headers(),
                json=payload.model_dump(mode="json"),
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            log.warning("append_log_sync failed for run %s", run_id, exc_info=True)


# ---------- streaming helper used by chat tests ----------


@asynccontextmanager
async def stream_post(
    path: str, json_body: dict[str, Any]
) -> AsyncIterator[httpx.Response]:
    """Open a streaming POST to a backend internal endpoint. The agent
    itself doesn't currently call any streaming endpoints on the backend
    — this is here for symmetry and future use (e.g. fetching long
    documents in chunks)."""
    url = f"{_backend_url()}{path}"
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST", url, headers=_auth_headers(), json=json_body
        ) as resp:
            resp.raise_for_status()
            yield resp
