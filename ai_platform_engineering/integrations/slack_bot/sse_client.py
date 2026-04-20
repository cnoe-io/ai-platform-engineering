# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
SSE client for Dynamic Agents streaming via AG-UI protocol.

Routes requests through the Next.js API gateway which proxies to the
dynamic agents backend.  Uses flat ``/api/v1/chat/`` routes with all
parameters (including ``conversation_id`` and ``protocol``) in the
request body.  Uses httpx for streaming HTTP requests.
"""

import json
import uuid
from typing import Any, Dict, Iterator, Optional

import httpx
from loguru import logger

# Deterministic namespace for Slack conversation IDs.
# uuid5(NAMESPACE_URL, "slack.caipe.io") — fixed constant.
SLACK_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "slack.caipe.io")


def thread_ts_to_conversation_id(thread_ts: str) -> str:
  """Convert a Slack thread_ts to a deterministic conversation UUID.

  Same thread_ts always produces the same UUID v5.

  Args:
      thread_ts: Slack thread timestamp string.

  Returns:
      UUID v5 string derived from thread_ts.
  """
  return str(uuid.uuid5(SLACK_NAMESPACE, thread_ts))


class SSEEventType(str):
  """AG-UI event types (mirrors ag_ui.core.EventType)."""

  RUN_STARTED = "RUN_STARTED"
  RUN_FINISHED = "RUN_FINISHED"
  RUN_ERROR = "RUN_ERROR"
  STEP_STARTED = "STEP_STARTED"
  STEP_FINISHED = "STEP_FINISHED"
  TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
  TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
  TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
  TOOL_CALL_START = "TOOL_CALL_START"
  TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
  TOOL_CALL_END = "TOOL_CALL_END"
  STATE_SNAPSHOT = "STATE_SNAPSHOT"
  STATE_DELTA = "STATE_DELTA"
  CUSTOM = "CUSTOM"
  RAW = "RAW"

  # Set of known types for validation
  _KNOWN = {
    "RUN_STARTED",
    "RUN_FINISHED",
    "RUN_ERROR",
    "STEP_STARTED",
    "STEP_FINISHED",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "TOOL_CALL_START",
    "TOOL_CALL_ARGS",
    "TOOL_CALL_END",
    "STATE_SNAPSHOT",
    "STATE_DELTA",
    "CUSTOM",
    "RAW",
  }

  @classmethod
  def is_known(cls, value: str) -> bool:
    """Check if a string is a known AG-UI event type."""
    return value in cls._KNOWN


class SSEEvent:
  """Parsed AG-UI Server-Sent Event."""

  __slots__ = (
    "type",
    "delta",
    "message_id",
    "tool_call_id",
    "tool_call_name",
    "steps",
    "snapshot",
    "name",
    "value",
    "run_id",
    "thread_id",
    "message",
    "outcome",
    "interrupt",
  )

  def __init__(
    self,
    type: str,
    delta: Optional[str] = None,
    message_id: Optional[str] = None,
    tool_call_id: Optional[str] = None,
    tool_call_name: Optional[str] = None,
    steps: Optional[list] = None,
    snapshot: Optional[dict] = None,
    name: Optional[str] = None,
    value: Optional[Any] = None,
    run_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    message: Optional[str] = None,
    outcome: Optional[str] = None,
    interrupt: Optional[dict] = None,
  ):
    self.type = type
    self.delta = delta
    self.message_id = message_id
    self.tool_call_id = tool_call_id
    self.tool_call_name = tool_call_name
    self.steps = steps
    self.snapshot = snapshot
    self.name = name
    self.value = value
    self.run_id = run_id
    self.thread_id = thread_id
    self.message = message
    self.outcome = outcome
    self.interrupt = interrupt


class SSEClient:
  """SSE client for Dynamic Agents streaming via AG-UI protocol.

  Routes through the Next.js API gateway (flat paths, all params in body):
  - stream_chat(): POST /api/v1/chat/stream/start (SSE stream)
  - invoke(): POST /api/v1/chat/invoke (JSON response)
  - resume_stream(): POST /api/v1/chat/stream/resume (SSE stream)
  """

  def __init__(self, base_url: str, timeout: int = 300, auth_client: Optional[Any] = None):
    """Initialize SSE client.

    Args:
        base_url: CAIPE API URL (e.g. http://caipe-ui:3000).
        timeout: Streaming timeout in seconds.
        auth_client: Optional OAuth2ClientCredentials instance for Bearer tokens.
    """
    self.base_url = base_url.rstrip("/")
    self.timeout = timeout
    self.auth_client = auth_client

  def _get_headers(self) -> Dict[str, str]:
    """Build request headers with auth and client source."""
    headers = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "X-Client-Source": "slack-bot",
      "User-Agent": "caipe-slack-bot/0.4.0",
    }
    if self.auth_client:
      token = self.auth_client.get_access_token()
      headers["Authorization"] = f"Bearer {token}"
    return headers

  def stream_chat(
    self,
    message: str,
    conversation_id: str,
    agent_id: str,
    trace_id: Optional[str] = None,
    client_context: Optional[Dict[str, Any]] = None,
  ) -> Iterator[SSEEvent]:
    """Stream a chat response from a dynamic agent.

    Args:
        message: User's message text.
        conversation_id: UUID v5 from thread_ts.
        agent_id: Dynamic agent config ID.
        trace_id: Optional Langfuse trace ID.
        client_context: Optional client context dict for system prompt rendering.

    Yields:
        SSEEvent objects for each AG-UI event.

    Raises:
        Exception: On connection or HTTP errors.
    """
    payload = {
      "message": message,
      "conversation_id": conversation_id,
      "agent_id": agent_id,
      "protocol": "agui",
      "trace_id": trace_id,
    }
    if client_context:
      payload["client_context"] = client_context

    url = f"{self.base_url}/api/v1/chat/stream/start"
    yield from self._stream_sse(url, payload)

  def resume_stream(
    self,
    agent_id: str,
    conversation_id: str,
    form_data: str,
    trace_id: Optional[str] = None,
    client_context: Optional[Dict[str, Any]] = None,
  ) -> Iterator[SSEEvent]:
    """Resume a stream after HITL interrupt.

    Args:
        agent_id: Same agent_id as the interrupted stream.
        conversation_id: Same conversation_id as the interrupted stream.
        form_data: JSON string of form field values, or rejection message.
        trace_id: Optional Langfuse trace ID.
        client_context: Optional client context dict for system prompt rendering.

    Yields:
        SSEEvent objects for the resumed stream.

    Raises:
        Exception: On connection or HTTP errors.
    """
    payload = {
      "conversation_id": conversation_id,
      "agent_id": agent_id,
      "form_data": form_data,
      "protocol": "agui",
      "trace_id": trace_id,
    }
    if client_context:
      payload["client_context"] = client_context

    url = f"{self.base_url}/api/v1/chat/stream/resume"
    yield from self._stream_sse(url, payload)

  def invoke(
    self,
    message: str,
    conversation_id: str,
    agent_id: str,
    trace_id: Optional[str] = None,
    client_context: Optional[Dict[str, Any]] = None,
  ) -> Dict[str, Any]:
    """Non-streaming chat invocation for bot users.

    Args:
        message: User's message text.
        conversation_id: UUID v5 from thread_ts.
        agent_id: Dynamic agent config ID.
        trace_id: Optional Langfuse trace ID.
        client_context: Optional client context dict for system prompt rendering.

    Returns:
        Response dict with 'success', 'content', etc.

    Raises:
        Exception: On connection or HTTP errors.
    """
    payload = {
      "message": message,
      "conversation_id": conversation_id,
      "agent_id": agent_id,
      "trace_id": trace_id,
    }
    if client_context:
      payload["client_context"] = client_context

    headers = self._get_headers()
    headers["Accept"] = "application/json"

    url = f"{self.base_url}/api/v1/chat/invoke"

    try:
      with httpx.Client(timeout=self.timeout) as client:
        response = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as e:
      raise Exception(f"Failed to connect to invoke endpoint at {url}: {e}")

    if not response.is_success:
      raise Exception(f"Invoke request failed: {response.status_code} {response.text}")

    return response.json()

  def _stream_sse(self, url: str, payload: Dict[str, Any]) -> Iterator[SSEEvent]:
    """Internal: POST to an SSE endpoint and yield parsed events.

    Args:
        url: Full endpoint URL.
        payload: JSON request body (includes protocol, conversation_id, etc.).

    Yields:
        SSEEvent objects.
    """
    try:
      with httpx.Client(timeout=self.timeout) as client:
        with client.stream(
          "POST",
          url,
          json=payload,
          headers=self._get_headers(),
        ) as response:
          if not response.is_success:
            error_text = response.read().decode()
            raise Exception(f"SSE request failed: {response.status_code} {error_text}")

          buffer = ""
          for chunk in response.iter_text():
            if chunk:
              buffer += chunk
              while "\n" in buffer:
                line_end = buffer.index("\n")
                line = buffer[:line_end].strip()
                buffer = buffer[line_end + 1 :]

                if line.startswith("data: "):
                  json_str = line[6:].strip()
                  if json_str:
                    event = self._parse_event(json_str)
                    if event is not None:
                      yield event

    except httpx.HTTPError as e:
      raise Exception(f"Failed to connect to SSE endpoint at {url}: {e}")

  def _parse_event(self, json_str: str) -> Optional[SSEEvent]:
    """Parse a single SSE data line into an SSEEvent.

    Args:
        json_str: Raw JSON string from the SSE data field.

    Returns:
        SSEEvent if parseable and a known type, None otherwise.
    """
    try:
      data = json.loads(json_str)
    except json.JSONDecodeError as e:
      logger.warning(f"Error parsing SSE JSON: {e}, data: {json_str[:200]}")
      return None

    raw_type = data.get("type", "")
    if not SSEEventType.is_known(raw_type):
      return None

    # STATE_DELTA: extract plan steps from JSON Patch ops
    steps = None
    if raw_type == SSEEventType.STATE_DELTA:
      raw_delta = data.get("delta")
      if isinstance(raw_delta, list):
        steps = raw_delta
      elif isinstance(raw_delta, dict):
        steps = raw_delta.get("steps")

    # STATE_SNAPSHOT: full state
    snapshot = None
    if raw_type == SSEEventType.STATE_SNAPSHOT:
      snapshot = data.get("snapshot")

    return SSEEvent(
      type=raw_type,
      delta=data.get("delta") if raw_type in (SSEEventType.TEXT_MESSAGE_CONTENT, SSEEventType.TOOL_CALL_ARGS) else None,
      message_id=data.get("messageId"),
      tool_call_id=data.get("toolCallId"),
      tool_call_name=data.get("toolCallName"),
      steps=steps,
      snapshot=snapshot,
      name=data.get("name"),
      value=data.get("value"),
      run_id=data.get("runId"),
      thread_id=data.get("threadId"),
      message=data.get("message"),
      outcome=data.get("outcome"),
      interrupt=data.get("interrupt"),
    )
