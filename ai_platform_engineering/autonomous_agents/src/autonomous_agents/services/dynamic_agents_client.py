"""HTTP client for the dynamic-agents service.

This is the second outbound path the autonomous-agents service supports
(the first is ``a2a_client`` against the supervisor). When a
``TaskDefinition`` carries ``dynamic_agent_id``, the scheduler and the
preflight bg-job route through here so the prompt is actually executed
by the user's custom agent (its tools / system prompt / middleware)
rather than being silently swallowed by the supervisor's permissive LLM
router.

Why this is its own module rather than living in ``a2a_client``:

* The dynamic-agents service is not A2A. It exposes plain HTTP
  ``/chat/invoke`` (sync) and ``/chat/stream/start`` (SSE), so the
  JSON-RPC + ``message/stream`` plumbing in ``a2a_client`` does not
  apply.
* It expects a gateway-injected ``X-User-Context`` header. Every
  scheduled run is system-driven (no human user attached), so we mint
  a synthetic header here rather than threading user context through
  the scheduler.
* Preflight is a different shape: a simple ``GET /agents/{id}/probe``
  reachability check, not the supervisor's MAS-subagent registry
  lookup.
"""

from __future__ import annotations

import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

from autonomous_agents.config import get_settings
from autonomous_agents.services.a2a_client import build_prompt_with_routing
from autonomous_agents.services.preflight import Acknowledgement

logger = logging.getLogger("autonomous_agents")

__all__ = [
    "DynamicAgentsClientError",
    "DynamicAgentsNotConfiguredError",
    "invoke_dynamic_agent",
    "preflight_dynamic_agent",
]


class DynamicAgentsClientError(RuntimeError):
    """Raised when the dynamic-agents service refuses or errors a call.

    Surfaced by :func:`invoke_dynamic_agent` so the scheduler's existing
    ``except Exception`` arm records a ``TaskRun`` with ``status=failed``
    and the message becomes the error preview in the UI.
    """


class DynamicAgentsNotConfiguredError(DynamicAgentsClientError):
    """Raised when ``DYNAMIC_AGENTS_URL`` is not set.

    Specialised so callers can render an actionable error rather than a
    generic transport failure: the operator just needs to set the env
    var and restart.
    """


# ----------------------------------------------------------------------
# Synthetic system user context.
# ----------------------------------------------------------------------
# The dynamic-agents auth layer (``dynamic_agents/auth/auth.py``) trusts
# whatever the gateway puts in the ``X-User-Context`` header. For
# autonomous tasks there is no real user, so we mint a stable system
# identity here. The ``email`` is configurable via
# ``Settings.dynamic_agents_system_email`` so operators can audit which
# traffic came from the autonomous service.
def _build_system_user_context_header() -> str:
    settings = get_settings()
    payload = {
        "email": settings.dynamic_agents_system_email,
        "name": "Autonomous Agent",
        "is_admin": True,
        "is_authorized": True,
    }
    return base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")


def _system_headers() -> dict[str, str]:
    return {
        "X-User-Context": _build_system_user_context_header(),
        "Content-Type": "application/json",
    }


def _normalize_base_url(url: str) -> str:
    """Return ``url`` without a trailing slash (joining is then cheap)."""
    return url.rstrip("/")


async def invoke_dynamic_agent(
    *,
    prompt: str,
    task_id: str,
    agent_id: str,
    conversation_id: str | None = None,
    context: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Invoke a dynamic agent synchronously and return (content, events).

    Args:
        prompt: The task prompt -- becomes the ``message`` field on the
            dynamic-agents ``ChatRequest``.
        task_id: Stable autonomous task id; used to derive a deterministic
            conversation id when ``conversation_id`` is not supplied so
            scheduled runs of the same task share session state with the
            interactive chat thread for that task.
        agent_id: Dynamic-agents service agent id (``ChatRequest.agent_id``).
        conversation_id: Optional explicit conversation id (UUID5-derived
            elsewhere). When ``None``, derived from ``task_id``.
        context: Optional webhook/scheduler context appended to the message
            in the same ``Context:\n{...}`` format used by the supervisor
            path. Dynamic agents do not need a supervisor routing directive,
            so the formatter is called with ``agent=None``.
        timeout: Per-call HTTP timeout in seconds. Defaults to
            ``Settings.dynamic_agents_timeout_seconds`` when ``None``.

    Returns:
        A 2-tuple ``(content, events)``. ``events`` is intentionally
        always ``[]`` for the sync ``/chat/invoke`` path -- a follow-up
        can swap in ``/chat/stream/start`` parsing for richer chat
        replay parity. The scheduler treats an empty events list the
        same way it treats legacy blocking responses.

    Raises:
        DynamicAgentsNotConfiguredError: when ``DYNAMIC_AGENTS_URL`` is
            unset. Caller should let this surface as the run's
            ``error``.
        DynamicAgentsClientError: on non-2xx response, transport
            failure, or ``success: false`` payload.
    """
    settings = get_settings()
    if not settings.dynamic_agents_url:
        raise DynamicAgentsNotConfiguredError(
            "DYNAMIC_AGENTS_URL is not configured; set it on the autonomous-agents "
            "service (e.g. http://dynamic-agents:8001) so dynamic-agent tasks can "
            "reach the dynamic-agents service."
        )

    if conversation_id is None:
        conversation_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"autonomous-task:{task_id}")
        )

    effective_timeout = (
        timeout if timeout is not None else settings.dynamic_agents_timeout_seconds
    )

    base = _normalize_base_url(settings.dynamic_agents_url)
    # The dynamic-agents service mounts its routers under ``/api/v1``
    # (see dynamic_agents/main.py). Hard-code the prefix here rather
    # than make operators bake it into ``DYNAMIC_AGENTS_URL`` so the
    # env-var stays a plain base URL aligned with all other consumers
    # (UI proxy, slack-bot SSE client).
    url = f"{base}/api/v1/chat/invoke"
    full_prompt = build_prompt_with_routing(prompt, agent=None, context=context)
    body = {
        "message": full_prompt,
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "trace_id": task_id,
    }

    logger.info(
        "dynamic_agents_client.invoke: task=%s agent=%s url=%s timeout=%.1fs",
        task_id,
        agent_id,
        url,
        effective_timeout,
    )

    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            resp = await client.post(url, json=body, headers=_system_headers())
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        # Transport failure -- the dynamic-agents service didn't answer.
        # Re-raise as a typed error so the scheduler records the run as
        # failed with a useful message rather than a bare ``fetch
        # failed``.
        raise DynamicAgentsClientError(
            f"dynamic-agents service at {url} did not respond: {exc}"
        ) from exc

    if resp.status_code == 404:
        raise DynamicAgentsClientError(
            f"dynamic-agents service has no agent with id '{agent_id}' "
            f"(HTTP 404 from {url})."
        )
    if resp.status_code >= 400:
        # Avoid logging response body wholesale -- can contain user data.
        raise DynamicAgentsClientError(
            f"dynamic-agents service returned HTTP {resp.status_code} for agent "
            f"'{agent_id}' on {url}."
        )

    try:
        data = resp.json()
    except ValueError as exc:
        raise DynamicAgentsClientError(
            f"dynamic-agents service returned non-JSON response from {url}: {exc}"
        ) from exc

    if not isinstance(data, dict):
        raise DynamicAgentsClientError(
            f"dynamic-agents service returned unexpected payload shape from {url}."
        )

    if data.get("success") is False:
        # The dynamic-agents /chat/invoke route deliberately returns a
        # generic message in this branch (it logs the real exception
        # server-side). Surface that as-is.
        raise DynamicAgentsClientError(
            data.get("error") or "dynamic-agents service reported failure."
        )

    content = data.get("content")
    if not isinstance(content, str):
        # Defensive: spec says ``content`` is always a string when
        # ``success`` is true. Treat anything else as an error rather
        # than coerce silently.
        raise DynamicAgentsClientError(
            "dynamic-agents service returned no string 'content' in response."
        )

    return content, []


async def preflight_dynamic_agent(
    *,
    agent_id: str,
    timeout: float | None = None,
) -> Acknowledgement:
    """Probe the dynamic-agents service to verify ``agent_id`` exists.

    Mirrors ``services.preflight.preflight`` for the dynamic-agent
    routing path so the UI's "Ack" badge means the same thing
    regardless of which routing path a task uses.

    NEVER raises -- every failure mode maps to an :class:`Acknowledgement`
    so the caller can persist it unconditionally. ``ack_status`` semantics
    match the supervisor path:

    * ``ok``       -- agent exists in the dynamic-agents service.
    * ``failed``   -- service reachable but agent unknown / config error.
    * ``pending``  -- service unreachable; will retry on next task touch.

    Args:
        agent_id: Dynamic-agents service agent id.
        timeout: Per-call HTTP timeout in seconds. Defaults to
            ``Settings.dynamic_agents_preflight_timeout_seconds`` when
            ``None``.
    """
    settings = get_settings()
    if not settings.dynamic_agents_url:
        return Acknowledgement.application_failure(
            "DYNAMIC_AGENTS_URL is not configured on the autonomous-agents "
            "service; dynamic-agent tasks cannot be dispatched until it is set."
        )

    effective_timeout = (
        timeout
        if timeout is not None
        else settings.dynamic_agents_preflight_timeout_seconds
    )

    base = _normalize_base_url(settings.dynamic_agents_url)
    url = f"{base}/api/v1/agents/{agent_id}/probe"

    logger.info(
        "dynamic_agents_client.preflight: agent=%s url=%s timeout=%.1fs",
        agent_id,
        url,
        effective_timeout,
    )

    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            resp = await client.get(url, headers=_system_headers())
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning(
            "dynamic_agents_client.preflight: transport failure for agent=%s: %s",
            agent_id,
            exc,
        )
        return Acknowledgement.transport_failure(
            f"dynamic-agents service at {settings.dynamic_agents_url} did not "
            f"respond: {exc}"
        )

    if resp.status_code == 404:
        return Acknowledgement.application_failure(
            f"Dynamic agent '{agent_id}' was not found in the dynamic-agents "
            "service. Re-create it from the Custom Agent editor or pick a "
            "different target."
        )
    if resp.status_code >= 400:
        return Acknowledgement.application_failure(
            f"dynamic-agents service returned HTTP {resp.status_code} when "
            f"probing agent '{agent_id}'."
        )

    try:
        body = resp.json()
    except ValueError:
        return Acknowledgement.application_failure(
            "dynamic-agents service returned a non-JSON probe response."
        )

    name = (body or {}).get("name") or agent_id
    enabled = bool((body or {}).get("enabled", True))

    if not enabled:
        # The probe endpoint reports a ``disabled`` flag for completeness
        # even though the dynamic-agents service does not currently gate
        # on it. We surface this as a soft failure so operators see why
        # nothing is happening.
        return Acknowledgement(
            ack_status="warn",
            ack_detail=(
                f"Dynamic agent '{name}' is registered but disabled; "
                "scheduled runs will be invoked but the agent itself may "
                "refuse them."
            ),
            routed_to=agent_id,
            tools=[],
            available_agents=[],
            credentials_status={},
            dry_run_summary=(
                f"Will route to dynamic agent '{name}' (currently disabled)."
            ),
            ack_at=datetime.now(timezone.utc),
        )

    return Acknowledgement(
        ack_status="ok",
        ack_detail="Dynamic agent reachable; ready for scheduled execution.",
        routed_to=agent_id,
        tools=[],
        available_agents=[],
        credentials_status={},
        dry_run_summary=(
            f"At each scheduled run the prompt will be POSTed to the dynamic-"
            f"agents service /chat/invoke endpoint as agent '{name}' "
            f"(id={agent_id})."
        ),
        ack_at=datetime.now(timezone.utc),
    )
