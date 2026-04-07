# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Simple SSE client for Platform Engineer streaming.
Much simpler than A2A - just POST and stream events.
"""

import json
import uuid
import requests
from typing import Optional, Dict, Any, Iterator
from dataclasses import dataclass
from enum import Enum

from loguru import logger


class SSEEventType(str, Enum):
    # AG-UI event types (mirrors ag_ui.core.EventType)
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


@dataclass
class SSEEvent:
    type: SSEEventType
    # TEXT_MESSAGE_CONTENT: text delta
    delta: Optional[str] = None
    # TEXT_MESSAGE_START / TEXT_MESSAGE_END / TEXT_MESSAGE_CONTENT
    message_id: Optional[str] = None
    # TOOL_CALL_START / TOOL_CALL_END
    tool_call_id: Optional[str] = None
    tool_call_name: Optional[str] = None
    # STATE_DELTA: JSON Patch operations list
    steps: Optional[list] = None
    # STATE_SNAPSHOT: full state snapshot (contains todos, messages, etc.)
    snapshot: Optional[dict] = None
    # CUSTOM event fields
    name: Optional[str] = None
    value: Optional[Any] = None
    # RUN_FINISHED / RUN_ERROR
    run_id: Optional[str] = None
    thread_id: Optional[str] = None
    message: Optional[str] = None


@dataclass
class ChatRequest:
    message: str
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    trace_id: Optional[str] = None
    source: str = "slack"
    slack_channel_id: Optional[str] = None
    slack_thread_ts: Optional[str] = None
    slack_user_id: Optional[str] = None


class SSEClient:
    """Simple SSE client for Platform Engineer streaming via AG-UI protocol."""

    def __init__(self, base_url: str, timeout: int = 300, auth_client=None):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.auth_client = auth_client

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Client-Source": "slack-bot",
        }
        if self.auth_client:
            token = self.auth_client.get_access_token()
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def stream_chat(self, request: ChatRequest) -> Iterator[SSEEvent]:
        """
        Send message and stream back events.

        Builds an AG-UI RunAgentInput payload from the ChatRequest and
        streams back SSEEvent objects for each event.
        """
        thread_id = request.conversation_id or str(uuid.uuid4())
        run_id = str(uuid.uuid4())
        msg_id = f"user-{run_id}"

        payload: Dict[str, Any] = {
            "threadId": thread_id,
            "runId": run_id,
            "messages": [
                {
                    "id": msg_id,
                    "role": "user",
                    "content": request.message,
                },
            ],
            "state": {},
            "tools": [],
            "context": [],
            "forwardedProps": {
                "source": request.source,
                "user_email": request.user_email,
                "user_id": request.user_id,
                "trace_id": request.trace_id,
                "slack_channel_id": request.slack_channel_id,
                "slack_thread_ts": request.slack_thread_ts,
                "slack_user_id": request.slack_user_id,
            },
        }

        try:
            response = requests.post(
                f"{self.base_url}/chat/stream",
                json=payload,
                headers=self._get_headers(),
                stream=True,
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException as e:
            raise Exception(f"Failed to connect to SSE endpoint at {self.base_url}: {str(e)}")

        if not response.ok:
            raise Exception(f"SSE request failed: {response.status_code} {response.text}")

        buffer = ""
        for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
            if chunk:
                buffer += chunk
                while "\n" in buffer:
                    line_end = buffer.index("\n")
                    line = buffer[:line_end].strip()
                    buffer = buffer[line_end + 1:]

                    if line.startswith("data: "):
                        json_str = line[6:].strip()
                        if json_str:
                            try:
                                data = json.loads(json_str)
                                raw_type = data.get("type", "")
                                try:
                                    event_type = SSEEventType(raw_type)
                                except ValueError:
                                    # Skip AG-UI event types we don't handle (RAW, STEP_STARTED, etc.)
                                    continue
                                # STATE_DELTA: extract plan steps from JSON Patch ops
                                steps = None
                                if event_type == SSEEventType.STATE_DELTA:
                                    raw_delta = data.get("delta")
                                    if isinstance(raw_delta, list):
                                        steps = raw_delta
                                    elif isinstance(raw_delta, dict):
                                        steps = raw_delta.get("steps")
                                # STATE_SNAPSHOT: full state (contains todos)
                                snapshot = None
                                if event_type == SSEEventType.STATE_SNAPSHOT:
                                    snapshot = data.get("snapshot")
                                yield SSEEvent(
                                    type=event_type,
                                    delta=data.get("delta") if event_type == SSEEventType.TEXT_MESSAGE_CONTENT else None,
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
                                )
                            except json.JSONDecodeError as e:
                                logger.warning(
                                    f"Error parsing SSE JSON: {e}, data: {json_str[:200]}"
                                )
