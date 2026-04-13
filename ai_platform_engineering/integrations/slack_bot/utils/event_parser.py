# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Event Parser for A2A Protocol Events

Parses and classifies A2A events matching CAIPE UI patterns:
- streaming_result: Intermediate streaming content (append)
- partial_result / final_result: Complete answer (replace)
- tool_notification_start: Tool starting execution
- tool_notification_end: Tool completed execution
- caipe_form: HITL form requiring user input
"""

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional


class EventType(Enum):
    """Types of parsed A2A events"""

    TASK = "task"
    MESSAGE = "message"
    STATUS_UPDATE = "status_update"
    STREAMING_RESULT = "streaming_result"
    PARTIAL_RESULT = "partial_result"
    FINAL_RESULT = "final_result"
    TOOL_NOTIFICATION_START = "tool_notification_start"
    TOOL_NOTIFICATION_END = "tool_notification_end"
    EXECUTION_PLAN = "execution_plan"
    CAIPE_FORM = "caipe_form"
    OTHER_ARTIFACT = "other_artifact"
    UNKNOWN = "unknown"


@dataclass
class ToolNotification:
    """Represents a tool notification event"""

    tool_name: str
    tool_id: Optional[str] = None
    status: str = "pending"  # pending, running, completed, failed
    result: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class ParsedEvent:
    """Represents a parsed A2A event with extracted information"""

    event_type: EventType
    raw_event: Dict[str, Any]

    # Content extraction
    text_content: Optional[str] = None
    parts: Optional[List[Dict[str, Any]]] = None

    # Artifact info
    artifact_name: Optional[str] = None
    artifact: Optional[Dict[str, Any]] = None

    # Append behavior (from CAIPE UI pattern)
    should_append: bool = True  # True = append, False = replace

    # Tool notification data
    tool_notification: Optional[ToolNotification] = None

    # Task/context info
    task_id: Optional[str] = None
    context_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    # Status info
    status: Optional[Dict[str, Any]] = None
    is_final: bool = False

    # HITL form data
    form_data: Optional[Dict[str, Any]] = None

    # Structured plan data from DataPart (when available)
    plan_data: Optional[Dict[str, Any]] = None


def parse_event(event_data: Dict[str, Any]) -> ParsedEvent:
    """
    Parse an A2A event and classify it according to CAIPE UI patterns.

    Args:
        event_data: Raw event dictionary from A2A stream

    Returns:
        ParsedEvent with classified type and extracted data
    """
    event_kind = event_data.get("kind", "")

    if event_kind == "task":
        return _parse_task_event(event_data)
    elif event_kind == "message":
        return _parse_message_event(event_data)
    elif event_kind == "status-update":
        return _parse_status_update(event_data)
    elif event_kind == "artifact-update":
        return _parse_artifact_update(event_data)
    else:
        return ParsedEvent(
            event_type=EventType.UNKNOWN,
            raw_event=event_data,
        )


def _parse_task_event(event_data: Dict[str, Any]) -> ParsedEvent:
    """Parse a task event (task created/updated)"""
    return ParsedEvent(
        event_type=EventType.TASK,
        raw_event=event_data,
        task_id=event_data.get("id"),
        context_id=event_data.get("contextId"),
        metadata=event_data.get("metadata"),
        status=event_data.get("status"),
    )


def _parse_message_event(event_data: Dict[str, Any]) -> ParsedEvent:
    """Parse a message event (agent response)"""
    parts = event_data.get("parts", [])
    text_content = _extract_text_from_parts(parts)

    return ParsedEvent(
        event_type=EventType.MESSAGE,
        raw_event=event_data,
        text_content=text_content,
        parts=parts,
        context_id=event_data.get("contextId"),
        task_id=event_data.get("taskId"),
        metadata=event_data.get("metadata"),
    )


def _parse_status_update(event_data: Dict[str, Any]) -> ParsedEvent:
    """Parse a status update event"""
    status = event_data.get("status", {})
    is_final = event_data.get("final", False) or status.get("state") in [
        "completed",
        "failed",
        "canceled",
    ]

    return ParsedEvent(
        event_type=EventType.STATUS_UPDATE,
        raw_event=event_data,
        task_id=event_data.get("taskId"),
        context_id=event_data.get("contextId"),
        status=status,
        is_final=is_final,
        metadata=event_data.get("metadata"),
    )


def _parse_artifact_update(event_data: Dict[str, Any]) -> ParsedEvent:
    """Parse an artifact-update event."""
    artifact = event_data.get("artifact", {})
    artifact_name = artifact.get("name", "").lower()
    parts = artifact.get("parts", [])

    append_value = event_data.get("append")
    should_append = append_value is not False

    text_content = _extract_text_from_parts(parts)
    event_type = _classify_artifact_type(artifact_name)

    parsed = ParsedEvent(
        event_type=event_type,
        raw_event=event_data,
        text_content=text_content,
        parts=parts,
        artifact_name=artifact.get("name"),
        artifact=artifact,
        should_append=should_append,
        task_id=event_data.get("taskId"),
        context_id=event_data.get("contextId"),
        metadata=event_data.get("metadata"),
    )

    if event_type == EventType.FINAL_RESULT:
        parsed.should_append = False
        parsed.is_final = True

    if event_type in [EventType.TOOL_NOTIFICATION_START, EventType.TOOL_NOTIFICATION_END]:
        parsed.tool_notification = _extract_tool_notification(artifact, event_type)

    if event_type == EventType.EXECUTION_PLAN:
        parsed.plan_data = _extract_plan_data_from_parts(parts)

    if event_type == EventType.CAIPE_FORM:
        parsed.form_data = _extract_form_data(artifact)

    return parsed


def _extract_plan_data_from_parts(parts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Extract structured plan data from DataPart in artifact parts."""
    for part in parts:
        if part.get("kind") == "data" and isinstance(part.get("data"), dict):
            data = part["data"]
            if "steps" in data and isinstance(data["steps"], list):
                return data
    return None


def _classify_artifact_type(artifact_name: str) -> EventType:
    """Classify artifact type based on name patterns"""
    name_lower = artifact_name.lower()

    if "streaming_result" in name_lower:
        return EventType.STREAMING_RESULT
    elif "final_result" in name_lower:
        return EventType.FINAL_RESULT
    elif "partial_result" in name_lower:
        return EventType.PARTIAL_RESULT
    elif "tool_notification_start" in name_lower:
        return EventType.TOOL_NOTIFICATION_START
    elif "tool_notification_end" in name_lower:
        return EventType.TOOL_NOTIFICATION_END
    elif "execution_plan" in name_lower:
        return EventType.EXECUTION_PLAN
    elif "caipe_form" in name_lower or "form" in name_lower:
        return EventType.CAIPE_FORM
    return EventType.OTHER_ARTIFACT


def _extract_text_from_parts(parts: List[Dict[str, Any]]) -> Optional[str]:
    """Extract text content from message/artifact parts"""
    text_parts = []
    for part in parts:
        if part.get("kind") == "text" and part.get("text"):
            text_parts.append(part["text"])
    return "\n".join(text_parts) if text_parts else None


def _extract_tool_notification(artifact: Dict[str, Any], event_type: EventType) -> ToolNotification:
    """Extract tool notification data from artifact"""
    parts = artifact.get("parts", [])
    metadata = artifact.get("metadata", {})
    artifact_name = artifact.get("name", "")
    artifact_desc = artifact.get("description", "")

    tool_name = ""
    tool_id = None

    for key in ["tool_name", "toolName", "name", "tool", "function_name", "functionName", "function"]:
        if metadata.get(key):
            tool_name = str(metadata[key])
            break

    if not tool_name:
        nested_tool = metadata.get("tool", {})
        if isinstance(nested_tool, dict):
            tool_name = nested_tool.get("name", "")
        nested_func = metadata.get("function", {})
        if not tool_name and isinstance(nested_func, dict):
            tool_name = nested_func.get("name", "")

    for key in ["tool_id", "toolId", "id", "tool_call_id", "toolCallId", "call_id", "callId"]:
        if metadata.get(key):
            tool_id = str(metadata[key])
            break

    if not tool_name:
        if "tool_notification_start_" in artifact_name:
            tool_name = artifact_name.replace("tool_notification_start_", "")
        elif "tool_notification_end_" in artifact_name:
            tool_name = artifact_name.replace("tool_notification_end_", "")
        elif artifact_name.startswith("tool_notification_"):
            name_parts = artifact_name.split("_")
            if len(name_parts) > 3:
                tool_name = "_".join(name_parts[3:])

    if not tool_name:
        for part in parts:
            if part.get("kind") == "data":
                data = part.get("data", {})
                if isinstance(data, dict):
                    for key in ["tool_name", "toolName", "name", "function", "tool"]:
                        val = data.get(key)
                        if val:
                            if isinstance(val, dict):
                                tool_name = val.get("name", "")
                            else:
                                tool_name = str(val)
                            break
                if tool_name:
                    break
            elif part.get("kind") == "text":
                text = part.get("text", "")
                if text and not tool_name:
                    match = re.search(r"(?:Running|Calling|Executing|Tool):\s*(\S+)", text)
                    if match:
                        tool_name = match.group(1)

    if not tool_name and artifact_desc:
        match = re.search(r"Tool call (?:started|completed):\s*(\S+)", artifact_desc)
        if match:
            tool_name = match.group(1)
        else:
            tool_name = artifact_desc

    if not tool_name and artifact_name:
        if artifact_name not in ["tool_notification_start", "tool_notification_end"]:
            tool_name = artifact_name

    if event_type == EventType.TOOL_NOTIFICATION_START:
        status = "running"
    else:
        has_error = any(
            part.get("kind") == "error" or "error" in str(part.get("text", "")).lower()
            for part in parts
        )
        status = "failed" if has_error else "completed"

    result = _extract_text_from_parts(parts)

    return ToolNotification(
        tool_name=tool_name,
        tool_id=tool_id,
        status=status,
        result=result,
        metadata=metadata,
    )


def _extract_form_data(artifact: Dict[str, Any]) -> Dict[str, Any]:
    """Extract HITL form data from artifact"""
    parts = artifact.get("parts", [])
    metadata = artifact.get("metadata", {})

    form_data = {
        "title": metadata.get("title", "Action Required"),
        "description": metadata.get("description", ""),
        "fields": [],
        "actions": [],
    }

    for part in parts:
        if part.get("kind") == "data":
            data = part.get("data", {})
            if "fields" in data:
                form_data["fields"] = data["fields"]
            if "actions" in data:
                form_data["actions"] = data["actions"]
            if "title" in data:
                form_data["title"] = data["title"]
            if "description" in data:
                form_data["description"] = data["description"]
        elif part.get("kind") == "text":
            if not form_data["description"]:
                form_data["description"] = part.get("text", "")

    return form_data


def is_content_event(parsed: ParsedEvent) -> bool:
    """Check if event contains displayable content"""
    return parsed.event_type in [
        EventType.STREAMING_RESULT,
        EventType.PARTIAL_RESULT,
        EventType.FINAL_RESULT,
        EventType.MESSAGE,
    ]


def is_tool_event(parsed: ParsedEvent) -> bool:
    """Check if event is a tool notification"""
    return parsed.event_type in [
        EventType.TOOL_NOTIFICATION_START,
        EventType.TOOL_NOTIFICATION_END,
    ]
