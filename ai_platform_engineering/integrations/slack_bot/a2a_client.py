# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
A2A Protocol Client for Python
Implements the Agent-to-Agent protocol for communicating with AI agents
Based on https://a2a-protocol.org/
"""

import json
import requests
import uuid
from typing import Optional, Dict, Any, Iterator, List
from dataclasses import dataclass
from enum import Enum


class TaskState(Enum):
    """A2A Task States"""

    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    CANCELED = "canceled"
    FAILED = "failed"
    REJECTED = "rejected"
    AUTH_REQUIRED = "auth-required"
    UNKNOWN = "unknown"


@dataclass
class A2APart:
    """Represents a part of a message (text, file, or data)"""

    kind: str
    text: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self):
        result = {"kind": self.kind}
        if self.text is not None:
            result["text"] = self.text
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class A2AMessage:
    """Represents an A2A message"""

    role: str  # "user" or "agent"
    parts: List[A2APart]
    message_id: str
    kind: str = "message"
    context_id: Optional[str] = None
    task_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self):
        result = {
            "role": self.role,
            "parts": [p.to_dict() for p in self.parts],
            "messageId": self.message_id,
            "kind": self.kind,
        }
        if self.context_id:
            result["contextId"] = self.context_id
        if self.task_id:
            result["taskId"] = self.task_id
        if self.metadata:
            result["metadata"] = self.metadata
        return result


@dataclass
class A2ATask:
    """Represents an A2A task response"""

    id: str
    context_id: str
    status: Dict[str, Any]
    kind: str = "task"
    history: Optional[List[Dict]] = None
    artifacts: Optional[List[Dict]] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class A2AStatusUpdate:
    """Represents a task status update event"""

    task_id: str
    context_id: str
    kind: str
    status: Dict[str, Any]
    final: bool
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class A2AArtifactUpdate:
    """Represents an artifact update event"""

    task_id: str
    context_id: str
    kind: str
    artifact: Dict[str, Any]
    append: Optional[bool] = None
    last_chunk: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class A2AClient:
    """Client for communicating with A2A-compliant agents"""

    def __init__(self, base_url: str, timeout: int = 300, channel_id: Optional[str] = None, auth_client=None):
        """
        Initialize A2A client

        Args:
            base_url: Base URL of the A2A agent (required)
            timeout: Request timeout in seconds (default: 300)
            channel_id: Optional Slack channel ID to send as X-Client-Channel header
            auth_client: Optional OAuth2ClientCredentials instance for Bearer token auth
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.channel_id = channel_id
        self.auth_client = auth_client
        self.request_id_counter = 1
        self._current_response = None

    def _get_next_request_id(self) -> int:
        """Get next request ID for JSON-RPC"""
        request_id = self.request_id_counter
        self.request_id_counter += 1
        return request_id

    def _get_headers(self, accept: str = "application/json") -> Dict[str, str]:
        """Build request headers including X-Client-Source and optional Bearer token."""
        headers = {
            "Content-Type": "application/json",
            "Accept": accept,
            "X-Client-Source": "slack-bot",
        }
        if self.channel_id:
            headers["X-Client-Channel"] = self.channel_id
        if self.auth_client:
            token = self.auth_client.get_access_token()
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def send_message_stream(
        self,
        message_text: str,
        context_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Iterator[Dict[str, Any]]:
        """
        Send a message to the agent and stream back responses using SSE

        Args:
            message_text: The text of the message to send
            context_id: Optional context ID to continue a conversation
            metadata: Optional metadata to attach to the message

        Yields:
            Dictionary events from the A2A stream (Message, Task, StatusUpdate, ArtifactUpdate)
        """
        # Create message
        message_id = str(uuid.uuid4())
        parts = [A2APart(kind="text", text=message_text)]
        message = A2AMessage(
            role="user",
            parts=parts,
            message_id=message_id,
            context_id=context_id,
            metadata=metadata,
        )

        # Create JSON-RPC request
        request_id = self._get_next_request_id()
        rpc_request = {
            "jsonrpc": "2.0",
            "method": "message/stream",
            "params": {"message": message.to_dict()},
            "id": request_id,
        }

        # Make streaming request
        try:
            response = requests.post(
                self.base_url,
                json=rpc_request,
                headers=self._get_headers(accept="text/event-stream"),
                stream=True,
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException as e:
            raise Exception(f"Failed to connect to A2A agent at {self.base_url}: {str(e)}")

        if not response.ok:
            error_detail = response.text if response.text else "(no response body)"
            raise Exception(
                f"HTTP error {response.status_code} from {self.base_url}: {error_detail}"
            )

        self._current_response = response

        # Parse SSE stream
        buffer = ""
        event_data_buffer = ""

        try:
            for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
                if chunk:
                    buffer += chunk

                    # Process complete lines
                    while "\n" in buffer:
                        line_end = buffer.index("\n")
                        line = buffer[:line_end].strip()
                        buffer = buffer[line_end + 1 :]

                        if line == "":
                            # Empty line = end of event
                            if event_data_buffer:
                                try:
                                    # Parse the accumulated SSE event data
                                    event_json = json.loads(event_data_buffer)

                                    # Check for JSON-RPC error
                                    if "error" in event_json:
                                        error = event_json["error"]
                                        raise Exception(
                                            f"A2A Error: {error.get('message', 'Unknown error')} "
                                            f"(Code: {error.get('code', 'unknown')})"
                                        )

                                    # Extract and yield the result
                                    if "result" in event_json:
                                        yield event_json["result"]

                                except json.JSONDecodeError as e:
                                    print(f"Error parsing SSE event data: {e}")
                                    print(f"Data: {event_data_buffer}")
                                finally:
                                    event_data_buffer = ""

                        elif line.startswith("data:"):
                            # Accumulate data lines
                            event_data_buffer += line[5:].strip()
                        elif line.startswith(":"):
                            # Comment line, ignore
                            pass

            # Process any remaining buffered data
            if event_data_buffer:
                try:
                    event_json = json.loads(event_data_buffer)
                    if "result" in event_json:
                        yield event_json["result"]
                except json.JSONDecodeError:
                    pass
        finally:
            self._current_response = None

    def close_stream(self):
        """Close the active SSE response, unblocking send_message_stream()."""
        resp = self._current_response
        if resp:
            try:
                resp.close()
            except Exception:
                pass

    def get_agent_card(self) -> Dict[str, Any]:
        """
        Get the agent card from the well-known URI

        Returns:
            Dictionary containing agent card information
        """
        response = requests.get(
            f"{self.base_url}/.well-known/agent.json",
            headers=self._get_headers(),
            timeout=10,
        )

        if not response.ok:
            raise Exception(f"Failed to fetch agent card: {response.status_code} {response.text}")

        return response.json()

    def cancel_task(self, task_id: str) -> Dict[str, Any]:
        """
        Cancel a task by ID

        Args:
            task_id: The ID of the task to cancel

        Returns:
            Dictionary containing the updated task
        """
        request_id = self._get_next_request_id()
        rpc_request = {
            "jsonrpc": "2.0",
            "method": "tasks/cancel",
            "params": {"id": task_id},
            "id": request_id,
        }

        response = requests.post(
            self.base_url,
            json=rpc_request,
            headers=self._get_headers(),
            timeout=self.timeout,
        )

        if not response.ok:
            raise Exception(f"HTTP error {response.status_code}: {response.text}")

        result = response.json()

        if "error" in result:
            error = result["error"]
            raise Exception(
                f"A2A Error: {error.get('message', 'Unknown error')} "
                f"(Code: {error.get('code', 'unknown')})"
            )

        return result.get("result", {})
