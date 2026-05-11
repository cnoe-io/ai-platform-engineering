"""A2A client — sends tasks to the CAIPE supervisor agent.

Transport reliability
---------------------
The supervisor is just another HTTP service: it can be restarted, fall over
behind a load balancer, or briefly hit OOM. We retry on the failure modes
that are *transient* (5xx + connection/transport errors) and never on the
ones that are caller-fault (4xx). 4xx means the request itself is bad —
auth, validation, missing route — and replaying it would only burn quota
without changing the outcome.

The retry policy is configurable via ``Settings.a2a_max_retries`` and
``Settings.a2a_timeout_seconds``, with optional per-call overrides supplied
by the scheduler (``TaskDefinition.max_retries`` / ``timeout_seconds``).

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
from tenacity import (
    AsyncRetrying,
    RetryError,
    before_sleep_log,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
)

from autonomous_agents.config import get_settings
from autonomous_agents.services.circuit_breaker import (
    CircuitBreakerOpenError,
    get_circuit_breaker,
)

logger = logging.getLogger("autonomous_agents")

__all__ = [
    "invoke_agent",
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
    ``invoke_agent`` calls it for ``message.metadata.agent`` so the two
    can never disagree (Copilot review on PR #13). The empty-string
    return value is the unambiguous "no hint" signal.

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


async def _post_once(
    *,
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
) -> httpx.Response:
    """Single HTTP attempt — separated so tenacity can retry it cleanly.

    The ``client`` is owned by the caller (``invoke_agent``) so that the
    same HTTP connection pool is reused across retry attempts within a
    single ``invoke_agent`` call. Otherwise every retry would pay TCP
    handshake + TLS setup for a brand-new socket, defeating httpx's
    keep-alive entirely.
    """
    response = await client.post(url, json=payload)
    # raise_for_status inside the retry boundary so 5xx triggers a retry
    # via the HTTPStatusError branch in _is_retryable_exception.
    response.raise_for_status()
    return response


async def invoke_agent(
    prompt: str,
    task_id: str,
    agent: str | None = None,
    llm_provider: str | None = None,
    context: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
    max_retries: int | None = None,
) -> str:
    """Send a prompt to the CAIPE supervisor via the A2A protocol.

    Returns the agent's text response, or raises on failure.

    The A2A message format follows the Google A2A spec:
    https://google.github.io/A2A/

    Parameters
    ----------
    timeout_seconds:
        Overrides ``Settings.a2a_timeout_seconds`` for this single call.
        Useful when the scheduler knows a particular task is long-running.
    max_retries:
        Overrides ``Settings.a2a_max_retries`` for this single call. Set
        to 0 to force a single attempt with no retries.
    """
    settings = get_settings()
    message_id = str(uuid.uuid4())

    effective_timeout = timeout_seconds if timeout_seconds is not None else settings.a2a_timeout_seconds
    effective_max_retries = max_retries if max_retries is not None else settings.a2a_max_retries

    # Prepend the in-band routing directive when an agent hint was
    # supplied, then append any context block. See
    # ``build_prompt_with_routing`` for the rationale -- short version:
    # the supervisor LLM router does not read ``message.metadata.agent``,
    # so without this directive the UI's agent-picker is cosmetic.
    full_prompt = build_prompt_with_routing(prompt, agent=agent, context=context)

    # Normalise once and reuse for metadata so the directive (above)
    # and the structured metadata (below) cannot disagree on what the
    # operator asked for. Whitespace-only or all-junk agent values
    # produce an empty hint, in which case we omit ``metadata.agent``
    # entirely rather than send a misleading whitespace value
    # (Copilot review on PR #13).
    agent_hint = _normalize_agent_hint(agent)

    # We still attach the structured metadata. The supervisor ignores
    # ``agent`` / ``llm_provider`` keys today (only ``user_id`` /
    # ``user_email`` are honoured) but sending them costs nothing and
    # keeps us forward-compat with a future supervisor change that
    # adds structured fast-path routing.
    metadata: dict[str, Any] = {}
    if agent_hint:
        metadata["agent"] = agent_hint
    effective_llm = llm_provider or settings.llm_provider
    if effective_llm:
        metadata["llm_provider"] = effective_llm

    # Supervisor (a2a-sdk >=0.3) requires contextId to be a valid UUID. Derive
    # a deterministic UUIDv5 per task so the supervisor's checkpointer keeps
    # one conversation thread per autonomous task across runs while still
    # validating as a proper UUID.
    context_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"autonomous-task:{task_id}"))
    message: dict[str, Any] = {
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
        "method": "message/send",
        "params": {
            "message": message,
            "configuration": {
                "blocking": True,
                "acceptedOutputModes": ["text"],
            },
        },
    }

    logger.info(
        f"Invoking supervisor at {settings.supervisor_url} for task '{task_id}' "
        f"(agent_hint={agent_hint!r}, raw_agent={agent!r}, "
        f"llm_provider={effective_llm!r}, "
        f"timeout={effective_timeout}s, max_retries={effective_max_retries})"
    )

    # tenacity stop_after_attempt counts the *initial* attempt, so total
    # attempts = 1 + max_retries.
    retrying = AsyncRetrying(
        stop=stop_after_attempt(1 + effective_max_retries),
        wait=wait_exponential_jitter(
            initial=settings.a2a_retry_backoff_initial_seconds,
            max=settings.a2a_retry_backoff_max_seconds,
        ),
        retry=retry_if_exception(_is_retryable_exception),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )

    # IMP-16: gate the call through the circuit breaker. If the breaker
    # is OPEN we short-circuit *before* opening a connection, which is
    # the whole point -- a broken supervisor must not see traffic from
    # every scheduled run multiplied by the retry budget. CircuitBreakerOpenError
    # propagates to the scheduler and is recorded as the run failure
    # reason, which is much more actionable than a generic timeout.
    breaker = await get_circuit_breaker()
    await breaker.before_call(settings.supervisor_url)

    # One client per invoke_agent call, reused across retries. The
    # per-attempt timeout lives on the client (so each retry honours it)
    # and the pool is torn down once the call completes.
    try:
        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            async for attempt in retrying:
                with attempt:
                    response = await _post_once(
                        client=client,
                        url=settings.supervisor_url,
                        payload=payload,
                    )
    except RetryError as exc:
        # reraise=True normally surfaces the underlying exception, but keep
        # this branch defensively for older tenacity behaviour.
        underlying = exc.last_attempt.exception()
        if _is_retryable_exception(underlying):
            await breaker.record_failure(settings.supervisor_url)
        else:
            # Non-retryable underlying error (e.g. wrapped 4xx). Don't
            # count it as supervisor-sick, but DO release the HALF_OPEN
            # trial slot so the next legitimate caller isn't blocked
            # behind a phantom trial.
            await breaker.release_trial(settings.supervisor_url)
        raise underlying from exc  # pragma: no cover
    except (httpx.TransportError, httpx.HTTPStatusError) as exc:
        # Retries exhausted (or first attempt with retries=0). Count one
        # failure against the breaker -- *not* one per attempt -- so a
        # request that succeeds on retry leaves the breaker at zero.
        # Only "supervisor-is-sick" failures count: 4xx is caller-fault
        # (auth/validation/missing route) and would self-DoS the breaker
        # on a misconfigured task. We piggy-back on the same retryable-
        # classification used above so the two policies stay in sync.
        if _is_retryable_exception(exc):
            await breaker.record_failure(settings.supervisor_url)
        else:
            # 4xx -- release the HALF_OPEN trial slot (if any) without
            # tripping the breaker. See the RetryError branch above.
            await breaker.release_trial(settings.supervisor_url)
        raise exc

    # Transport call succeeded -- close the breaker if it was tripped.
    # We treat HTTP success as supervisor-is-healthy even if the JSON-RPC
    # ``error`` branch fires below, because that's an application-level
    # error, not a connectivity / availability problem.
    await breaker.record_success(settings.supervisor_url)

    result = response.json()

    if "error" in result:
        raise RuntimeError(f"A2A error from supervisor: {result['error']}")

    # Extract text from A2A response using the same 3-step fallback as
    # utils/a2a_common/a2a_remote_agent_connect.py:
    #   1. artifacts[].parts — most agents return results here
    #   2. status.message.parts — used by some agents for final replies
    #   3. history[] last agent message — fallback when neither above is populated
    try:
        task_result = result["result"]

        # 1. Artifacts
        for artifact in task_result.get("artifacts", []):
            texts = [p["text"] for p in artifact.get("parts", []) if p.get("kind") == "text" and p.get("text")]
            if texts:
                return " ".join(texts).strip()

        # 2. Status message parts
        status_parts = task_result.get("status", {}).get("message", {}).get("parts", [])
        texts = [p["text"] for p in status_parts if p.get("kind") == "text" and p.get("text")]
        if texts:
            return " ".join(texts).strip()

        # 3. History — last agent message (skip tool-status emoji lines)
        for message in reversed(task_result.get("history", [])):
            if message.get("role") != "agent":
                continue
            texts = [
                p["text"]
                for p in message.get("parts", [])
                if p.get("kind") == "text"
                and p.get("text")
                and not p["text"].startswith(("🔧", "✅"))
            ]
            if texts:
                return " ".join(texts).strip()

    except (KeyError, TypeError):
        pass

    logger.warning(f"Unexpected A2A response shape: {result}")
    raise RuntimeError(f"Could not extract text from A2A response: {result}")


# ---------------------------------------------------------------------------
# Streaming variant (Phase B — spec #099 Story 2)
# ---------------------------------------------------------------------------
#
# The blocking ``invoke_agent`` above gives us only the final text. The chat
# UI's regular flow consumes the supervisor's *streaming* events (artifacts:
# execution_plan_update, tool_notification_*, streaming_result, final_result)
# and turns them into the rich plan / tools / timeline a typed-message reply
# renders with. Until now scheduled fires went through the blocking path and
# the chat thread showed only a 500-char preview — a one-line tombstone of
# what was actually a multi-step workflow.
#
# ``invoke_agent_streaming`` switches the wire call to ``message/stream``
# (Server-Sent Events) and:
#   1. captures every raw A2A event the supervisor emits, AND
#   2. accumulates the final plain-text response from ``final_result`` /
#      ``partial_result`` artifacts so the existing run_store + chat
#      publisher contract (which expects a single string response) keeps
#      working without a schema change for non-streaming callers.
#
# Captured events are returned as a list of plain dicts (already JSON-safe
# because they came in as JSON over SSE). The scheduler persists them on
# the TaskRun; the UI synthesizer replays them so past scheduled runs
# render with the same rich UI a typed message gets.


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

    Differences vs. ``invoke_agent``:

    * No tenacity retry loop. SSE streams aren't safely resumable
      mid-flight; if the connection breaks we surface that immediately
      and the caller marks the run failed. The next scheduled fire is
      a fresh attempt.
    * No circuit breaker. The breaker exists to protect against fan-out
      against a sick supervisor; a single scheduled run isn't fan-out.
      We don't want the breaker to also gate streaming.
    * Same contextId derivation (UUIDv5 per task) so the supervisor's
      checkpointer keeps a single thread across typed and scheduled
      messages.
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
        raise RuntimeError(f"Supervisor returned HTTP {exc.response.status_code}") from exc
    except httpx.TransportError as exc:
        raise RuntimeError(f"Supervisor unreachable: {exc}") from exc

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
