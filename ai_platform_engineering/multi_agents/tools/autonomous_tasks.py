# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Autonomous-task management tools for the supervisor.

Spec #099 Phase 3 — gives the supervisor's main agent a small set of
``@tool``s for creating, updating, deleting, listing, and triggering
autonomous tasks. With these wired into ``utility_tools`` the LLM
router can satisfy a request like *"create a task that summarises
yesterday's merged PRs every weekday at 9 AM"* by walking the user
through any clarifying questions and finally calling
``create_autonomous_task`` to persist the definition — no UI form
required for the operator who'd rather describe what they want.

Why these are supervisor-level tools rather than a dedicated
``task_author`` sub-agent:

* The autonomous-agents service already exposes the full CRUD surface
  over HTTP. These tools are thin wrappers around that surface; there's
  no domain reasoning that warrants a separate sub-agent prompt /
  registry / route table.
* Keeping them at supervisor scope means a user can mention task
  creation in any chat (regular OR autonomous) and the supervisor's
  LLM picks the right tool. No special routing / sub-agent dispatch
  ceremony.
* If we later need richer behaviour (multi-turn confirmation flows,
  credential broker, etc.) the tools can be moved to a sub-agent
  without changing their wire contract.

Backend selection:

The autonomous-agents base URL is read from ``AUTONOMOUS_AGENTS_URL``
(falls back to ``http://localhost:8002``). This matches the env var
the UI proxy uses, so a single change in production ops moves both
the proxy and the tool.

Error handling:

These tools never raise — they return a human-readable string the LLM
can present to the operator. An HTTP 4xx is the most common failure
mode (e.g. duplicate task id, invalid cron) and the user benefits
more from seeing the server's ``detail`` than a stack trace. 5xx /
transport errors return a "service unreachable" hint.
"""

from __future__ import annotations

import logging
import os
import secrets as _secrets
from typing import Any, Literal

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)


def _autonomous_agents_url() -> str:
    """Internal (service-to-service) base URL for autonomous-agents.

    Read from ``AUTONOMOUS_AGENTS_URL`` (e.g. ``http://autonomous-agents:8002``
    in docker-compose, ``http://localhost:8002`` for native dev).

    Used by the tool to POST to the REST API. Not the URL we hand to
    external webhook senders like GitHub -- that's :func:`_public_base_url`.
    """
    return (os.environ.get("AUTONOMOUS_AGENTS_URL") or "http://localhost:8002").rstrip("/")


def _public_base_url() -> str:
    """Externally-reachable base URL for autonomous-agents.

    Webhook senders like GitHub need to reach us from the public
    internet, which means neither ``http://autonomous-agents:8002``
    (internal docker DNS) nor ``http://localhost:8002`` (loopback)
    are usable. Operators set ``AUTONOMOUS_AGENTS_PUBLIC_URL`` to the
    machine's ngrok/cloudflared tunnel for dev or the real hostname
    for prod.

    Falls back to ``AUTONOMOUS_AGENTS_URL`` when unset so existing
    local-dev flows still produce a well-formed callback URL even if
    external reachability is lacking. The LLM can read the returned
    URL and tell the operator "this won't work from GitHub until you
    set AUTONOMOUS_AGENTS_PUBLIC_URL".
    """
    public = os.environ.get("AUTONOMOUS_AGENTS_PUBLIC_URL")
    if public:
        return public.rstrip("/")
    return _autonomous_agents_url()


def _webhook_callback_url(task_id: str) -> str:
    """Build the canonical callback URL for a webhook task.

    Centralised so both :func:`create_autonomous_task` and any future
    code path that needs to report "this task is reachable at..."
    produce identical strings.
    """
    return f"{_public_base_url()}/hooks/{task_id}"


def _api_url(path: str) -> str:
    """Compose ``<base>/api/v1/<path>``, never producing a double slash."""
    return f"{_autonomous_agents_url()}/api/v1/{path.lstrip('/')}"


def _format_http_error(exc: httpx.HTTPStatusError) -> str:
    """Pull the FastAPI ``detail`` field out of an error response and format it."""
    try:
        body = exc.response.json()
        detail = body.get("detail") if isinstance(body, dict) else None
    except (ValueError, AttributeError):
        detail = None
    msg = detail if isinstance(detail, str) else exc.response.text or str(exc)
    return f"HTTP {exc.response.status_code}: {msg}"


def _format_task(task: dict[str, Any]) -> str:
    """One-line summary of a task for inclusion in tool responses."""
    trig = task.get("trigger") or {}
    trig_type = trig.get("type", "?")
    trig_summary = ""
    if trig_type == "cron":
        trig_summary = f"cron `{trig.get('schedule', '?')}`"
    elif trig_type == "interval":
        parts = []
        for unit, val in (("h", trig.get("hours")), ("m", trig.get("minutes")), ("s", trig.get("seconds"))):
            if val:
                parts.append(f"{val}{unit}")
        trig_summary = "every " + " ".join(parts) if parts else "interval (?)"
    elif trig_type == "webhook":
        trig_summary = f"webhook → POST /api/v1/hooks/{task.get('id')}"
    enabled = "enabled" if task.get("enabled") else "DISABLED"
    next_run = task.get("next_run") or "—"
    return (
        f"- `{task.get('id')}` ({task.get('name')}) "
        f"agent={task.get('agent') or '(LLM-routed)'} "
        f"trigger={trig_summary} "
        f"status={enabled} next_run={next_run}"
    )


@tool
def list_autonomous_tasks() -> str:
    """List every autonomous task currently registered in the scheduler.

    Returns a one-line summary per task showing id, name, target sub-agent
    (or "(LLM-routed)" if none), trigger type+spec, enabled state, and
    next scheduled fire time.

    Use this to discover what's already configured before suggesting a
    new task to the operator (so you don't propose a duplicate id), or
    to answer "what autonomous work is currently scheduled?"
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(_api_url("tasks"))
            response.raise_for_status()
        tasks = response.json()
    except httpx.HTTPStatusError as exc:
        return f"Failed to list tasks: {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable at {_autonomous_agents_url()}: {exc}"

    if not isinstance(tasks, list) or not tasks:
        return "No autonomous tasks are configured yet."
    return f"{len(tasks)} autonomous task(s):\n" + "\n".join(_format_task(t) for t in tasks)


@tool
def create_autonomous_task(
    id: str,
    name: str,
    prompt: str,
    trigger_type: Literal["cron", "interval", "webhook"],
    trigger_schedule: str | None = None,
    trigger_seconds: int | None = None,
    trigger_minutes: int | None = None,
    trigger_hours: int | None = None,
    webhook_secret: str | None = None,
    description: str | None = None,
    agent: str | None = None,
    llm_provider: str | None = None,
    enabled: bool = True,
) -> str:
    """Create a new autonomous task that the supervisor will run on a schedule.

    Use this once you have collected enough information from the operator
    to construct a complete task definition. You SHOULD confirm the
    proposed task back to the operator (id, name, trigger, prompt) BEFORE
    calling this tool — task creation is mildly destructive (it spawns
    a scheduled job) and the operator should sign off.

    For ``trigger_type='webhook'`` tasks, this tool's response includes
    the ``callback_url`` and HMAC ``secret`` that the next step --
    usually ``register_github_webhook`` -- needs to wire an external
    sender (GitHub, PagerDuty, etc.) to the new task. If ``webhook_secret``
    is not supplied, a fresh 32-byte hex secret is generated server-side
    so the caller doesn't have to invent one.

    Args:
        id: Unique short identifier (letters, digits, ``-``, ``_`` only).
            E.g. ``daily-pr-sweep``. Used in URLs and as a stable handle.
        name: Human-readable name shown in the UI list.
        prompt: The full prompt that will be sent to the supervisor every
            time the task fires. Be specific (which repo, which agent
            should be involved, what output format).
        trigger_type: ``cron`` for a recurring schedule, ``interval`` for
            "every N seconds/minutes/hours", or ``webhook`` for an
            externally-triggered task.
        trigger_schedule: Standard 5-field cron expression (UTC).
            Required when ``trigger_type='cron'``. E.g. ``0 9 * * 1-5``
            for "9 AM Mon-Fri".
        trigger_seconds: Interval period in seconds. Provide one of
            ``trigger_seconds``/``trigger_minutes``/``trigger_hours`` when
            ``trigger_type='interval'``.
        trigger_minutes: Interval period in minutes.
        trigger_hours: Interval period in hours.
        webhook_secret: Optional HMAC-SHA256 secret for
            ``trigger_type='webhook'``. GitHub (and any compliant sender)
            signs each delivery with this so the receiver can verify the
            request is genuine. If omitted for a webhook task, a fresh
            32-byte hex secret is auto-generated and returned in the
            success string so the operator / the next tool call can use
            it. Ignored for non-webhook triggers.
        description: Optional free-form description shown alongside the
            task in the UI list.
        agent: Optional routing hint — sub-agent id to dispatch to (e.g.
            ``github``, ``argocd``). Leave unset to let the supervisor's
            LLM router pick a sub-agent at run time based on the prompt.
        llm_provider: Optional LLM provider override for this task only
            (e.g. ``openai``, ``anthropic-claude``). Inherits the global
            default when unset.
        enabled: Whether the task should fire on its schedule. Default
            ``True``. Set ``False`` to create a task in the disabled state
            (operator can flip it on later from the UI).

    Returns a confirmation string with the new task summary, or a
    human-readable error explaining what went wrong. For webhook
    triggers the response additionally includes:
      ``callback_url``: where to point the external sender
      ``secret``: HMAC key (auto-generated if not supplied) -- surfaced
          exactly once, so the LLM should either pass it straight to
          the next tool call or relay it to the operator.
    """
    trigger: dict[str, Any] = {"type": trigger_type}
    if trigger_type == "cron":
        if not trigger_schedule:
            return (
                "create_autonomous_task: ``trigger_schedule`` is required when "
                "``trigger_type='cron'`` (5-field UTC cron, e.g. '0 9 * * 1-5')."
            )
        trigger["schedule"] = trigger_schedule
    elif trigger_type == "interval":
        if not (trigger_seconds or trigger_minutes or trigger_hours):
            return (
                "create_autonomous_task: provide one of trigger_seconds, "
                "trigger_minutes, or trigger_hours (positive int) when "
                "``trigger_type='interval'``."
            )
        if trigger_seconds:
            trigger["seconds"] = trigger_seconds
        if trigger_minutes:
            trigger["minutes"] = trigger_minutes
        if trigger_hours:
            trigger["hours"] = trigger_hours
    elif trigger_type == "webhook":
        # Per the Phase 2 design doc in WEBHOOK_DEMO_PLAN.md: auto-generate
        # a per-task secret when the caller doesn't supply one so the LLM
        # can chain create_autonomous_task -> register_github_webhook in a
        # single turn without a separate "generate a secret" round-trip.
        # Track whether it was auto-generated so we can surface it in the
        # response only in that case (operator visibility) -- echoing a
        # caller-supplied secret would pointlessly widen the leak surface.
        if webhook_secret:
            secret_value = webhook_secret
            secret_was_generated = False
        else:
            secret_value = _secrets.token_hex(32)
            secret_was_generated = True
        trigger["secret"] = secret_value

    payload: dict[str, Any] = {
        "id": id,
        "name": name,
        "prompt": prompt,
        "trigger": trigger,
        "enabled": enabled,
    }
    if description:
        payload["description"] = description
    if agent:
        payload["agent"] = agent
    if llm_provider:
        payload["llm_provider"] = llm_provider

    try:
        with httpx.Client(timeout=15.0) as client:
            response = client.post(_api_url("tasks"), json=payload)
            response.raise_for_status()
        created = response.json()
    except httpx.HTTPStatusError as exc:
        return f"Failed to create task '{id}': {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable at {_autonomous_agents_url()}: {exc}"

    lines = [f"Created autonomous task:\n{_format_task(created)}"]

    # Webhook-specific follow-up: expose the URL external senders need
    # and the secret they need to sign with. The caller's typical next
    # move is register_github_webhook(..., callback_url=<url>, secret=<val>)
    # to wire GitHub to this task -- doing that in the same LLM turn is
    # the whole point of spec #099 webhook follow-up.
    if trigger_type == "webhook":
        callback_url = _webhook_callback_url(created.get("id") or id)
        lines.append("")
        lines.append(f"callback_url: {callback_url}")
        if secret_was_generated:
            lines.append(
                f"secret: {secret_value}  "
                "(auto-generated; pass this to register_github_webhook)"
            )
        else:
            lines.append("secret: (using the value you supplied)")
        if not os.environ.get("AUTONOMOUS_AGENTS_PUBLIC_URL"):
            lines.append(
                "Note: AUTONOMOUS_AGENTS_PUBLIC_URL is not set, so the "
                "callback_url above is internal-only. External senders "
                "like GitHub will not reach it. Set "
                "AUTONOMOUS_AGENTS_PUBLIC_URL to the machine's public "
                "hostname (ngrok tunnel in dev, real domain in prod) "
                "and re-create the webhook on GitHub."
            )
    return "\n".join(lines)


@tool
def update_autonomous_task(
    id: str,
    name: str | None = None,
    prompt: str | None = None,
    trigger_type: Literal["cron", "interval", "webhook"] | None = None,
    trigger_schedule: str | None = None,
    trigger_seconds: int | None = None,
    trigger_minutes: int | None = None,
    trigger_hours: int | None = None,
    description: str | None = None,
    agent: str | None = None,
    llm_provider: str | None = None,
    enabled: bool | None = None,
) -> str:
    """Update an existing autonomous task.

    Fetches the current task definition, applies the supplied fields as
    overrides (any field left ``None`` is preserved as-is), and PUTs the
    merged definition back. Confirms the change to the operator with the
    fresh summary.

    Use this when the operator wants to change a single aspect of a task
    (e.g. "switch the cron from 9 AM to 10 AM") without re-typing the
    entire definition.
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            existing_resp = client.get(_api_url(f"tasks/{id}"))
            existing_resp.raise_for_status()
        existing = existing_resp.json()
    except httpx.HTTPStatusError as exc:
        return f"Cannot update task '{id}': {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable: {exc}"

    payload = dict(existing)
    if name is not None:
        payload["name"] = name
    if prompt is not None:
        payload["prompt"] = prompt
    if description is not None:
        payload["description"] = description
    if agent is not None:
        payload["agent"] = agent
    if llm_provider is not None:
        payload["llm_provider"] = llm_provider
    if enabled is not None:
        payload["enabled"] = enabled
    if trigger_type is not None:
        new_trig: dict[str, Any] = {"type": trigger_type}
        if trigger_type == "cron":
            new_trig["schedule"] = trigger_schedule or (existing.get("trigger") or {}).get("schedule")
        elif trigger_type == "interval":
            for k, v in (
                ("seconds", trigger_seconds), ("minutes", trigger_minutes), ("hours", trigger_hours),
            ):
                if v is not None:
                    new_trig[k] = v
        payload["trigger"] = new_trig
    # Strip server-managed fields that PUT either ignores or rejects.
    for k in ("last_ack", "chat_conversation_id", "next_run"):
        payload.pop(k, None)

    try:
        with httpx.Client(timeout=15.0) as client:
            put_resp = client.put(_api_url(f"tasks/{id}"), json=payload)
            put_resp.raise_for_status()
        updated = put_resp.json()
    except httpx.HTTPStatusError as exc:
        return f"Failed to update task '{id}': {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable: {exc}"

    return f"Updated autonomous task:\n{_format_task(updated)}"


@tool
def delete_autonomous_task(id: str) -> str:
    """Delete an autonomous task by id. The action is permanent — the
    operator should explicitly confirm before you call this tool.
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.delete(_api_url(f"tasks/{id}"))
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        return f"Failed to delete task '{id}': {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable: {exc}"
    return f"Deleted autonomous task '{id}'."


@tool
def trigger_autonomous_task_now(id: str) -> str:
    """Run an autonomous task immediately (out of band from its schedule).

    Useful for previewing what the task will produce when its cron next
    fires, e.g. after creating it. Returns immediately with a "queued"
    acknowledgement; the actual run completes asynchronously and shows
    up in the task's chat thread + run history.
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(_api_url(f"tasks/{id}/run"))
            response.raise_for_status()
        body = response.json()
    except httpx.HTTPStatusError as exc:
        return f"Failed to trigger task '{id}': {_format_http_error(exc)}"
    except httpx.TransportError as exc:
        return f"Autonomous-agents service unreachable: {exc}"
    return f"Queued ad-hoc run of '{id}': {body}"


@tool
def validate_cron_expression(expression: str) -> str:
    """Sanity-check a 5-field cron expression before using it in a task.

    Returns ``OK <normalised expression>`` for a parseable expression, or
    a human-readable error explaining what's wrong. Use this whenever
    the operator hands you a cron string before passing it to
    ``create_autonomous_task`` so a typo doesn't block scheduling.
    """
    parts = expression.strip().split()
    if len(parts) != 5:
        return (
            f"Cron expression must have exactly 5 fields "
            f"(minute hour day-of-month month day-of-week); got {len(parts)}: '{expression}'"
        )
    # Defer to APScheduler for real validation (it's the same library
    # the autonomous-agents scheduler uses, so anything it accepts is
    # guaranteed to schedule correctly).
    try:
        from apscheduler.triggers.cron import CronTrigger

        CronTrigger.from_crontab(expression)
    except ImportError:
        # apscheduler isn't on the supervisor's dependency tree; fall
        # back to the field-count check above without rejecting valid
        # expressions.
        return f"OK '{expression}' (parsed as 5 fields; APScheduler validation skipped)"
    except (ValueError, TypeError) as exc:
        return f"Invalid cron expression '{expression}': {exc}"
    return f"OK '{expression}'"


__all__ = [
    "list_autonomous_tasks",
    "create_autonomous_task",
    "update_autonomous_task",
    "delete_autonomous_task",
    "trigger_autonomous_task_now",
    "validate_cron_expression",
]
