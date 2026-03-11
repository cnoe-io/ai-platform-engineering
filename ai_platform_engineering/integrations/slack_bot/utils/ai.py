# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
A2A Streaming Integration

This module handles all interactions with the CAIPE supervisor, including:
- Streaming responses from AI agents
- Alert processing and Jira ticket creation
- Real-time progress updates in Slack
"""

import os
import time

APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))

import json
from loguru import logger
from .config import config
from .event_parser import (
    parse_event,
    EventType,
)
from . import slack_formatter
from . import active_streams
from .slack_formatter import ExecutionPlan
from .throttler import create_throttled_updater


def _build_footer_text(triggered_by_user_id=None, additional_footer=None) -> str:
    """Build footer text with optional user attribution and additional text."""
    parts = []
    if additional_footer:
        parts.append(f"_{additional_footer}_")
    if triggered_by_user_id:
        parts.append(f"_Requested by <@{triggered_by_user_id}>_")
    parts.append(f"_Mention @{APP_NAME} to continue_")
    return " • ".join(parts)


# Prefix added to retry messages after tool failures
RETRY_PROMPT_PREFIX = """IMPORTANT: A previous attempt to answer this question failed because some tools/subagents were unavailable or timed out.

Please try a different approach:
- If you don't have access to certain tools (GitLab, VictorOps, etc.), say so and offer alternatives
- Ask the user to paste relevant information directly if needed
- Avoid spawning complex subagents - keep it simple

"""


def stream_a2a_response(
    a2a_client,
    slack_client,
    channel_id,
    thread_ts,
    message_text,
    team_id,
    user_id,
    context_id=None,
    metadata=None,
    session_manager=None,
    triggered_by_user_id=None,
    additional_footer=None,
    overthink_mode=False,
):
    """
    Stream an A2A response to Slack using native AI streaming display modes.

    Uses Slack's chat_startStream/appendStream/stopStream with task_update chunks
    to show real-time progress (tool calls, sub-agent delegation) in a timeline view,
    then streams the final answer text.

    Falls back to throttled chat_update progress messages if streaming is unavailable.

    Args:
        a2a_client: A2AClient instance
        slack_client: Slack Client instance
        channel_id: Slack channel ID
        thread_ts: Thread timestamp
        message_text: Message to send to CAIPE
        team_id: Slack team ID (required for streaming)
        user_id: Slack user ID (required for streaming)
        context_id: Optional A2A context ID
        metadata: Optional metadata
        session_manager: Optional session manager
        triggered_by_user_id: Optional user ID who triggered this request (for feedback attribution)
        additional_footer: Optional additional text to append to footer
        overthink_mode: If True, check response for [DEFER] or [LOW_CONFIDENCE] markers
            and skip posting if found. Returns {"skipped": True, "reason": "..."} in that case.

    Returns:
        List of Slack blocks for the final response, or dict with retry_needed=True on recoverable errors,
        or dict with skipped=True if overthink_mode filtered the response
    """
    from .hitl_handler import parse_form_data, format_hitl_open_button, store_pending_form

    stream_ts = None  # Slack streaming message ts (AI streaming mode)
    response_ts = None  # Fallback progress message ts (chat_update mode)
    throttler = None
    can_stream = not overthink_mode and user_id and user_id[0] in ("U", "W")
    active_stream = None
    was_cancelled = False

    if can_stream:
        try:
            start_response = slack_client.chat_startStream(
                channel=channel_id,
                thread_ts=thread_ts,
                recipient_team_id=team_id,
                recipient_user_id=user_id,
                task_display_mode="timeline",
                chunks=[{
                    "type": "task_update",
                    "id": "_thinking",
                    "title": f"{APP_NAME} is thinking...",
                    "status": "in_progress",
                }],
            )
            stream_ts = start_response["ts"]
            logger.info(f"[{thread_ts}] Started AI stream (ts={stream_ts})")
        except Exception as e:
            logger.warning(f"[{thread_ts}] chat_startStream failed, falling back: {e}")
            can_stream = False

    if not can_stream and not overthink_mode:
        initial_blocks = [
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*{APP_NAME} is working...*"},
            }
        ]
        initial_response = slack_client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_ts,
            blocks=initial_blocks,
            text=f"*{APP_NAME} is working...*",
        )
        response_ts = initial_response["ts"]
        throttler = create_throttled_updater(
            slack_client=slack_client,
            channel_id=channel_id,
            message_ts=response_ts,
            thread_ts=thread_ts,
            min_interval=1.5,
        )

    # Register active stream and post "Stop generating" button
    active_stream = active_streams.register(thread_ts, a2a_client=a2a_client)
    if not overthink_mode:
        try:
            stop_resp = slack_client.chat_postMessage(
                channel=channel_id,
                thread_ts=thread_ts,
                blocks=[{
                    "type": "actions",
                    "elements": [{
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Stop generating"},
                        "style": "danger",
                        "action_id": "caipe_stop",
                        "value": thread_ts,
                    }],
                }],
                text="Stop generating",
            )
            active_stream.stop_button_ts = stop_resp["ts"]
        except Exception as e:
            logger.warning(f"[{thread_ts}] Could not post stop button: {e}")

    # State tracking
    final_message_text = None
    final_result_text = None
    partial_result_text = None
    last_artifacts = []
    execution_plan = ExecutionPlan()
    execution_plan_text = None
    is_new_context = context_id is None
    current_tool = None
    active_tools = set()
    task_error = None
    trace_id = None
    accumulated_stream_text = ""
    last_stream_update = 0.0
    STREAM_UPDATE_INTERVAL = 1.5

    try:
        for event_data in a2a_client.send_message_stream(
            message_text=message_text,
            context_id=context_id,
            metadata=metadata,
        ):
            if active_stream.is_cancelled:
                logger.info(f"[{thread_ts}] Stream cancelled by user")
                was_cancelled = True
                break

            parsed = parse_event(event_data)

            if parsed.event_type == EventType.TASK:
                if parsed.task_id and not active_stream.task_id:
                    active_stream.task_id = parsed.task_id
                    logger.info(f"[{thread_ts}] Stored A2A task_id: {parsed.task_id}")

                if parsed.context_id and is_new_context and session_manager:
                    session_manager.set_context_id(thread_ts, parsed.context_id)
                    is_new_context = False
                    logger.info(f"[{thread_ts}] Stored context ID {parsed.context_id}")

                if parsed.metadata:
                    if parsed.metadata.get("trace_id") and not trace_id:
                        trace_id = parsed.metadata["trace_id"]
                        logger.info(f"[{thread_ts}] Got trace_id from TASK: {trace_id}")
                    todos = slack_formatter.extract_todos_from_metadata(parsed.metadata)
                    for todo in todos:
                        execution_plan.add_step(
                            name=todo.get("content", todo.get("name", "Unknown")),
                            status=todo.get("status", "pending"),
                        )

            elif parsed.event_type == EventType.MESSAGE:
                if parsed.text_content:
                    final_message_text = parsed.text_content

            elif parsed.event_type == EventType.STATUS_UPDATE:
                if parsed.metadata and parsed.metadata.get("trace_id") and not trace_id:
                    trace_id = parsed.metadata["trace_id"]
                    logger.info(f"[{thread_ts}] Got trace_id from STATUS_UPDATE: {trace_id}")
                if parsed.status:
                    state = parsed.status.get("state")
                    if state == "completed":
                        logger.info(f"[{thread_ts}] Task completed")
                    elif state == "failed":
                        error_msg = _extract_error_message(parsed.status)
                        logger.warning(f"[{thread_ts}] Subtask failed: {error_msg}")
                        task_error = f"Agent task failed: {error_msg}"

            elif parsed.event_type == EventType.STREAMING_RESULT:
                if parsed.text_content:
                    if parsed.should_append:
                        accumulated_stream_text += parsed.text_content
                    else:
                        accumulated_stream_text = parsed.text_content

                    if stream_ts:
                        now = time.monotonic()
                        if now - last_stream_update >= STREAM_UPDATE_INTERVAL:
                            last_stream_update = now
                            preview = accumulated_stream_text[-200:].strip()
                            if len(accumulated_stream_text) > 200:
                                preview = "..." + preview
                            _send_stream_task_update(
                                slack_client, channel_id, stream_ts,
                                task_id="_thinking",
                                title=f"{APP_NAME} is composing a response...",
                                status="in_progress",
                                output=preview,
                            )

                if throttler and throttler.should_update():
                    _update_progress(throttler, current_tool, execution_plan_text)

            elif parsed.event_type == EventType.FINAL_RESULT:
                if parsed.text_content:
                    final_result_text = parsed.text_content
                    logger.debug(
                        f"[{thread_ts}] Got FINAL_RESULT: {len(parsed.text_content)} chars"
                    )
                if parsed.artifact and not trace_id:
                    artifact_metadata = parsed.artifact.get("metadata", {})
                    if artifact_metadata.get("trace_id"):
                        trace_id = artifact_metadata["trace_id"]
                        logger.info(f"[{thread_ts}] Got trace_id from FINAL_RESULT: {trace_id}")

            elif parsed.event_type == EventType.PARTIAL_RESULT:
                if parsed.text_content:
                    partial_result_text = parsed.text_content
                    logger.debug(
                        f"[{thread_ts}] Got partial_result: {len(parsed.text_content)} chars"
                    )

            elif parsed.event_type == EventType.TOOL_NOTIFICATION_START:
                if parsed.tool_notification:
                    tool_name = parsed.tool_notification.tool_name
                    tool_id = parsed.tool_notification.tool_id
                    current_tool = tool_name or tool_id or None
                    if current_tool:
                        active_tools.add(current_tool)
                    logger.info(f"[{thread_ts}] Tool started: {current_tool or '(unknown)'}")

                    if stream_ts:
                        display = slack_formatter.format_tool_display_name(current_tool or "")
                        purpose = parsed.tool_notification.purpose
                        source = parsed.tool_notification.source_agent
                        title = _build_task_title(display, purpose, source, in_progress=True)
                        _send_stream_task_update(
                            slack_client, channel_id, stream_ts,
                            task_id=current_tool or tool_id or "tool",
                            title=title,
                            status="in_progress",
                            details=purpose,
                        )
                    elif throttler:
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

            elif parsed.event_type == EventType.TOOL_NOTIFICATION_END:
                if parsed.tool_notification:
                    tool_name = parsed.tool_notification.tool_name
                    tool_id = parsed.tool_notification.tool_id
                    failed = parsed.tool_notification.status == "failed"
                    raw_name = tool_name or tool_id or "(unknown)"
                    active_tools.discard(raw_name)

                    if failed:
                        logger.warning(f"[{thread_ts}] Tool failed: {raw_name}")
                    else:
                        logger.info(f"[{thread_ts}] Tool completed: {raw_name}")

                    if stream_ts:
                        display = slack_formatter.format_tool_display_name(raw_name)
                        purpose = parsed.tool_notification.purpose
                        source = parsed.tool_notification.source_agent
                        if failed:
                            title = _build_task_title(display, purpose, source, failed=True)
                        else:
                            title = _build_task_title(display, purpose, source)
                        _send_stream_task_update(
                            slack_client, channel_id, stream_ts,
                            task_id=raw_name,
                            title=title,
                            status="error" if failed else "complete",
                        )
                    elif throttler:
                        current_tool = None
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

                    current_tool = None

            elif parsed.event_type == EventType.EXECUTION_PLAN:
                if parsed.text_content:
                    execution_plan_text = parsed.text_content.replace("\u27e6", "").replace("\u27e7", "")
                    logger.info(f"[{thread_ts}] Received execution plan update")
                    if throttler:
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

            elif parsed.event_type == EventType.CAIPE_FORM:
                if parsed.form_data:
                    logger.info(f"[{thread_ts}] Displaying HITL form (two-step modal)")
                    form = parse_form_data(
                        parsed.form_data,
                        task_id=parsed.task_id,
                        context_id=parsed.context_id,
                    )
                    store_pending_form(form)
                    button_blocks = format_hitl_open_button(form)
                    if stream_ts:
                        try:
                            _send_stream_task_update(
                                slack_client, channel_id, stream_ts,
                                task_id="_thinking",
                                title="Waiting for your input",
                                status="complete",
                            )
                        except Exception:
                            pass
                        try:
                            slack_client.chat_stopStream(
                                channel=channel_id, ts=stream_ts,
                            )
                        except Exception:
                            pass
                        slack_client.chat_postMessage(
                            channel=channel_id,
                            thread_ts=thread_ts,
                            blocks=button_blocks,
                            text="Action required - click Open Form to respond",
                        )
                    elif throttler:
                        throttler.force_update(button_blocks, "Action required")
                    else:
                        slack_client.chat_postMessage(
                            channel=channel_id,
                            thread_ts=thread_ts,
                            blocks=button_blocks,
                            text="Action required - click Open Form to respond",
                        )
                    return button_blocks

            elif parsed.event_type == EventType.OTHER_ARTIFACT:
                if parsed.artifact:
                    artifact_name = parsed.artifact.get("name", "").lower()
                    skip_patterns = [
                        "tool_notification_start",
                        "tool_notification_end",
                        "execution_plan_update",
                        "execution_plan_status_update",
                    ]
                    should_skip = any(p in artifact_name for p in skip_patterns)
                    if not should_skip:
                        logger.debug(f"[{thread_ts}] Collecting artifact: {artifact_name}")
                        last_artifacts.append(parsed.artifact)
                    else:
                        logger.debug(f"[{thread_ts}] Skipping artifact: {artifact_name}")

        # Handle cancellation
        if was_cancelled or (active_stream and active_stream.is_cancelled):
            was_cancelled = True
            logger.info(f"[{thread_ts}] Handling user-initiated cancellation")
            if stream_ts:
                try:
                    _send_stream_task_update(
                        slack_client, channel_id, stream_ts,
                        task_id="_thinking",
                        title=f"{APP_NAME} stopped",
                        status="error",
                    )
                    slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
                except Exception:
                    pass
                slack_client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=thread_ts,
                    text=f"_{APP_NAME} was stopped by the user._",
                )
            elif response_ts:
                try:
                    slack_client.chat_update(
                        channel=channel_id, ts=response_ts,
                        text=f"_{APP_NAME} was stopped by the user._",
                        blocks=[{
                            "type": "section",
                            "text": {"type": "mrkdwn", "text": f"_{APP_NAME} was stopped by the user._"},
                        }],
                    )
                except Exception:
                    pass
            return [{"type": "section", "text": {"type": "mrkdwn", "text": f"_{APP_NAME} was stopped._"}}]

        # Store trace_id for feedback scoring
        if trace_id and session_manager:
            session_manager.set_trace_id(thread_ts, trace_id)
            logger.info(f"[{thread_ts}] Stored trace_id for feedback: {trace_id}")

        # Determine final content
        logger.info(f"[{thread_ts}] Content sources:")
        logger.info(
            f"[{thread_ts}]   final_result_text: {len(final_result_text) if final_result_text else 0} chars"
        )
        logger.info(
            f"[{thread_ts}]   partial_result_text: {len(partial_result_text) if partial_result_text else 0} chars"
        )
        logger.info(
            f"[{thread_ts}]   final_message_text: {len(final_message_text) if final_message_text else 0} chars"
        )
        logger.info(f"[{thread_ts}]   artifacts count: {len(last_artifacts)}")

        final_text = _get_final_text(
            final_result_text, partial_result_text, final_message_text, last_artifacts, thread_ts
        )

        if overthink_mode and final_text:
            skip_result = _check_overthink_skip(final_text, thread_ts)
            if skip_result:
                return skip_result
            if "[CONFIDENCE: HIGH]" in final_text:
                final_text = final_text.replace("[CONFIDENCE: HIGH]", "").rstrip()
                logger.info(f"[{thread_ts}] Stripped [CONFIDENCE: HIGH] marker from response")

        if final_text and final_text != "I've completed your request.":
            if task_error:
                logger.info(
                    f"[{thread_ts}] Recovered from error - showing final content despite: {task_error}"
                )
            logger.info(
                f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}..."
            )
        elif task_error:
            logger.error(f"[{thread_ts}] No content received and task had error: {task_error}")
            if stream_ts:
                try:
                    _send_stream_task_update(
                        slack_client, channel_id, stream_ts,
                        task_id="_thinking", title=f"{APP_NAME} encountered an error",
                        status="error",
                    )
                    slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
                except Exception:
                    pass
            elif response_ts:
                try:
                    slack_client.chat_delete(channel=channel_id, ts=response_ts)
                except Exception:
                    pass
            return {"retry_needed": True, "error": task_error}
        else:
            logger.info(
                f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}..."
            )

        plan_text = execution_plan_text
        if not plan_text and execution_plan.steps:
            plan_text = slack_formatter.format_execution_plan(execution_plan)

        # Deliver final response
        if stream_ts:
            return _finish_stream(
                slack_client, channel_id, thread_ts, stream_ts,
                final_text, triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
                pending_tools=active_tools,
            )
        elif response_ts:
            try:
                slack_client.chat_delete(channel=channel_id, ts=response_ts)
                logger.info(f"[{thread_ts}] Deleted progress message {response_ts}")
            except Exception as e:
                logger.warning(f"[{thread_ts}] Could not delete progress message: {e}")
            return _post_final_response(
                slack_client, channel_id, thread_ts,
                final_text, plan_text, response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )
        else:
            return _post_final_response(
                slack_client, channel_id, thread_ts,
                final_text, plan_text, None,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )

    except Exception as e:
        if active_stream and active_stream.is_cancelled:
            logger.info(f"[{thread_ts}] Stream interrupted by cancellation")
            if stream_ts:
                try:
                    _send_stream_task_update(
                        slack_client, channel_id, stream_ts,
                        task_id="_thinking",
                        title=f"{APP_NAME} stopped",
                        status="error",
                    )
                    slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
                except Exception:
                    pass
                slack_client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=thread_ts,
                    text=f"_{APP_NAME} was stopped by the user._",
                )
            return [{"type": "section", "text": {"type": "mrkdwn", "text": f"_{APP_NAME} was stopped._"}}]

        logger.exception(f"[{thread_ts}] Error during streaming: {e}")
        error_blocks = slack_formatter.format_error_message(str(e))
        if stream_ts:
            try:
                slack_client.chat_stopStream(
                    channel=channel_id, ts=stream_ts,
                )
            except Exception:
                pass
        elif throttler:
            try:
                throttler.force_update(error_blocks, "Error")
            except Exception as slack_err:
                logger.warning(f"[{thread_ts}] Failed to post error to Slack: {slack_err}")
        return error_blocks

    finally:
        _cleanup_active_stream(slack_client, channel_id, thread_ts)


def _cleanup_active_stream(slack_client, channel_id, thread_ts):
    """Remove the active stream entry and delete the stop button message."""
    stream = active_streams.unregister(thread_ts)
    if stream and stream.stop_button_ts:
        try:
            slack_client.chat_delete(channel=channel_id, ts=stream.stop_button_ts)
        except Exception as e:
            logger.debug(f"[{thread_ts}] Could not delete stop button: {e}")


def _build_task_title(
    display_name: str,
    purpose: str = None,
    source_agent: str = None,
    in_progress: bool = False,
    failed: bool = False,
) -> str:
    """Build a descriptive task_update title from agent/tool context.

    Produces titles like:
      - "Querying GitHub for pull requests..."  (in_progress with purpose)
      - "Retrieved pull requests from GitHub"   (complete with purpose)
      - "GitHub: fetch pull requests failed"    (failed with purpose)
      - "Delegating to GitHub..."               (in_progress, no purpose)
      - "GitHub completed"                      (complete, no purpose)
    """
    purpose_short = (purpose[:80] + "...") if purpose and len(purpose) > 83 else purpose

    if failed:
        if purpose_short:
            return f"{display_name}: {purpose_short} failed"
        return f"{display_name} failed"

    if in_progress:
        if purpose_short:
            return f"Querying {display_name}: {purpose_short}..."
        if source_agent:
            src = slack_formatter.format_tool_display_name(source_agent)
            return f"Delegating to {display_name} (via {src})..."
        return f"Delegating to {display_name}..."

    if purpose_short:
        return f"{display_name}: {purpose_short}"
    return f"{display_name} completed"


def _send_stream_task_update(
    slack_client, channel_id, stream_ts,
    task_id, title, status, details=None, output=None,
):
    """Send a task_update chunk to an active Slack AI stream."""
    chunk = {
        "type": "task_update",
        "id": task_id,
        "title": title,
        "status": status,
    }
    if details:
        chunk["details"] = details
    if output:
        chunk["output"] = output
    try:
        slack_client.chat_appendStream(
            channel=channel_id,
            ts=stream_ts,
            chunks=[chunk],
        )
    except Exception as e:
        logger.warning(f"Failed to send task_update ({task_id}): {e}")


def _update_progress(throttler, current_tool, plan_text, force=False):
    """Update progress message with current tool and plan."""
    blocks = []

    # Header with tool inline (e.g., "CAIPE is search-ing...")
    if current_tool:
        header_text = f"*{APP_NAME} is {current_tool}-ing...*"
    else:
        header_text = f"*{APP_NAME} is working...*"

    blocks.append(
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": header_text},
        }
    )

    # Execution plan (use as-is since CAIPE sends formatted plan)
    if plan_text:
        formatted_plan = slack_formatter.convert_markdown_to_slack(plan_text)
        # Don't add extra header - CAIPE's plan already has structure
        if len(formatted_plan) <= 2000:
            blocks.append(
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": formatted_plan}],
                }
            )

    if force:
        throttler.force_update(blocks, "Working on your request...")
    else:
        throttler.update(blocks, "Working on your request...", force=False)


def _check_overthink_skip(final_text: str, thread_ts: str) -> dict | None:
    """Check if response should be skipped in overthink mode.

    Returns:
        None if response should be posted normally
        {"skipped": True, "reason": "..."} if response should be skipped
    """
    # Check for DEFER marker anywhere in response
    if "[DEFER]" in final_text:
        logger.info(f"[{thread_ts}] Overthink: skipping response (DEFER - human action needed)")
        return {"skipped": True, "reason": "defer"}

    # Check for LOW_CONFIDENCE marker anywhere in response
    if "[LOW_CONFIDENCE]" in final_text:
        logger.info(
            f"[{thread_ts}] Overthink: skipping response (LOW_CONFIDENCE - no good sources)"
        )
        logger.debug(f"[{thread_ts}] LOW_CONFIDENCE response: {final_text}")
        return {"skipped": True, "reason": "low_confidence"}

    # Response has content, allow posting
    return None


def _get_final_text(
    final_result_text, partial_result_text, final_message_text, artifacts, thread_ts
):
    """Extract final response text - prefer FINAL_RESULT over PARTIAL_RESULT over MESSAGE.

    Priority order:
    1. FINAL_RESULT artifact text (authoritative, from CAIPE)
    2. PARTIAL_RESULT artifact text (fallback, same content different name)
    3. Last MESSAGE with role=agent (fallback)
    4. Text from collected artifacts (last resort)
    """
    # Priority 1: FINAL_RESULT text (authoritative)
    if final_result_text and final_result_text.strip():
        logger.info(f"[{thread_ts}] Using FINAL_RESULT as response source")
        return final_result_text.strip()

    # Priority 2: PARTIAL_RESULT text (matches CAIPE UI behavior)
    if partial_result_text and partial_result_text.strip():
        logger.info(f"[{thread_ts}] Using PARTIAL_RESULT as response source (no FINAL_RESULT)")
        return partial_result_text.strip()

    # Priority 3: Last MESSAGE text
    if final_message_text and final_message_text.strip():
        logger.info(f"[{thread_ts}] Using MESSAGE as response source (no FINAL_RESULT)")
        return final_message_text.strip()

    # Priority 4: Extract from any collected artifact (fallback)
    # Tool/plan artifacts are already filtered out in skip_patterns, so whatever
    # is left should be valid response content that we should show (even if it may not be great)
    for artifact in reversed(artifacts):
        name = artifact.get("name", "")
        parts = artifact.get("parts", [])
        for part in parts:
            if part.get("kind") == "text" and part.get("text"):
                text = part["text"].strip()
                if text:
                    logger.info(f"[{thread_ts}] Using artifact '{name}' as response source")
                    return text

    # Final fallback
    logger.warning(f"[{thread_ts}] No content extracted from response - using default message")
    return "I've completed your request."


def _post_final_response(
    slack_client,
    channel_id,
    thread_ts,
    final_text,
    plan_text,
    original_ts,
    triggered_by_user_id=None,
    additional_footer=None,
):
    """Post final response as a regular message (fallback for bot messages)."""
    # Convert markdown to Slack mrkdwn format
    slack_text = slack_formatter.convert_markdown_to_slack(final_text)
    # Split text into chunks that fit Slack's 3000 char limit per block
    text_chunks = slack_formatter.split_text_into_blocks(slack_text)

    final_blocks = []
    for chunk in text_chunks:
        final_blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": chunk},
            }
        )

    # Build footer with optional user attribution and additional text
    footer_text = _build_footer_text(
        triggered_by_user_id=triggered_by_user_id, additional_footer=additional_footer
    )
    final_blocks.append(
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": footer_text}],
        }
    )

    slack_client.chat_postMessage(
        channel=channel_id,
        thread_ts=thread_ts,
        blocks=final_blocks,
        text=final_text[:100],
    )

    return final_blocks


def _finish_stream(
    slack_client,
    channel_id,
    thread_ts,
    stream_ts,
    final_text,
    triggered_by_user_id=None,
    additional_footer=None,
    pending_tools=None,
):
    """Complete an active AI stream: mark thinking done, stop stream, post final answer."""
    logger.debug(f"[{thread_ts}] Finishing stream (ts={stream_ts}), {len(final_text)} chars")

    for tool_name in pending_tools or ():
        try:
            display = slack_formatter.format_tool_display_name(tool_name)
            _send_stream_task_update(
                slack_client, channel_id, stream_ts,
                task_id=tool_name,
                title=f"{display} completed",
                status="complete",
            )
        except Exception:
            pass

    _send_stream_task_update(
        slack_client, channel_id, stream_ts,
        task_id="_thinking",
        title=f"{APP_NAME} finished thinking",
        status="complete",
    )

    slack_client.chat_stopStream(
        channel=channel_id,
        ts=stream_ts,
    )

    slack_text = slack_formatter.convert_markdown_to_slack(final_text)
    text_chunks = slack_formatter.split_text_into_blocks(slack_text)

    final_blocks = []
    for chunk in text_chunks:
        final_blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": chunk},
        })

    feedback_blocks = _build_feedback_blocks(
        channel_id, thread_ts, stream_ts,
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
    )
    final_blocks.extend(feedback_blocks)

    slack_client.chat_postMessage(
        channel=channel_id,
        thread_ts=thread_ts,
        blocks=final_blocks,
        text=final_text[:100],
    )

    return final_blocks


def _build_feedback_blocks(
    channel_id, thread_ts, original_ts,
    triggered_by_user_id=None, additional_footer=None,
):
    """Build the feedback / refinement blocks appended after streamed text."""
    blocks = [
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Not enough detail"},
                    "action_id": "caipe_feedback_more_detail",
                    "value": f"{channel_id}|{thread_ts}",
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Too verbose"},
                    "action_id": "caipe_feedback_less_verbose",
                    "value": f"{channel_id}|{thread_ts}",
                },
            ],
        },
        {
            "type": "context_actions",
            "elements": [
                {
                    "type": "feedback_buttons",
                    "action_id": "caipe_feedback",
                    "positive_button": {
                        "text": {"type": "plain_text", "text": "\ud83d\udc4d"},
                        "value": f"positive|{original_ts or ''}",
                    },
                    "negative_button": {
                        "text": {"type": "plain_text", "text": "\ud83d\udc4e"},
                        "value": f"negative|{original_ts or ''}",
                    },
                },
            ],
        },
    ]

    footer_text = _build_footer_text(
        triggered_by_user_id=triggered_by_user_id, additional_footer=additional_footer
    )
    blocks.append(
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": footer_text}],
        }
    )

    return blocks


def _extract_error_message(status):
    """Extract error message from status dict."""
    error_msg = status.get("message")
    if isinstance(error_msg, dict):
        parts = error_msg.get("parts", [])
        if parts:
            return parts[0].get("text", "Task failed")
        return "Task failed"
    return error_msg or "Task failed"


def handle_ai_alert_processing(
    a2a_client,
    slack_client,
    event,
    channel_id,
    bot_username,
    channel_config,
    session_manager,
    custom_prompt=None,
):
    """AI-powered alert processing."""
    alert_text = event.get("text", "")
    alert_blocks = event.get("blocks", [])
    alert_attachments = event.get("attachments", [])

    alert_context = {
        "bot": bot_username,
        "channel_id": channel_id,
        "text": alert_text,
        "timestamp": event.get("ts", ""),
        "blocks": json.dumps(alert_blocks) if alert_blocks else None,
        "attachments": json.dumps(alert_attachments) if alert_attachments else None,
    }

    jira_config_str = json.dumps(channel_config, indent=2)
    jira_project = channel_config.get("project_key", "UNKNOWN")
    prompt_template = custom_prompt if custom_prompt else config.defaults.default_ai_alerts_prompt

    prompt = prompt_template.format(
        bot_username=bot_username,
        channel_id=channel_id,
        alert_text=alert_text,
        timestamp=alert_context["timestamp"],
        jira_project=jira_project,
        jira_config_str=jira_config_str,
        alert_blocks=alert_context["blocks"][:500] if alert_blocks else "",
        alert_attachments=alert_context["attachments"][:500] if alert_attachments else "",
    )

    thread_ts = event.get("ts")
    team_id = event.get("team")
    user_id = event.get("user", event.get("bot_id"))

    logger.info(f"[{thread_ts}] AI processing alert from {bot_username}")

    if config.silence_env:
        logger.info(f"[{thread_ts}] Silencing AI alert processing")
        return "Silenced"

    context_id = session_manager.get_context_id(thread_ts)

    stream_a2a_response(
        a2a_client=a2a_client,
        slack_client=slack_client,
        channel_id=channel_id,
        thread_ts=thread_ts,
        message_text=prompt,
        team_id=team_id,
        user_id=user_id,
        context_id=context_id,
        metadata={
            "alert_bot": bot_username,
            "channel_id": channel_id,
            "jira_config": channel_config,
        },
        session_manager=session_manager,
    )

    logger.info(f"[{thread_ts}] AI processed alert from {bot_username}")
    return None
