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

    # Streaming requires a valid user_id (starts with U or W), bot_ids (B) don't work
    can_stream = user_id and user_id[0] in ("U", "W")

    # In overthink mode, process silently - don't show "working" message
    # Only post if we have a confident response
    response_ts = None
    throttler = None

    # Plan-mode streaming state
    stream_ts = None              # ts from chat.startStream (None = not started)
    plan_steps = {}               # step_id -> step dict (latest plan state)
    sent_step_status = {}         # step_id -> last status we sent to Slack
    step_thinking = {}            # step_id -> accumulated thinking text per step
    current_step_id = None        # which step is in_progress
    needs_separator = False       # insert \n\n before next streamed markdown (after tool_end)

    # Loading messages shown in the animated typing indicator before stream starts
    _loading_messages = [
        "is thinking...",
        "Convincing the AI to stop overthinking...",
        "is resorting to some magic",
    ]

    def _set_typing_status(status_text, loading_messages=None):
        """Set the typing indicator status (best-effort, non-blocking).

        IMPORTANT: Only call this BEFORE startStream. Calling setStatus after
        startStream creates a second message in the thread.
        Only works for streamable users (U/W prefix), not bot users (B prefix).
        """
        if not can_stream or overthink_mode:
            return
        try:
            kwargs = dict(
                channel_id=channel_id,
                thread_ts=thread_ts,
                status=status_text,
            )
            if loading_messages:
                kwargs["loading_messages"] = loading_messages
            slack_client.assistant_threads_setStatus(**kwargs)
            logger.info(f"[{thread_ts}] SLACK setStatus('{status_text}')")
        except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK setStatus('{status_text}') FAILED: {e}")

    def _start_stream_if_needed():
        """Lazily start the Slack stream on first real content. Returns stream_ts or None."""
        nonlocal stream_ts
        if stream_ts:
            return stream_ts  # Already started
        if not can_stream or overthink_mode:
            return None
        try:
            start_response = slack_client.chat_startStream(
                channel=channel_id,
                thread_ts=thread_ts,
                recipient_team_id=team_id,
                recipient_user_id=user_id,
                task_display_mode="plan",
            )
            stream_ts = start_response["ts"]
            logger.info(f"[{thread_ts}] SLACK startStream -> ts={stream_ts}")
            # Clear the typing status now that the stream message is visible
            _set_typing_status("")
            return stream_ts
        except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK startStream FAILED: {e}")
            return None

    if not overthink_mode:
        if can_stream:
            # Show the animated typing indicator while we wait for content.
            # The stream itself is deferred until we have something to show.
            _set_typing_status("is thinking...", loading_messages=_loading_messages)
        else:
            # Non-streaming fallback: post a "working..." message + throttler
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
    is_new_context = context_id is None
    current_tool = None
    task_error = None  # Track errors but don't raise immediately - allow recovery
    trace_id = None  # Langfuse trace ID for feedback scoring
    streamed_any_text = False  # Track if any text was streamed via appendStream

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
                logger.info(
                    f"[{thread_ts}] STREAMING_RESULT: {len(parsed.text_content or '')} chars, "
                    f"append={parsed.should_append}, step={current_step_id}"
                )
                if parsed.text_content:
                    # Determine if this is intermediate step thinking or final answer.
                    # Non-last plan steps → accumulate thinking (sent at step completion).
                    # Last step or no plan → stream as top-level markdown_text.
                    is_intermediate_step = False
                    if current_step_id and plan_steps:
                        sorted_steps = sorted(plan_steps.values(), key=lambda s: s.get("order", 0))
                        last_step = sorted_steps[-1]
                        is_last = (last_step.get("step_id") == current_step_id
                                   and last_step.get("status") == "in_progress")
                        if not is_last:
                            is_intermediate_step = True
                            # Accumulate thinking for this step (used at step completion).
                            # Respect append flag: False = replace, True/None = append
                            if parsed.should_append is False:
                                step_thinking[current_step_id] = [parsed.text_content]
                            else:
                                step_thinking.setdefault(current_step_id, [])
                                step_thinking[current_step_id].append(parsed.text_content)
                            # Update typing status while thinking (before stream starts)
                            if not stream_ts:
                                step = plan_steps.get(current_step_id, {})
                                title = step.get("title", "working")
                                _set_typing_status(f"is {title}...")

                    if not is_intermediate_step and not plan_steps:
                        # Stream as markdown text in real-time only when
                        # there is NO plan. When a plan is active, all steps
                        # (including the last) accumulate silently — the final
                        # answer is sent in stopStream from final_result.
                        _start_stream_if_needed()
                        if stream_ts:
                            text = parsed.text_content
                            if needs_separator and streamed_any_text:
                                text = "\n\n" + text
                                needs_separator = False
                            try:
                                slack_client.chat_appendStream(
                                    channel=channel_id, ts=stream_ts,
                                    chunks=[{"type": "markdown_text", "text": text}],
                                )
                                logger.info(f"[{thread_ts}] SLACK appendStream markdown_text {len(parsed.text_content)} chars")
                                streamed_any_text = True
                            except Exception as e:
                                logger.warning(f"[{thread_ts}] SLACK appendStream text FAILED: {e}")

                # Update progress for non-streaming fallback (bot users)
                if throttler and throttler.should_update():
                    blocks = _build_progress_blocks(current_tool, plan_steps)
                    throttler.update(blocks, "Working on your request...")

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
                    if not stream_ts and current_tool:
                        _set_typing_status(f"is {current_tool}-ing...")
                    if throttler:
                        blocks = _build_progress_blocks(current_tool, plan_steps)
                        throttler.force_update(blocks, "Working on your request...")

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
                    needs_separator = True
                    if not stream_ts:
                        _set_typing_status("is working...")
                    # Update to clear tool indicator
                    if throttler:
                        blocks = _build_progress_blocks(None, plan_steps)
                        throttler.force_update(blocks, "Working on your request...")

            elif parsed.event_type == EventType.EXECUTION_PLAN:
                if parsed.plan_data and parsed.plan_data.get("steps"):
                    # Update plan state from structured DataPart
                    for step in parsed.plan_data["steps"]:
                        plan_steps[step["step_id"]] = step

                    # Track current in_progress step
                    for step in parsed.plan_data["steps"]:
                        if step.get("status") == "in_progress":
                            current_step_id = step["step_id"]
                            break

                    # Send only new or changed steps to avoid duplicate plan cards
                    if not overthink_mode:
                        _start_stream_if_needed()
                    if not overthink_mode and stream_ts:
                        changed_steps = []
                        for step in plan_steps.values():
                            sid = step["step_id"]
                            cur_status = step.get("status", "pending")
                            if sid not in sent_step_status or sent_step_status[sid] != cur_status:
                                changed_steps.append(step)
                                sent_step_status[sid] = cur_status
                        if changed_steps:
                            # Attach accumulated thinking as details for completed steps
                            details_map = {}
                            for step in changed_steps:
                                sid = step["step_id"]
                                if step.get("status") in ("completed", "failed") and sid in step_thinking:
                                    thinking = "".join(step_thinking[sid])
                                    if thinking:
                                        details_map[sid] = thinking[:500]
                            chunks = slack_formatter.build_task_update_chunks(
                                changed_steps, step_details=details_map
                            )
                            try:
                                slack_client.chat_appendStream(
                                    channel=channel_id, ts=stream_ts, chunks=chunks
                                )
                                logger.info(
                                    f"[{thread_ts}] SLACK appendStream plan chunks: "
                                    f"{[c.get('id','?')+':'+c.get('status','?') for c in chunks]}"
                                )
                            except Exception as e:
                                logger.warning(f"[{thread_ts}] SLACK appendStream plan FAILED: {e}")

                    # Non-streaming: update throttler with structured plan
                    if throttler:
                        blocks = _build_progress_blocks(current_tool, plan_steps)
                        throttler.force_update(blocks, "Working on your request...")
                    # Update typing status with current step title (only for non-stream mode;
                    # when streaming, the plan card itself shows progress)
                    elif not stream_ts and current_step_id and current_step_id in plan_steps:
                        step_title = plan_steps[current_step_id].get("title", "")
                        if step_title:
                            _set_typing_status(f"is working on: {step_title}")

                    logger.info(f"[{thread_ts}] Received structured execution plan update ({len(plan_steps)} steps)")
                elif parsed.text_content:
                    # Text-only plan — no structured data, just log it
                    logger.info(f"[{thread_ts}] Received text-only execution plan (no structured steps)")

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
            # Clean up: stop active stream or delete progress message
            if stream_ts:
                try:
                    slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
                except Exception:
                    pass
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

        # Clear typing status before final response
        _set_typing_status("")

        # --- Finalization: single path per delivery mode ---
        # If stream was never started (no content arrived), start it now for the final answer
        _start_stream_if_needed()

        if stream_ts:
            # Everything in ONE stream message
            logger.info(
                f"[{thread_ts}] Finalizing plan stream: {len(final_text)} chars, "
                f"streamed_any_text={streamed_any_text}, "
                f"plan_steps={len(plan_steps)}, sent_step_status={sent_step_status}"
            )

            # 1. Force-complete all plan steps at finalization.
            # Steps left in_progress/pending when the stream ends cause Slack
            # to show "Something went wrong". Mark them all as complete.
            if plan_steps:
                final_chunks = []
                for step in plan_steps.values():
                    sid = step["step_id"]
                    cur_sent = sent_step_status.get(sid)
                    if cur_sent != "completed":
                        thinking = "".join(step_thinking.get(sid, []))
                        final_chunks.append(
                            slack_formatter.build_single_task_update(
                                step_id=sid,
                                title=slack_formatter._format_step_title(step),
                                status="completed",
                                details=thinking[:500] if thinking else None,
                            )
                        )
                if final_chunks:
                    try:
                        slack_client.chat_appendStream(
                            channel=channel_id, ts=stream_ts, chunks=final_chunks
                        )
                        logger.info(f"[{thread_ts}] SLACK appendStream final step completions: {len(final_chunks)}")
                    except Exception as e:
                        logger.warning(f"[{thread_ts}] SLACK appendStream final steps FAILED: {e}")

            # 2. Build stop call with final answer + feedback blocks.
            # For plan flows: always send final_text (streaming only updates
            # plan cards, the answer itself comes from final_result).
            # For no-plan flows: skip if text was already streamed live.
            stop_chunks = []
            needs_final = plan_steps or not streamed_any_text
            if needs_final and final_text:
                stop_chunks.append({"type": "markdown_text", "text": final_text})

            stop_blocks = _build_stream_final_blocks(
                channel_id, thread_ts, response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )
            logger.info(
                f"[{thread_ts}] SLACK stopStream: "
                f"chunks={len(stop_chunks)}, blocks={len(stop_blocks)}"
            )
            slack_client.chat_stopStream(
                channel=channel_id, ts=stream_ts,
                chunks=stop_chunks if stop_chunks else None,
                blocks=stop_blocks,
            )
            return stop_blocks

        elif can_stream:
            # startStream failed earlier — post as regular message
            logger.warning(f"[{thread_ts}] Stream not started, falling back to regular post")
            return _post_final_response(
                slack_client, channel_id, thread_ts, final_text,
                response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )
        else:
            # Bot user — delete progress msg, post final
            if response_ts:
                try:
                    slack_client.chat_delete(channel=channel_id, ts=response_ts)
                    logger.info(f"[{thread_ts}] Deleted progress message {response_ts}")
                except Exception as e:
                    logger.warning(f"[{thread_ts}] Could not delete progress message: {e}")
            return _post_final_response(
                slack_client, channel_id, thread_ts, final_text,
                response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
            )

    except Exception as e:
        logger.exception(f"[{thread_ts}] Error during streaming: {e}")
        error_blocks = slack_formatter.format_error_message(str(e))
        if stream_ts:
            # Stop the plan stream with error in blocks
            try:
                slack_client.chat_stopStream(
                    channel=channel_id, ts=stream_ts, blocks=error_blocks
                )
            except Exception as slack_err:
                logger.warning(f"[{thread_ts}] Failed to stop stream with error: {slack_err}")
        elif throttler:
            try:
                throttler.force_update(error_blocks, "Error")
            except Exception as slack_err:
                logger.warning(f"[{thread_ts}] Failed to post error to Slack: {slack_err}")
        else:
            try:
                slack_client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=thread_ts,
                    blocks=error_blocks,
                    text="Error",
                )
            except Exception as slack_err:
                logger.warning(f"[{thread_ts}] Failed to post error to Slack: {slack_err}")
        return error_blocks


_STEP_STATUS_EMOJI = {
    "pending": "⏳",
    "in_progress": "🔄",
    "completed": "✅",
    "failed": "❌",
}


def _build_progress_blocks(current_tool, plan_steps=None):
    """Build progress blocks for throttled updates (bot-user fallback)."""
    header_text = (
        f"*{APP_NAME} is {current_tool}-ing...*" if current_tool
        else f"*{APP_NAME} is working...*"
    )
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": header_text}}]
    if plan_steps:
        lines = []
        for step in sorted(plan_steps.values(), key=lambda s: s.get("order", 0)):
            status = step.get("status", "pending")
            emoji = _STEP_STATUS_EMOJI.get(status, "⏳")
            title = slack_formatter._format_step_title(step)
            lines.append(f"{emoji} {title}")
        plan_text = "\n".join(lines)
        if len(plan_text) <= 2000:
            blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": plan_text}]})
    return blocks


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
    original_ts,
    triggered_by_user_id=None,
    additional_footer=None,
):
    """Post final response as a regular message (fallback for bot messages)."""
    text_chunks = slack_formatter.split_text_into_blocks(final_text)

    final_blocks = []
    for chunk in text_chunks:
        final_blocks.append(
            {
                "type": "markdown",
                "text": chunk,
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


def _build_stream_final_blocks(
    channel_id, thread_ts, original_ts,
    triggered_by_user_id=None,
    additional_footer=None,
):
    """Build the feedback + footer blocks used by both stream types."""
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
                        "text": {"type": "plain_text", "text": "\U0001f44d"},
                        "value": f"positive|{original_ts or ''}",
                    },
                    "negative_button": {
                        "text": {"type": "plain_text", "text": "\U0001f44e"},
                        "value": f"negative|{original_ts or ''}",
                    },
                },
            ],
        }
    )

    # Build footer
    footer_text = _build_footer_text(
        triggered_by_user_id=triggered_by_user_id, additional_footer=additional_footer
    )
    final_blocks.append(
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": footer_text}],
        }
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
