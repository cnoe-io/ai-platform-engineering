"""
A2A streaming response handler for Webex.

Implements the hybrid streaming approach:
1. Post "Working on it..." message
2. Periodically update with progress (execution plan, tool notifications)
3. On completion: delete working message, post final response + feedback card

Throttles message updates to avoid Webex API rate limits (3s minimum interval).
"""

import time
from typing import Any, Dict, Optional

from loguru import logger


MIN_UPDATE_INTERVAL = 3.0  # seconds between message updates


def stream_a2a_response_webex(
    a2a_client,
    webex_api,
    room_id: str,
    message_text: str,
    user_email: str,
    context_id: Optional[str] = None,
    session_manager=None,
    parent_id: Optional[str] = None,
    thread_key: Optional[str] = None,
    langfuse_client=None,
) -> Optional[Dict[str, Any]]:
    """Stream an A2A response to a Webex room using the hybrid approach.

    Returns:
        Dict with context_id and trace_id if successful, None on error.
    """
    from utils.webex_formatter import (
        format_error_message,
        format_execution_plan,
        format_progress_message,
        format_tool_notification,
        split_long_message,
    )
    from utils.cards import create_feedback_card, create_hitl_form_card, send_card
    from event_parser import EventType, parse_event

    # Post initial "working" message
    try:
        kwargs = {"roomId": room_id, "markdown": "⏳ Working on it..."}
        if parent_id:
            kwargs["parentId"] = parent_id
        working_msg = webex_api.messages.create(**kwargs)
        working_msg_id = working_msg.id
    except Exception as e:
        logger.error(f"Failed to post working message: {e}")
        working_msg_id = None

    result_context_id = context_id
    result_trace_id = None
    accumulated_text = ""
    plan_text = ""
    current_tool = ""
    last_update_time = time.time()
    final_text = None
    had_error = False

    try:
        for event_data in a2a_client.send_message_stream(
            message_text=message_text,
            context_id=context_id,
            metadata={"user_email": user_email},
        ):
            parsed = parse_event(event_data)

            if parsed.event_type == EventType.TASK:
                if parsed.context_id:
                    result_context_id = parsed.context_id
                if parsed.metadata and parsed.metadata.get("trace_id"):
                    result_trace_id = parsed.metadata["trace_id"]
                if session_manager and thread_key:
                    if result_context_id:
                        session_manager.set_context_id(thread_key, result_context_id)
                    if result_trace_id:
                        session_manager.set_trace_id(thread_key, result_trace_id)

            elif parsed.event_type == EventType.EXECUTION_PLAN:
                if parsed.plan_data and parsed.plan_data.get("steps"):
                    plan_text = format_execution_plan(parsed.plan_data["steps"])
                elif parsed.text_content:
                    plan_text = parsed.text_content
                _maybe_update_working_message(
                    webex_api,
                    working_msg_id,
                    room_id,
                    format_progress_message(plan_text, current_tool),
                    last_update_time,
                )
                last_update_time = time.time()

            elif parsed.event_type == EventType.TOOL_NOTIFICATION_START:
                if parsed.tool_notification:
                    current_tool = format_tool_notification(
                        parsed.tool_notification.tool_name, "running"
                    )
                _maybe_update_working_message(
                    webex_api,
                    working_msg_id,
                    room_id,
                    format_progress_message(plan_text, current_tool),
                    last_update_time,
                )
                last_update_time = time.time()

            elif parsed.event_type == EventType.TOOL_NOTIFICATION_END:
                if parsed.tool_notification:
                    current_tool = format_tool_notification(
                        parsed.tool_notification.tool_name,
                        parsed.tool_notification.status,
                    )

            elif parsed.event_type == EventType.STREAMING_RESULT:
                if parsed.text_content:
                    if parsed.should_append:
                        accumulated_text += parsed.text_content
                    else:
                        accumulated_text = parsed.text_content

            elif parsed.event_type in (EventType.FINAL_RESULT, EventType.PARTIAL_RESULT):
                if parsed.text_content:
                    final_text = parsed.text_content

            elif parsed.event_type == EventType.CAIPE_FORM:
                if parsed.form_data:
                    card = create_hitl_form_card(parsed.form_data)
                    send_card(webex_api, room_id, card, parent_id=parent_id)

            elif parsed.event_type == EventType.STATUS_UPDATE:
                status = parsed.status or {}
                state = status.get("state", "")
                if state == "failed":
                    error_msg = status.get("message", {})
                    if isinstance(error_msg, dict):
                        error_msg = error_msg.get("parts", [{}])[0].get(
                            "text", "Unknown error"
                        )
                    final_text = format_error_message(str(error_msg))
                    had_error = True

    except Exception as e:
        logger.error(f"Error during A2A streaming: {e}")
        final_text = format_error_message(str(e))
        had_error = True

    # Determine final response text
    response_text = final_text or accumulated_text or "No response received."

    # Delete working message
    if working_msg_id:
        try:
            webex_api.messages.delete(working_msg_id)
        except Exception as e:
            logger.warning(f"Failed to delete working message: {e}")

    # Post final response
    try:
        chunks = split_long_message(response_text)
        for chunk in chunks:
            kwargs = {"roomId": room_id, "markdown": chunk}
            if parent_id:
                kwargs["parentId"] = parent_id
            webex_api.messages.create(**kwargs)
    except Exception as e:
        logger.error(f"Failed to post final response: {e}")

    # Post feedback card (only on success)
    if not had_error:
        try:
            feedback_card = create_feedback_card()
            send_card(webex_api, room_id, feedback_card, parent_id=parent_id)
        except Exception as e:
            logger.warning(f"Failed to post feedback card: {e}")

    return {
        "context_id": result_context_id,
        "trace_id": result_trace_id,
    }


def _maybe_update_working_message(
    webex_api, msg_id: Optional[str], room_id: str, content: str, last_update: float
) -> None:
    """Update the working message if enough time has passed since last update."""
    if not msg_id:
        return
    if time.time() - last_update < MIN_UPDATE_INTERVAL:
        return
    try:
        webex_api.messages.update(messageId=msg_id, roomId=room_id, markdown=content)
    except Exception as e:
        logger.warning(f"Failed to update working message: {e}")
