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
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import httpx

from autonomous_agents.config import get_settings
from autonomous_agents.services.a2a_client import build_prompt_with_routing
from autonomous_agents.services.acknowledgement import Acknowledgement

logger = logging.getLogger("autonomous_agents")

__all__ = [
    "DynamicAgentsClientError",
    "DynamicAgentsNotConfiguredError",
    "invoke_dynamic_agent",
    "invoke_dynamic_agent_streaming",
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


# ----------------------------------------------------------------------
# Streaming variant — captures per-step events for chat-thread replay
# ----------------------------------------------------------------------
# Spec #099 / TODO ux-3: the sync ``invoke_dynamic_agent`` above returns
# only the final text and an empty events list, which means the UI's
# autonomous-task chat thread for dynamic-agent runs renders just a
# single bubble (no plan / tools / breakdown). This streaming variant
# closes that gap by:
#
#   1. Calling ``/api/v1/chat/stream/start`` with ``protocol=custom``.
#   2. Parsing the SSE event frames (``event: <type>\ndata: <json>\n\n``).
#   3. Translating each ``tool_start`` / ``tool_end`` / accumulated
#      ``content`` into the supervisor-flavoured A2A ``artifact-update``
#      shape that ``ui/src/lib/replay-timeline.ts`` already understands.
#
# The translation is deliberate -- the UI's replay logic is hard-wired
# to A2A artifact names (``tool_notification_start`` etc), and adding a
# parallel UI path for dynamic-agents events would mean tracking two
# event protocols in two places. By translating on the server side we
# get visual parity for the autonomous chat thread with zero UI
# changes. Live dynamic-agent chats continue to use the native dynamic-
# agents wire format end-to-end, so no behaviour shifts there.
#
# Known limitation accepted: the dynamic-agents ``custom`` SSE protocol
# does NOT emit plan-step events (they don't exist in the underlying
# DeepAgent stream for dynamic agents), so the chat-thread breakdown
# will show "Tool calls" + "Final answer" sections but no separate
# "Plan" section. This matches what live dynamic-agent chats show.


async def _iter_sse_events(response: httpx.Response) -> AsyncIterator[tuple[str, dict]]:
    """Yield ``(event_type, data_dict)`` tuples from an SSE response.

    Wire format (per dynamic-agents ``custom`` SSE encoder):

        event: <type>\\n
        data: <json>\\n
        \\n

    Empty line terminates a frame. Lines that don't match ``event:`` /
    ``data:`` are ignored. Malformed JSON is skipped (consistent with
    ``a2a_client.invoke_agent_streaming``'s tolerance for partial
    chunks). Returns the event name (defaulting to "message" if the
    sender omitted ``event:``) so the caller can dispatch on it.
    """
    current_event: str | None = None
    async for line in response.aiter_lines():
        if line == "":
            current_event = None
            continue
        if line.startswith("event:"):
            current_event = line[6:].strip()
            continue
        if line.startswith("data:"):
            raw = line[5:].lstrip()
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                # Ignore malformed chunks — same tolerance as the
                # supervisor SSE consumer in a2a_client.
                continue
            if not isinstance(data, dict):
                continue
            yield (current_event or "message", data)


def _translate_tool_start_to_a2a(
    data: dict,
    tool_name_by_call_id: dict[str, str],
) -> dict:
    """Translate a dynamic-agents ``tool_start`` event into A2A shape.

    Mirrors the supervisor's ``tool_notification_start`` artifact so
    ``buildTimelineSegmentsFromEvents`` (UI replay) can render the
    Tools panel identically. Mutates ``tool_name_by_call_id`` so the
    later ``tool_end`` translation can recover the tool name for the
    description string the UI parses.
    """
    tool_name = str(data.get("tool_name") or "")
    tool_call_id = str(data.get("tool_call_id") or "")
    args = data.get("args") or {}
    if tool_call_id and tool_name:
        tool_name_by_call_id[tool_call_id] = tool_name
    # Render the args into a text part so the UI's "Tool details"
    # affordance has something to show. JSON-stringify with default=str
    # to survive non-JSON-friendly values without raising.
    try:
        args_text = json.dumps(args, indent=2, default=str)
    except (TypeError, ValueError):
        args_text = f"<{len(args)} args (unserialisable)>"
    return {
        "kind": "artifact-update",
        "artifact": {
            "artifactId": tool_call_id,
            "name": "tool_notification_start",
            "description": f"Tool call started: {tool_name}",
            "parts": [{"kind": "text", "text": args_text}],
            "metadata": {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "source": "dynamic_agents",
            },
        },
    }


def _translate_tool_end_to_a2a(
    data: dict,
    tool_name_by_call_id: dict[str, str],
) -> dict:
    """Translate a dynamic-agents ``tool_end`` event into A2A shape.

    The UI's ``replay-timeline.ts`` matches tool end events back to
    their start by extracting the tool name from the artifact's
    ``description`` field via the regex
    ``/Tool call (?:completed|started):\\s*(.+)/i``. So we have to
    look up the tool name we cached from the matching ``tool_start``
    and put it into the description here -- the dynamic-agents
    ``tool_end`` payload only carries ``tool_call_id``.
    """
    tool_call_id = str(data.get("tool_call_id") or "")
    tool_name = tool_name_by_call_id.get(tool_call_id, "")
    error = data.get("error") or ""
    result = data.get("result") or ""
    body_text = error if error else result
    parts: list[dict[str, Any]] = []
    if isinstance(body_text, str) and body_text:
        parts.append({"kind": "text", "text": body_text})
    return {
        "kind": "artifact-update",
        "artifact": {
            "artifactId": tool_call_id,
            "name": "tool_notification_end",
            "description": f"Tool call completed: {tool_name}",
            "parts": parts,
            "metadata": {
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "error": bool(error),
                "source": "dynamic_agents",
            },
        },
    }


def _emit_final_result_event(text: str) -> dict:
    """Build a synthetic ``final_result`` A2A artifact for the accumulated text.

    The supervisor's streaming path emits ``final_result`` (or
    ``partial_result``) artifacts as the LLM streams its final answer,
    and ``replay-timeline.ts`` keys off ``artifact.name`` to push them
    into the FinalAnswer segment. The dynamic-agents service emits
    ``content`` chunks instead -- we accumulate them and emit a single
    synthetic ``final_result`` at the end so the UI replay renders an
    identical FinalAnswer block.
    """
    return {
        "kind": "artifact-update",
        "artifact": {
            "artifactId": "final_result",
            "name": "final_result",
            "parts": [{"kind": "text", "text": text}],
            "metadata": {"source": "dynamic_agents"},
        },
    }


async def invoke_dynamic_agent_streaming(
    *,
    prompt: str,
    task_id: str,
    agent_id: str,
    conversation_id: str | None = None,
    context: dict[str, Any] | None = None,
    timeout: float | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Invoke a dynamic agent via SSE streaming and return ``(content, events)``.

    Differs from :func:`invoke_dynamic_agent` in:

    * Uses ``/api/v1/chat/stream/start`` (SSE) with ``protocol=custom``
      instead of ``/chat/invoke`` (sync).
    * Parses the SSE stream and translates each per-step event into the
      supervisor-flavoured A2A ``artifact-update`` shape so the
      autonomous-task chat thread renders the Tools / Final-answer
      breakdown identically to supervisor-targeted runs (TODO ux-3).
    * The returned ``events`` list is non-empty (assuming the agent
      actually called any tools or produced any text), and lands on
      ``TaskRun.events`` via the scheduler.

    Errors map to the same ``DynamicAgentsClientError`` /
    ``DynamicAgentsNotConfiguredError`` as the sync variant so the
    scheduler's exception handling is identical.
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
    url = f"{base}/api/v1/chat/stream/start"
    full_prompt = build_prompt_with_routing(prompt, agent=None, context=context)
    body = {
        "message": full_prompt,
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "trace_id": task_id,
        # Pin the wire format. ``custom`` is what we have a translator
        # for; ``agui`` would need its own translation table.
        "protocol": "custom",
    }

    logger.info(
        "dynamic_agents_client.invoke_streaming: task=%s agent=%s url=%s timeout=%.1fs",
        task_id,
        agent_id,
        url,
        effective_timeout,
    )

    captured_events: list[dict[str, Any]] = []
    accumulated_text = ""
    tool_name_by_call_id: dict[str, str] = {}
    sse_error: str | None = None

    headers = {**_system_headers(), "Accept": "text/event-stream"}

    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            async with client.stream(
                "POST", url, json=body, headers=headers
            ) as response:
                if response.status_code == 404:
                    # Read the body so the connection is properly closed
                    # before we raise.
                    await response.aread()
                    raise DynamicAgentsClientError(
                        f"dynamic-agents service has no agent with id "
                        f"'{agent_id}' (HTTP 404 from {url})."
                    )
                if response.status_code >= 400:
                    await response.aread()
                    raise DynamicAgentsClientError(
                        f"dynamic-agents service returned HTTP "
                        f"{response.status_code} for agent '{agent_id}' on {url}."
                    )

                async for event_type, data in _iter_sse_events(response):
                    if event_type == "content":
                        text = data.get("text", "")
                        if isinstance(text, str):
                            accumulated_text += text
                    elif event_type == "tool_start":
                        captured_events.append(
                            _translate_tool_start_to_a2a(data, tool_name_by_call_id)
                        )
                    elif event_type == "tool_end":
                        captured_events.append(
                            _translate_tool_end_to_a2a(data, tool_name_by_call_id)
                        )
                    elif event_type == "error":
                        sse_error = str(data.get("error") or "Unknown SSE error")
                        # Don't break the loop -- let the upstream send
                        # ``done`` so the connection closes cleanly.
                    elif event_type == "done":
                        break
                    # Ignore: warning, input_required (HITL not supported
                    # in the autonomous-task path; the run can't pause
                    # mid-flight for an operator response).
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise DynamicAgentsClientError(
            f"dynamic-agents service at {url} did not respond: {exc}"
        ) from exc
    except httpx.HTTPStatusError as exc:
        # raise_for_status fallback path (some httpx versions raise
        # HTTPStatusError outside the .stream() context-manager body).
        if exc.response.status_code == 404:
            raise DynamicAgentsClientError(
                f"dynamic-agents service has no agent with id '{agent_id}' "
                f"(HTTP 404 from {url})."
            ) from exc
        raise DynamicAgentsClientError(
            f"dynamic-agents service returned HTTP "
            f"{exc.response.status_code} for agent '{agent_id}' on {url}."
        ) from exc

    if sse_error:
        raise DynamicAgentsClientError(
            f"dynamic-agents service streaming error: {sse_error}"
        )

    if not accumulated_text:
        accumulated_text = "(dynamic agent returned no text content)"

    # Append a synthetic final_result artifact mirroring the supervisor's
    # streaming path, so the UI replay's FinalAnswer segment is populated
    # for dynamic-agent runs the same way it is for supervisor-targeted
    # runs.
    captured_events.append(_emit_final_result_event(accumulated_text))

    logger.info(
        "dynamic_agents_client.invoke_streaming complete: task=%s "
        "events=%d, %d chars of final text",
        task_id,
        len(captured_events),
        len(accumulated_text),
    )
    return accumulated_text, captured_events


async def preflight_dynamic_agent(
    *,
    agent_id: str,
    timeout: float | None = None,
) -> Acknowledgement:
    """Probe the dynamic-agents service to verify ``agent_id`` exists.

    Mirrors ``services.supervisor_preflight.preflight`` for the dynamic-agent
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
