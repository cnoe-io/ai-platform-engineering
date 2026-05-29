# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0
"""Scheduler MCP — wraps caipe-scheduler's REST API as MCP tools.

Generic by design: agents pass the target ``agent_id`` they want fired. Pam
will pass her own ``agent_id`` when self-scheduling pod prep, but any agent
can call these tools.

Auth model: this MCP holds the shared ``SCHEDULER_SERVICE_TOKEN``; calls to
caipe-scheduler are server-to-server. Per-user attribution is carried in the
``owner_user_id`` field of each schedule (free-form string — convention is
the requesting user's email).
"""

from __future__ import annotations

import functools
import logging
import os
from typing import Annotated, Any

import httpx
from mcp.shared.exceptions import McpError
from mcp.types import INTERNAL_ERROR, INVALID_PARAMS, ErrorData
from pydantic import BaseModel, Field, model_validator

logger = logging.getLogger(__name__)


def _scheduler_url() -> str:
    url = os.environ.get("SCHEDULER_URL", "").rstrip("/")
    if not url:
        raise McpError(
            ErrorData(
                code=INTERNAL_ERROR,
                message="SCHEDULER_URL is not set on mcp_scheduler.",
            )
        )
    return url


def _scheduler_token() -> str:
    tok = os.environ.get("SCHEDULER_SERVICE_TOKEN", "")
    if not tok:
        raise McpError(
            ErrorData(
                code=INTERNAL_ERROR,
                message="SCHEDULER_SERVICE_TOKEN is not set on mcp_scheduler.",
            )
        )
    return tok


def _headers() -> dict[str, str]:
    return {"X-Scheduler-Token": _scheduler_token()}


def _handle_errors(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except McpError:
            raise
        except httpx.HTTPStatusError as e:
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=(
                        f"caipe-scheduler returned HTTP {e.response.status_code}: "
                        f"{e.response.text[:300]}"
                    ),
                )
            ) from e
        except httpx.TimeoutException as e:
            raise McpError(
                ErrorData(code=INTERNAL_ERROR, message=f"caipe-scheduler timeout: {e}")
            ) from e
        except ValueError as e:
            raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e))) from e
        except Exception as e:  # noqa: BLE001
            logger.exception("unhandled error in mcp_scheduler tool")
            raise McpError(
                ErrorData(code=INTERNAL_ERROR, message=f"{type(e).__name__}: {e}")
            ) from e

    return wrapper


# ─────────────────────────────── arg models ─────────────────────────────────


class CreateScheduleArgs(BaseModel):
    agent_id: Annotated[
        str,
        Field(
            description=(
                "Dynamic agent _id to fire (e.g. 'agent-sunny-webex-meeting-test'). "
                "Must already exist in dynamic_agents."
            )
        ),
    ]
    title: Annotated[
        str,
        Field(
            description=(
                "Human-readable job title shown in schedule UIs. "
                "Choose it at schedule creation time, e.g. "
                "'Important Team 2 Meeting Prep'."
            )
        ),
    ]
    message_template: Annotated[
        str,
        Field(
            description=(
                "Plain-text chat message body that will be POSTed on every fire. "
                "No template engine; passed verbatim. Keep concise."
            )
        ),
    ]
    cron: Annotated[
        str,
        Field(description="Standard 5-field cron, e.g. '0 9 * * MON' = 9am Mondays."),
    ]
    tz: Annotated[
        str,
        Field(
            description=(
                "IANA timezone name, e.g. 'America/Los_Angeles'. "
                "The cron expression is evaluated in this zone."
            )
        ),
    ]
    owner_user_id: Annotated[
        str,
        Field(
            description=(
                "Identifier the chat backend will attribute the fire to. "
                "Convention: the requesting user's email."
            )
        ),
    ]
    pod_id: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Optional context tag stored on the schedule. Useful for filtering "
                "in `list_schedules`. Pam uses this to track per-pod schedules."
            ),
        ),
    ] = None
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Optional JSON object of small display attributes for UIs. "
            "Use this for generic labels such as pod_id, meeting_series, or workflow."
        ),
    )
    edit_agent_id: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Optional Dynamic Agent _id to open for future user-initiated edits. "
                "If omitted, UIs fall back to the generic schedule editor."
            ),
        ),
    ] = None


class ListSchedulesArgs(BaseModel):
    owner_user_id: Annotated[
        str | None,
        Field(default=None, description="Filter by owner_user_id."),
    ] = None
    pod_id: Annotated[
        str | None, Field(default=None, description="Filter by pod_id.")
    ] = None
    agent_id: Annotated[
        str | None, Field(default=None, description="Filter by agent_id.")
    ] = None


class GetScheduleArgs(BaseModel):
    schedule_id: Annotated[str, Field(description="The sched_<...> id to fetch.")]


class ScheduleIdArgs(BaseModel):
    schedule_id: Annotated[str, Field(description="The sched_<...> id to change.")]


class PatchScheduleArgs(BaseModel):
    schedule_id: Annotated[str, Field(description="The schedule to patch.")]
    agent_id: Annotated[
        str | None, Field(default=None, description="New Dynamic Agent id.")
    ] = None
    edit_agent_id: Annotated[
        str | None, Field(default=None, description="New schedule editor agent id.")
    ] = None
    enabled: Annotated[
        bool | None, Field(default=None, description="Toggle on/off.")
    ] = None
    cron: Annotated[
        str | None, Field(default=None, description="New cron expression.")
    ] = None
    tz: Annotated[
        str | None, Field(default=None, description="New IANA timezone.")
    ] = None
    message_template: Annotated[
        str | None, Field(default=None, description="New chat message body.")
    ] = None
    title: Annotated[
        str | None, Field(default=None, description="New human-readable job title.")
    ] = None
    attributes: dict[str, Any] | None = Field(
        default=None,
        description="Replacement display attributes JSON object.",
    )


class DeleteScheduleArgs(BaseModel):
    schedule_id: Annotated[str, Field(description="The schedule to delete.")]


class ScheduleOneOffArgs(BaseModel):
    schedule_id: Annotated[
        str,
        Field(description="Parent sched_<...> id whose CronJob template should be fired."),
    ]
    run_at: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Exact UTC or timezone-aware ISO timestamp for the one-off fire. "
                "Mutually exclusive with delay_minutes."
            ),
        ),
    ] = None
    delay_minutes: Annotated[
        int | None,
        Field(
            default=None,
            ge=0,
            description="Delay from now before firing. Mutually exclusive with run_at.",
        ),
    ] = None
    message_template: Annotated[
        str | None,
        Field(
            default=None,
            description=(
                "Optional one-off message. Omit to reuse the parent schedule's "
                "message_template."
            ),
        ),
    ] = None
    reason: Annotated[
        str | None,
        Field(
            default=None,
            description="Optional short reason, e.g. transcript_not_ready.",
        ),
    ] = None
    retry_num: Annotated[
        int | None,
        Field(default=None, ge=0, description="Optional retry attempt number."),
    ] = None
    retry_limit: Annotated[
        int | None,
        Field(default=None, ge=0, description="Optional retry limit."),
    ] = None

    @model_validator(mode="after")
    def exactly_one_time_source(self) -> "ScheduleOneOffArgs":
        if (self.run_at is None) == (self.delay_minutes is None):
            raise ValueError("Pass exactly one of run_at or delay_minutes.")
        return self


class ListOneOffRunsArgs(BaseModel):
    schedule_id: Annotated[str, Field(description="Parent schedule id.")]
    status: Annotated[
        list[str] | None,
        Field(default=None, description="Optional statuses to filter by."),
    ] = None


# ─────────────────────────────── tool surface ───────────────────────────────


def register_tools(server) -> None:
    timeout = float(os.environ.get("HTTP_TIMEOUT", "30"))

    async def _patch_schedule(
        schedule_id: str,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.patch(
                f"{_scheduler_url()}/v1/schedules/{schedule_id}",
                headers=_headers(),
                json=body,
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="create_schedule",
        description=(
            "Register a cron schedule. The named agent will receive `message_template` "
            "as a chat message every time the cron fires, attributed to `owner_user_id`. "
            "`title` is the required human-readable UI title; `attributes` is an "
            "optional display metadata object; `edit_agent_id` optionally selects "
            "which agent UIs open for later edits. Returns {schedule_id, cronjob_name}."
        ),
    )
    @_handle_errors
    async def create_schedule(args: CreateScheduleArgs) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{_scheduler_url()}/v1/schedules",
                headers=_headers(),
                json=args.model_dump(exclude_none=True),
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="list_schedules",
        description=(
            "List schedules. All filters optional; if you pass none, every schedule "
            "is returned. Use to find a schedule_id before calling patch/delete."
        ),
    )
    @_handle_errors
    async def list_schedules(args: ListSchedulesArgs) -> dict[str, Any]:
        params: dict[str, str] = {}
        if args.owner_user_id:
            params["owner"] = args.owner_user_id
        if args.pod_id:
            params["pod_id"] = args.pod_id
        if args.agent_id:
            params["agent_id"] = args.agent_id
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{_scheduler_url()}/v1/schedules",
                headers=_headers(),
                params=params,
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="get_schedule",
        description="Fetch a single schedule by its schedule_id.",
    )
    @_handle_errors
    async def get_schedule(args: GetScheduleArgs) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{_scheduler_url()}/v1/schedules/{args.schedule_id}",
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="update_schedule",
        description=(
            "Patch a schedule. Pass only the fields you want to change. "
            "Setting `enabled=false` suspends the underlying CronJob without deleting it."
        ),
    )
    @_handle_errors
    async def update_schedule(args: PatchScheduleArgs) -> dict[str, Any]:
        body = args.model_dump(exclude_unset=True, exclude={"schedule_id"})
        return await _patch_schedule(args.schedule_id, body)

    @server.tool(
        name="pause_schedule",
        description=(
            "Pause a schedule without deleting it. Sets Mongo enabled=false and "
            "suspends the underlying Kubernetes CronJob (spec.suspend=true). "
            "Already-running Jobs are not killed."
        ),
    )
    @_handle_errors
    async def pause_schedule(args: ScheduleIdArgs) -> dict[str, Any]:
        return await _patch_schedule(args.schedule_id, {"enabled": False})

    @server.tool(
        name="resume_schedule",
        description=(
            "Resume a paused schedule. Sets Mongo enabled=true and unsuspends "
            "the underlying Kubernetes CronJob (spec.suspend=false). This does "
            "not immediately trigger a run; it resumes future cron fires."
        ),
    )
    @_handle_errors
    async def resume_schedule(args: ScheduleIdArgs) -> dict[str, Any]:
        return await _patch_schedule(args.schedule_id, {"enabled": True})

    @server.tool(
        name="restart_schedule",
        description=(
            "Alias for resume_schedule for users who say 'restart the CronJob'. "
            "It re-enables future scheduled fires only; it does not create an "
            "immediate one-off Job."
        ),
    )
    @_handle_errors
    async def restart_schedule(args: ScheduleIdArgs) -> dict[str, Any]:
        return await _patch_schedule(args.schedule_id, {"enabled": True})

    @server.tool(
        name="schedule_one_off",
        description=(
            "Create a delayed one-off fire for an existing recurring schedule. "
            "The scheduler stores the request in Mongo, then creates a normal "
            "Kubernetes Job from the parent CronJob's jobTemplate when due. Pass "
            "exactly one of run_at or delay_minutes. Use retry_num/retry_limit for "
            "domain retries such as transcript_not_ready."
        ),
    )
    @_handle_errors
    async def schedule_one_off(args: ScheduleOneOffArgs) -> dict[str, Any]:
        body = args.model_dump(
            exclude_unset=True,
            exclude_none=True,
            exclude={"schedule_id"},
            mode="json",
        )
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{_scheduler_url()}/v1/schedules/{args.schedule_id}/one-off-runs",
                headers=_headers(),
                json=body,
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="list_one_off_runs",
        description="List delayed one-off fires linked to a recurring schedule.",
    )
    @_handle_errors
    async def list_one_off_runs(args: ListOneOffRunsArgs) -> dict[str, Any]:
        params: list[tuple[str, str]] = []
        for status in args.status or []:
            params.append(("status", status))
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(
                f"{_scheduler_url()}/v1/schedules/{args.schedule_id}/one-off-runs",
                headers=_headers(),
                params=params,
            )
            r.raise_for_status()
            return r.json()

    @server.tool(
        name="delete_schedule",
        description="Permanently delete a schedule (Mongo doc + underlying CronJob).",
    )
    @_handle_errors
    async def delete_schedule(args: DeleteScheduleArgs) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.delete(
                f"{_scheduler_url()}/v1/schedules/{args.schedule_id}",
                headers=_headers(),
            )
            r.raise_for_status()
            return r.json()
