"""A2A client — sends tasks to the CAIPE supervisor agent.

Public entry point: :func:`invoke_agent_streaming`. It opens a Server-Sent
Events stream against the supervisor's ``message/stream`` endpoint, captures
every raw A2A event, and returns ``(final_text, captured_events)``. The chat
UI synthesizer replays ``captured_events`` so past scheduled runs render with
the same rich plan / tools / timeline UI that a typed message gets.

Reliability
-----------
The supervisor is just another HTTP service: it can be restarted, fall over
behind a load balancer, or briefly hit OOM. We protect against a *sustained*
outage with a per-URL circuit breaker (see ``services/circuit_breaker.py``).
There is intentionally **no retry layer**:

* SSE streams aren't safely resumable mid-flight, so a mid-stream break is
  surfaced immediately and the next scheduled fire is a fresh attempt.
* Pre-stream transient errors (TLS reset, brief 503, DNS hiccup) consume one
  breaker failure each. With ``CIRCUIT_BREAKER_FAILURE_THRESHOLD=5``
  (default) the breaker absorbs occasional flakes; sustained failures trip
  it after 5 in a row.

5xx and ``httpx.TransportError`` count as supervisor-sick (record_failure).
4xx is caller-fault (release_trial without tripping). In-band JSON-RPC
errors over a successful HTTP stream are application-level (release_trial)
since HTTP succeeded → supervisor connectivity is healthy.

Agent routing hint
------------------
The autonomous-tasks UI lets the operator pick a target sub-agent (e.g.
``github``, ``argocd``) per task. We surface that choice to the supervisor
two ways and intentionally so:

1. **In-band prompt directive** — when ``agent`` is set we prepend a short,
   clearly-demarcated ``[Routing directive: ...]`` line to the prompt. The
   supervisor today is a Deep Agent whose router is an LLM that reads the
   prompt text -- it does **not** read ``message.metadata.agent``. The
   directive is the only way to actually pin routing today, otherwise the
   UI agent-picker is purely cosmetic. The directive is permissive
   (``unless the request cannot be fulfilled``) so a misconfigured task
   name degrades gracefully into normal LLM routing instead of hard-
   failing.

2. **Out-of-band metadata** — we still send ``metadata.agent`` and
   ``metadata.llm_provider`` on the A2A message even though the supervisor
   ignores them today. They cost nothing on the wire and are already in
   place for a future supervisor change that adds structured fast-path
   routing (would skip the LLM router round-trip entirely).
"""

import json
import logging
import re
import uuid
from typing import Any

import httpx

from autonomous_agents.config import get_settings
from autonomous_agents.services.circuit_breaker import (
    CircuitBreakerOpenError,
    get_circuit_breaker,
)

logger = logging.getLogger("autonomous_agents")

__all__ = [
    "invoke_agent_streaming",
    "CircuitBreakerOpenError",
    "build_prompt_with_routing",
]


# Allow-list of characters permitted in a sub-agent identifier for the
# purposes of the in-band routing directive. Real agent ids in CAIPE are
# things like ``github``, ``argo-cd``, ``aws_bedrock``; alphanumerics
# plus ``-``, ``_``, ``.`` covers every existing case while making it
# impossible for a malicious or buggy task definition to inject prose,
# newlines, brackets, or backticks into the directive text. Anything
# outside the allow-list is dropped (rather than escaped) so the
# directive stays human-readable in supervisor logs.
_AGENT_HINT_ALLOWED = re.compile(r"[^A-Za-z0-9._-]")

# Hard cap on the resulting hint length. Prevents a pathological
# config (e.g. a 100KB string in the agent field) from inflating every
# outbound prompt and -- worse -- from drowning the actual user prompt
# behind boilerplate. 64 chars is generous: the longest CAIPE agent id
# in use is ``rag-knowledge-bases`` at 19 chars.
_AGENT_HINT_MAX_LEN = 64


def _normalize_agent_hint(agent: str | None) -> str:
    """Return a routing-safe version of ``agent`` for use everywhere.

    Single source of truth for "what counts as a usable agent hint":
    ``build_prompt_with_routing`` calls this for the directive AND
    ``invoke_agent_streaming`` calls it for ``message.metadata.agent`` so
    the two can never disagree (Copilot review on PR #13). The empty-
    string return value is the unambiguous "no hint" signal.

    Steps:
        1. ``None`` or non-str -> ``""``.
        2. Strip leading/trailing whitespace.
        3. Drop any character outside ``[A-Za-z0-9._-]``. This both
           normalises operator typos (``"GitHub "`` -> ``"GitHub"``)
           and neutralises prompt-injection attempts that try to smuggle
           newlines, backticks, or ``]`` into the directive text.
        4. Truncate to ``_AGENT_HINT_MAX_LEN`` chars.
    """
    if not isinstance(agent, str):
        return ""
    cleaned = _AGENT_HINT_ALLOWED.sub("", agent.strip())
    return cleaned[:_AGENT_HINT_MAX_LEN]


def build_prompt_with_routing(
    prompt: str,
    *,
    agent: str | None,
    context: dict[str, Any] | None = None,
) -> str:
    """Compose the final text payload sent to the supervisor.

    Layout, in order:

        [Routing directive: ...]   (only if ``agent`` is set)
        <prompt>
        Context:                   (only if ``context`` is non-empty)
        <pretty-printed JSON>

    The routing directive exists because the supervisor LLM reads it as
    part of the user message and treats it as an operator instruction to
    delegate to that sub-agent. Without this, the UI's agent-picker is
    decorative -- the supervisor doesn't read ``message.metadata.agent``
    and would pick a sub-agent purely from the prompt text.

    The directive is intentionally permissive ("unless the request
    cannot be fulfilled by that sub-agent") so a typo in the agent
    name -- or a prompt that genuinely needs a different sub-agent --
    degrades into normal routing instead of a hard failure. That
    matches the behaviour operators expect from a hint, not a hard
    constraint.

    Edge cases:
        * ``agent`` is None, empty/whitespace, or contains *only*
          characters outside the identifier allow-list -> no directive
          (some tasks intentionally let the LLM route).
        * ``context`` is None or empty -> no Context block.
        * Both empty -> returns ``prompt`` unchanged so this remains a
          drop-in for callers that don't care about routing.

    Sanitisation: the agent identifier is constrained to
    ``[A-Za-z0-9._-]`` via ``_normalize_agent_hint`` before
    interpolation. This keeps a malicious or typo'd agent name (e.g.
    one containing newlines, backticks, or ``]``) from breaking out of
    the directive and injecting additional instructions into the
    supervisor prompt. See the helper for details.
    """
    parts: list[str] = []

    agent_clean = _normalize_agent_hint(agent)
    if agent_clean:
        # Backticks help the supervisor parser distinguish the sub-agent
        # identifier from prose. The "unless cannot be fulfilled" escape
        # hatch keeps a misconfigured task graceful. ``agent_clean`` is
        # already restricted to a safe character class so the f-string
        # cannot be used to break out of the directive.
        parts.append(
            f"[Routing directive: This task is targeted at the `{agent_clean}` "
            f"sub-agent. Delegate to that sub-agent unless the request cannot "
            f"be fulfilled by it.]"
        )

    parts.append(prompt)

    if context:
        parts.append(f"Context:\n{json.dumps(context, indent=2)}")

    return "\n\n".join(parts)


def _is_retryable_exception(exc: BaseException) -> bool:
    """Return True if ``exc`` represents a transient supervisor failure.

    Retryable:
        * ``httpx.TransportError`` — connection refused, DNS failure,
          read timeout, etc. The supervisor never produced a response.
        * ``httpx.HTTPStatusError`` with status code >= 500 — the
          supervisor responded but is itself unhealthy.

    Not retryable:
        * ``httpx.HTTPStatusError`` with 4xx — caller-side bug (bad
          payload, auth failure, unknown route). Retrying is wasted work.
        * Anything else — let it propagate so we don't paper over real
          bugs (validation errors, programming errors, etc.).
    """
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
    return False



def _extract_text_from_artifact(artifact: dict[str, Any]) -> str:
    """Pull the text body out of an A2A artifact's parts. Empty string if none."""
    parts = artifact.get("parts", []) or []
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        # New SDK: {"kind": "text", "text": "..."}
        if part.get("kind") == "text" and part.get("text"):
            texts.append(part["text"])
            continue
        # Some intermediaries wrap as {"root": {"text": "..."}}
        root = part.get("root")
        if isinstance(root, dict) and root.get("text"):
            texts.append(root["text"])
    return "".join(texts)


async def invoke_agent_streaming(
    prompt: str,
    task_id: str,
    agent: str | None = None,
    llm_provider: str | None = None,
    context: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Stream from the supervisor; return ``(final_text, events)``.

    Events is the list of raw A2A ``result`` payloads as they arrive over
    SSE — exactly the shape the UI's a2a-sdk client consumes, just collected
    server-side so it can be replayed on chat-thread reload. ``final_text``
    is the concatenation of the most recent ``final_result``/``partial_result``
    artifact text bodies, so existing single-string consumers (run_store,
    chat publisher, response_preview) keep working without churn.

    Reliability semantics
    ---------------------
    * **No mid-stream retry.** SSE isn't safely resumable mid-flight; if
      the connection breaks we surface that immediately and the caller
      marks the run failed. The next scheduled fire is a fresh attempt.
    * **No pre-stream retry either.** A single transient pre-stream error
      (TLS reset, brief 503, DNS hiccup) consumes one breaker failure
      directly. With ``circuit_breaker_failure_threshold=5`` (default),
      occasional flakes are absorbed; sustained failures trip the breaker
      after 5 consecutive ones, which is the intended behaviour.
    * **Circuit breaker is gated on every call.** 5xx and transport
      errors count toward the breaker threshold (recorded via
      ``record_failure``); 4xx releases the HALF_OPEN trial slot
      without tripping (caller-fault, not supervisor-sick). In-band
      JSON-RPC errors arriving over an otherwise-successful HTTP
      stream are treated as application-level errors -- HTTP succeeded
      so supervisor connectivity is healthy -- so they release the
      trial slot rather than count as failures. The leak-guard window
      for HALF_OPEN trials is auto-tuned to the streaming timeout in
      :func:`get_circuit_breaker` so a long-but-healthy trial doesn't
      get its slot reclaimed mid-flight.
    * Same contextId derivation (UUIDv5 per task) as the legacy blocking
      path, so the supervisor's checkpointer keeps a single thread
      across typed and scheduled messages.
    """
    settings = get_settings()
    message_id = str(uuid.uuid4())
    effective_timeout = timeout_seconds if timeout_seconds is not None else settings.a2a_timeout_seconds

    full_prompt = build_prompt_with_routing(prompt, agent=agent, context=context)
    agent_hint = _normalize_agent_hint(agent)
    metadata: dict[str, Any] = {}
    if agent_hint:
        metadata["agent"] = agent_hint
    effective_llm = llm_provider or settings.llm_provider
    if effective_llm:
        metadata["llm_provider"] = effective_llm

    context_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"autonomous-task:{task_id}"))
    message: dict[str, Any] = {
        "kind": "message",
        "role": "user",
        "parts": [{"kind": "text", "text": full_prompt}],
        "messageId": message_id,
        "contextId": context_uuid,
    }
    if metadata:
        message["metadata"] = metadata

    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/stream",
        "params": {"message": message},
    }

    logger.info(
        f"Streaming supervisor at {settings.supervisor_url} for task '{task_id}' "
        f"(agent_hint={agent_hint!r}, llm_provider={effective_llm!r}, "
        f"timeout={effective_timeout}s)"
    )

    captured_events: list[dict[str, Any]] = []
    accumulated_text = ""

    # Gate the call through the circuit breaker before opening any
    # connection. ``CircuitBreakerOpenError`` propagates to
    # ``task_runner.execute_task`` which records it as the run's
    # ``error`` field -- a much more actionable signal than a generic
    # timeout would be.
    breaker = await get_circuit_breaker()
    await breaker.before_call(settings.supervisor_url)

    # SSE consumption: each event is `data: {jsonrpc envelope}\n\n`. We
    # parse line-by-line because httpx's aiter_lines already handles the
    # transport-level line splitting; we just need to skip blanks and
    # event/id fields, take only the data: lines, parse each as JSON.
    headers = {"Accept": "text/event-stream"}
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            async with client.stream(
                "POST", settings.supervisor_url, json=payload, headers=headers,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[5:].lstrip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        envelope = json.loads(raw)
                    except json.JSONDecodeError:
                        # Skip malformed SSE chunks rather than abort the
                        # stream; the supervisor very occasionally emits a
                        # partial chunk on the wire that's resolved on the
                        # next event.
                        continue
                    if "error" in envelope:
                        raise RuntimeError(
                            f"A2A error from supervisor stream: {envelope['error']}"
                        )
                    result = envelope.get("result")
                    if not isinstance(result, dict):
                        continue
                    captured_events.append(result)
                    # Accumulate final text from artifact-update events that
                    # carry final_result / partial_result. Streaming-only
                    # artifacts (streaming_result, tool_notification_*) are
                    # captured for replay but don't update the final text.
                    if result.get("kind") == "artifact-update":
                        artifact = result.get("artifact") or {}
                        artifact_name = artifact.get("name", "")
                        if artifact_name in ("final_result", "partial_result"):
                            text = _extract_text_from_artifact(artifact)
                            if text:
                                # Successive final_result events with the
                                # same artifact_id are the SDK's "replace"
                                # semantics — treat the latest as truth.
                                accumulated_text = text
    except httpx.HTTPStatusError as exc:
        # Reuse the same classifier the (legacy) blocking path uses so the
        # two policies can't drift on what counts as supervisor-sick vs
        # caller-fault. 5xx -> count toward the breaker threshold; 4xx ->
        # release the HALF_OPEN trial slot without tripping (caller-fault
        # would otherwise self-DoS the breaker on a misconfigured task).
        if _is_retryable_exception(exc):
            await breaker.record_failure(settings.supervisor_url)
        else:
            await breaker.release_trial(settings.supervisor_url)
        raise RuntimeError(f"Supervisor returned HTTP {exc.response.status_code}") from exc
    except httpx.TransportError as exc:
        # Connection/transport failure -- supervisor is unreachable.
        await breaker.record_failure(settings.supervisor_url)
        raise RuntimeError(f"Supervisor unreachable: {exc}") from exc
    except RuntimeError:
        # In-band JSON-RPC error envelope arriving over an otherwise-
        # successful HTTP stream. HTTP succeeded so supervisor connectivity
        # is fine -- this is an application-level failure. Release the
        # HALF_OPEN trial slot without tripping the breaker. (Same
        # decision the blocking path makes; documented here so it's not
        # an undocumented invariant.)
        await breaker.release_trial(settings.supervisor_url)
        raise

    # Stream completed cleanly -- supervisor is healthy from a transport
    # / availability perspective. Close the breaker if it was tripped.
    await breaker.record_success(settings.supervisor_url)

    if not accumulated_text:
        # Stream completed without yielding a final/partial result. Fall
        # back to scanning the captured events for any text we can show
        # the operator.
        for event in reversed(captured_events):
            artifact = (event.get("artifact") or {}) if event.get("kind") == "artifact-update" else {}
            text = _extract_text_from_artifact(artifact)
            if text:
                accumulated_text = text
                break

    if not accumulated_text:
        accumulated_text = "(supervisor returned no text content)"

    logger.info(
        f"Streaming complete for task '{task_id}': {len(captured_events)} events, "
        f"{len(accumulated_text)} chars of final text"
    )
    return accumulated_text, captured_events
