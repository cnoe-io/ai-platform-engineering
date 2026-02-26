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

APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))

import json
from loguru import logger
from .config import config
from .event_parser import (
    parse_event,
    EventType,
)
from . import slack_formatter
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
    Stream an A2A response to Slack.

    Hybrid approach:
    1. Throttled updates during processing (tools, execution plan)
    2. Stream final output using Slack's streaming API

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
    from .hitl_handler import parse_form_data, format_hitl_form_blocks

    # In overthink mode, process silently - don't show "working" message
    # Only post if we have a confident response
    response_ts = None
    throttler = None

    if not overthink_mode:
        # Post initial "working" message
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

        # Create throttler for progress updates
        throttler = create_throttled_updater(
            slack_client=slack_client,
            channel_id=channel_id,
            message_ts=response_ts,
            thread_ts=thread_ts,
            min_interval=1.5,
        )

    # State tracking - keep final content separate, don't accumulate
    final_message_text = None  # From MESSAGE events (role=agent)
    final_result_text = None  # From FINAL_RESULT artifact
    partial_result_text = None  # From PARTIAL_RESULT artifact (fallback)
    last_artifacts = []
    execution_plan = ExecutionPlan()
    execution_plan_text = None
    is_new_context = context_id is None
    current_tool = None
    task_error = None  # Track errors but don't raise immediately - allow recovery
    trace_id = None  # Langfuse trace ID for feedback scoring

    try:
        for event_data in a2a_client.send_message_stream(
            message_text=message_text,
            context_id=context_id,
            metadata=metadata,
        ):
            parsed = parse_event(event_data)

            if parsed.event_type == EventType.TASK:
                if parsed.context_id and is_new_context and session_manager:
                    session_manager.set_context_id(thread_ts, parsed.context_id)
                    is_new_context = False
                    logger.info(f"[{thread_ts}] Stored context ID {parsed.context_id}")

                if parsed.metadata:
                    # Extract trace_id for feedback scoring
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
                # Keep the last MESSAGE with role=agent as potential final content
                if parsed.text_content:
                    final_message_text = parsed.text_content

            elif parsed.event_type == EventType.STATUS_UPDATE:
                # Extract trace_id from completion status metadata
                if parsed.metadata and parsed.metadata.get("trace_id") and not trace_id:
                    trace_id = parsed.metadata["trace_id"]
                    logger.info(f"[{thread_ts}] Got trace_id from STATUS_UPDATE: {trace_id}")
                if parsed.status:
                    state = parsed.status.get("state")
                    if state == "completed":
                        logger.info(f"[{thread_ts}] Task completed")
                    elif state == "failed":
                        # Log warning but continue - we may still get FINAL_RESULT with partial content
                        error_msg = _extract_error_message(parsed.status)
                        logger.warning(f"[{thread_ts}] Subtask failed: {error_msg}")
                        task_error = f"Agent task failed: {error_msg}"

            elif parsed.event_type == EventType.STREAMING_RESULT:
                # Just update progress, don't accumulate streaming content
                if throttler and throttler.should_update():
                    _update_progress(throttler, current_tool, execution_plan_text)

            elif parsed.event_type == EventType.FINAL_RESULT:
                # This is the authoritative final content
                if parsed.text_content:
                    final_result_text = parsed.text_content
                    logger.debug(
                        f"[{thread_ts}] Got FINAL_RESULT: {len(parsed.text_content)} chars"
                    )
                # Extract trace_id from artifact metadata
                if parsed.artifact and not trace_id:
                    artifact_metadata = parsed.artifact.get("metadata", {})
                    if artifact_metadata.get("trace_id"):
                        trace_id = artifact_metadata["trace_id"]
                        logger.info(f"[{thread_ts}] Got trace_id from FINAL_RESULT: {trace_id}")
                # Don't add FINAL_RESULT to last_artifacts - we already captured text_content

            elif parsed.event_type == EventType.PARTIAL_RESULT:
                # Keep partial_result as fallback if no final_result comes
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
                    logger.info(f"[{thread_ts}] Tool started: {current_tool or '(unknown)'}")
                    if throttler:
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

            elif parsed.event_type == EventType.TOOL_NOTIFICATION_END:
                if parsed.tool_notification:
                    tool_name = parsed.tool_notification.tool_name
                    tool_id = parsed.tool_notification.tool_id
                    failed = parsed.tool_notification.status == "failed"
                    display_name = tool_name or tool_id or "(unknown)"
                    if failed:
                        logger.warning(f"[{thread_ts}] Tool failed: {display_name}")
                    else:
                        logger.info(f"[{thread_ts}] Tool completed: {display_name}")
                    current_tool = None
                    # Update to clear tool indicator
                    if throttler:
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

            elif parsed.event_type == EventType.EXECUTION_PLAN:
                if parsed.text_content:
                    execution_plan_text = parsed.text_content.replace("⟦", "").replace("⟧", "")
                    logger.info(f"[{thread_ts}] Received execution plan update")
                    if throttler:
                        _update_progress(throttler, current_tool, execution_plan_text, force=True)

            elif parsed.event_type == EventType.CAIPE_FORM:
                if parsed.form_data:
                    logger.info(f"[{thread_ts}] Displaying HITL form")
                    form = parse_form_data(
                        parsed.form_data,
                        task_id=parsed.task_id,
                        context_id=parsed.context_id,
                    )
                    form_blocks = format_hitl_form_blocks(form)
                    if throttler:
                        throttler.force_update(form_blocks, "Action required")
                    else:
                        # In overthink mode, post the form directly
                        slack_client.chat_postMessage(
                            channel=channel_id,
                            thread_ts=thread_ts,
                            blocks=form_blocks,
                            text="Action required",
                        )
                    return form_blocks

            elif parsed.event_type == EventType.OTHER_ARTIFACT:
                # Collect artifacts that might contain response content
                # Skip only tool/plan artifacts (shown as progress, not final response)
                if parsed.artifact:
                    artifact_name = parsed.artifact.get("name", "").lower()
                    # Only skip tool notifications and execution plan artifacts
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

        # Store trace_id for feedback scoring if we have one
        if trace_id and session_manager:
            session_manager.set_trace_id(thread_ts, trace_id)
            logger.info(f"[{thread_ts}] Stored trace_id for feedback: {trace_id}")

        # Get final content - prefer FINAL_RESULT, fall back to PARTIAL_RESULT, then MESSAGE
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
        if final_result_text:
            logger.debug(f"[{thread_ts}]   FINAL_RESULT preview: {final_result_text[:200]}...")
        if partial_result_text:
            logger.debug(f"[{thread_ts}]   PARTIAL_RESULT preview: {partial_result_text[:200]}...")
        if final_message_text:
            logger.debug(f"[{thread_ts}]   MESSAGE preview: {final_message_text[:200]}...")

        final_text = _get_final_text(
            final_result_text, partial_result_text, final_message_text, last_artifacts, thread_ts
        )

        # Overthink mode: check for skip markers before posting
        if overthink_mode and final_text:
            skip_result = _check_overthink_skip(final_text, thread_ts)
            if skip_result:
                # No progress message to delete in overthink mode (silent processing)
                return skip_result

            # Strip the [CONFIDENCE: HIGH] marker before posting
            if "[CONFIDENCE: HIGH]" in final_text:
                final_text = final_text.replace("[CONFIDENCE: HIGH]", "").rstrip()
                logger.info(f"[{thread_ts}] Stripped [CONFIDENCE: HIGH] marker from response")

        # Handle graceful degradation: if we have content, show it even if there was an error
        if final_text and final_text != "I've completed your request.":
            if task_error:
                logger.info(
                    f"[{thread_ts}] Recovered from error - showing final content despite: {task_error}"
                )
            logger.info(
                f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}..."
            )
        elif task_error:
            # No useful content AND we had an error - return retry marker for caller to handle
            logger.error(f"[{thread_ts}] No content received and task had error: {task_error}")
            # Delete progress message if there is one (not in overthink mode)
            if response_ts:
                try:
                    slack_client.chat_delete(channel=channel_id, ts=response_ts)
                except Exception:
                    pass
            # Return marker to trigger retry at caller level
            return {"retry_needed": True, "error": task_error}
        else:
            logger.info(
                f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}..."
            )

        # Get execution plan
        plan_text = execution_plan_text
        if not plan_text and execution_plan.steps:
            plan_text = slack_formatter.format_execution_plan(execution_plan)

        # Delete the progress message if there is one (not in overthink mode)
        if response_ts:
            try:
                slack_client.chat_delete(channel=channel_id, ts=response_ts)
                logger.info(f"[{thread_ts}] Deleted progress message {response_ts}")
            except Exception as e:
                logger.warning(f"[{thread_ts}] Could not delete progress message: {e}")

        # Stream final response using Slack's native streaming API
        # Streaming requires a valid user_id (starts with U or W), bot_ids (B) don't work
        can_stream = user_id and user_id[0] in ("U", "W")
        if can_stream:
            try:
                return _stream_final_response(
                    slack_client,
                    channel_id,
                    thread_ts,
                    team_id,
                    user_id,
                    final_text,
                    plan_text,
                    response_ts,
                    triggered_by_user_id=triggered_by_user_id,
                    additional_footer=additional_footer,
                )
            except Exception as stream_err:
                # Streaming failed - fall back to regular posting
                # Common errors: channel_type_not_supported, missing_recipient_team_id
                logger.warning(
                    f"[{thread_ts}] Streaming failed, falling back to regular post: {stream_err}"
                )
                return _post_final_response(
                    slack_client,
                    channel_id,
                    thread_ts,
                    final_text,
                    plan_text,
                    response_ts,
                    triggered_by_user_id=triggered_by_user_id,
                    additional_footer=additional_footer,
                )
        else:
            # Fall back to regular post for bot messages
            logger.info(f"[{thread_ts}] Using regular post (no valid user_id for streaming)")
            return _post_final_response(
                slack_client,
                channel_id,
                thread_ts,
                final_text,
                plan_text,
                response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )

    except Exception as e:
        logger.exception(f"[{thread_ts}] Error during streaming: {e}")
        error_blocks = slack_formatter.format_error_message(str(e))
        try:
            throttler.force_update(error_blocks, "Error")
        except Exception as slack_err:
            logger.warning(f"[{thread_ts}] Failed to post error to Slack: {slack_err}")
        # Return error blocks instead of re-raising to prevent duplicate error messages
        # The error has already been posted to Slack via throttler.force_update
        return error_blocks


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


def _stream_final_response(
    slack_client,
    channel_id,
    thread_ts,
    team_id,
    user_id,
    final_text,
    plan_text,
    original_ts,
    triggered_by_user_id=None,
    additional_footer=None,
):
    """Stream the final response using Slack's streaming API."""
    logger.debug(f"[{thread_ts}] Streaming {len(final_text)} chars to Slack")

    # Start stream
    start_response = slack_client.chat_startStream(
        channel=channel_id,
        thread_ts=thread_ts,
        recipient_team_id=team_id,
        recipient_user_id=user_id,
    )
    stream_ts = start_response["ts"]

    # Stream the content in chunks for typing effect
    # Slack's markdown_text parameter accepts standard markdown and converts automatically
    chunk_size = 50
    for i in range(0, len(final_text), chunk_size):
        chunk = final_text[i : i + chunk_size]
        slack_client.chat_appendStream(
            channel=channel_id,
            ts=stream_ts,
            markdown_text=chunk,
        )

    # Build final blocks - only feedback buttons, NOT the text or plan
    # (the streamed text stays, stopStream just adds blocks below it)
    # Note: Execution plan is shown during streaming but hidden in final output
    final_blocks = []

    # Add refinement buttons
    final_blocks.append(
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
        }
    )

    # Add thumbs up/down feedback buttons
    final_blocks.append(
        {
            "type": "context_actions",
            "elements": [
                {
                    "type": "feedback_buttons",
                    "action_id": "caipe_feedback",
                    "positive_button": {
                        "text": {"type": "plain_text", "text": "👍"},
                        "value": f"positive|{original_ts or ''}",
                    },
                    "negative_button": {
                        "text": {"type": "plain_text", "text": "👎"},
                        "value": f"negative|{original_ts or ''}",
                    },
                },
            ],
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

    # Stop stream - blocks are appended after the streamed text
    slack_client.chat_stopStream(
        channel=channel_id,
        ts=stream_ts,
        blocks=final_blocks,
    )

    return final_blocks


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
