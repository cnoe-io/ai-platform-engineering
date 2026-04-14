# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
AG-UI Streaming Integration

This module handles all interactions with dynamic agents via AG-UI protocol:
- Streaming responses from AI agents (stream_response)
- Non-streaming invoke for bot users (invoke_response)
- Alert processing with AI agents
- Real-time progress updates in Slack
"""

import json
import os
import time

from loguru import logger

from ..sse_client import SSEClient, SSEEventType, thread_ts_to_conversation_id
from . import slack_formatter
from . import utils as _utils
from .config import config

APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))


class StreamBuffer:
  """Batches markdown text chunks before flushing to Slack's appendStream.

  Flushes on newline boundaries to avoid splitting mid-markdown (e.g.
  sending ``**bold`` in one chunk and `` text**`` in the next, which
  Slack renders as broken formatting).  A max-interval flush (default 1s)
  acts as a safety net so content never stalls for too long even if
  newlines are sparse.
  """

  def __init__(self, slack_client, channel_id, stream_ts, flush_interval=1.0):
    self.slack_client = slack_client
    self.channel_id = channel_id
    self.stream_ts = stream_ts
    self.flush_interval = flush_interval
    self._buffer = ""
    self._last_flush = time.monotonic()
    self._flushed_any = False

  @property
  def has_flushed(self):
    return self._flushed_any

  def append(self, text):
    """Add text to the buffer; auto-flush on newline or after the interval."""
    self._buffer += text

    elapsed = time.monotonic() - self._last_flush

    # Prefer flushing on newline boundaries so markdown isn't split mid-token
    if "\n" in self._buffer:
      # Flush up to (and including) the last newline; keep the remainder
      last_nl = self._buffer.rfind("\n")
      to_flush = self._buffer[: last_nl + 1]
      self._buffer = self._buffer[last_nl + 1 :]
      if to_flush:
        self._send(to_flush)
    elif elapsed >= self.flush_interval:
      # No newline seen for a while — flush everything as a safety net
      self.flush()

  def flush(self):
    """Send all buffered text to Slack immediately. No-op if buffer is empty."""
    if not self._buffer:
      return False
    text = self._buffer
    self._buffer = ""
    return self._send(text)

  def _send(self, text):
    """Send *text* to Slack and update bookkeeping."""
    self._last_flush = time.monotonic()
    try:
      self.slack_client.chat_appendStream(
        channel=self.channel_id,
        ts=self.stream_ts,
        chunks=[{"type": "markdown_text", "text": text}],
      )
      self._flushed_any = True
      return True
    except Exception as e:
      logger.warning(f"SLACK appendStream text FAILED: {e}")
      return False


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


def stream_response(
  sse_client: SSEClient,
  slack_client,
  channel_id: str,
  thread_ts: str,
  message_text: str,
  team_id: str,
  user_id: str,
  agent_id: str,
  conversation_id: str,
  triggered_by_user_id=None,
  additional_footer=None,
  overthink_mode=False,
  escalation_config=None,
  is_resume=False,
  resume_form_data=None,
  resume_trace_id=None,
):
  """
  Stream an AG-UI response to Slack.

  Hybrid approach:
  1. Show typing indicator while waiting for first content
  2. Open Slack stream on first text chunk
  3. Buffer and flush markdown via StreamBuffer
  4. Show tool call progress as task_update chunks
  5. Finalize with feedback blocks on RUN_FINISHED

  Args:
      sse_client: SSEClient instance for dynamic agents.
      slack_client: Slack WebClient instance.
      channel_id: Slack channel ID.
      thread_ts: Slack thread timestamp.
      message_text: User's message text (ignored for resume).
      team_id: Slack team ID.
      user_id: Slack user ID.
      agent_id: Dynamic agent config ID.
      conversation_id: Deterministic UUID v5 from thread_ts.
      triggered_by_user_id: Optional user ID for footer attribution.
      additional_footer: Optional footer text.
      overthink_mode: If True, process silently and skip low-confidence responses.
      escalation_config: Optional escalation config for delete buttons.
      is_resume: If True, use resume_stream() instead of stream_chat().
      resume_form_data: JSON string of form data for resume.
      resume_trace_id: Trace ID for resume.

  Returns:
      List of Slack blocks for the final response, or dict with retry_needed=True
      on recoverable errors, or dict with skipped=True if overthink_mode filtered.
  """
  from .hitl_handler import parse_agui_interrupt, format_hitl_form_blocks

  # Streaming requires a valid user_id (starts with U or W), bot_ids (B) don't work
  can_stream = user_id and user_id[0] in ("U", "W")

  # Slack stream state
  thread_deleted = False
  stream_ts = None
  stream_buf = None
  response_ts = None  # progress message ts for non-streaming fallback

  # Tool tracking for progress display (bot-user fallback)
  current_tool = None
  active_tools = {}  # tool_call_id -> tool_name

  # Plan step tracking
  plan_steps = {}  # step_id -> step dict
  sent_step_status = {}  # step_id -> last sent status
  step_thinking = {}  # step_id -> accumulated thinking text

  # Content accumulation
  accumulated_text = []  # TEXT_MESSAGE_CONTENT deltas
  needs_separator = False

  # Loading messages shown in the animated typing indicator
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
    except Exception as e:
      logger.warning(f"[{thread_ts}] SLACK setStatus('{status_text}') FAILED: {e}")

  def _start_stream_if_needed():
    """Lazily start the Slack stream on first real content. Returns stream_ts or None."""
    nonlocal stream_ts, stream_buf, thread_deleted
    if thread_deleted:
      return None
    if stream_ts:
      return stream_ts
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
      stream_buf = StreamBuffer(slack_client, channel_id, stream_ts)
      logger.info(f"[{thread_ts}] SLACK startStream -> ts={stream_ts}")
      _set_typing_status("")
      return stream_ts
    except Exception as e:
      if "invalid_thread_ts" in str(e) or "thread_not_found" in str(e):
        thread_deleted = True
        logger.warning(f"[{thread_ts}] Thread was deleted mid-processing — aborting response")
      else:
        logger.warning(f"[{thread_ts}] SLACK startStream FAILED: {e}")
      return None

  if not overthink_mode:
    if can_stream:
      _set_typing_status("is thinking...", loading_messages=_loading_messages)
    else:
      # Non-streaming fallback: post a "working..." message
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

  # Choose stream source: resume or new
  if is_resume:
    event_stream = sse_client.resume_stream(
      agent_id=agent_id,
      conversation_id=conversation_id,
      form_data=resume_form_data or "",
      trace_id=resume_trace_id,
    )
  else:
    event_stream = sse_client.stream_chat(
      message=message_text,
      conversation_id=conversation_id,
      agent_id=agent_id,
    )

  try:
    for event in event_stream:
      if thread_deleted:
        logger.info(f"[{thread_ts}] Thread deleted — stopping stream processing")
        break

      # --- RUN_STARTED ---
      if event.type == SSEEventType.RUN_STARTED:
        if event.run_id:
          logger.info(f"[{thread_ts}] RUN_STARTED run_id={event.run_id}")

      # --- TEXT_MESSAGE_START ---
      elif event.type == SSEEventType.TEXT_MESSAGE_START:
        logger.debug(f"[{thread_ts}] TEXT_MESSAGE_START msg_id={event.message_id}")
        _start_stream_if_needed()

      # --- TEXT_MESSAGE_CONTENT ---
      elif event.type == SSEEventType.TEXT_MESSAGE_CONTENT:
        if event.delta:
          accumulated_text.append(event.delta)

          # Before the stream starts, show text as typing status
          if not stream_ts and not overthink_mode:
            status = event.delta.strip()
            if status:
              _set_typing_status(status[:80])
            continue

          _start_stream_if_needed()
          if stream_buf:
            text = event.delta
            if needs_separator and stream_buf.has_flushed:
              text = "\n\n" + text
              needs_separator = False
            stream_buf.append(text)

      # --- TEXT_MESSAGE_END ---
      elif event.type == SSEEventType.TEXT_MESSAGE_END:
        if stream_buf:
          stream_buf.flush()
        logger.debug(f"[{thread_ts}] TEXT_MESSAGE_END msg_id={event.message_id}")

      # --- TOOL_CALL_START ---
      elif event.type == SSEEventType.TOOL_CALL_START:
        if stream_buf:
          stream_buf.flush()
        tool_name = event.tool_call_name or event.tool_call_id or "unknown"
        current_tool = tool_name
        if event.tool_call_id:
          active_tools[event.tool_call_id] = tool_name
        logger.info(f"[{thread_ts}] Tool started: {tool_name}")
        # Open the stream on first tool call so the user sees progress
        _start_stream_if_needed()
        # Show tool as a task_update chunk (plan-like progress)
        if stream_ts and event.tool_call_id:
          try:
            chunk = slack_formatter.build_single_task_update(
              step_id=event.tool_call_id,
              title=tool_name,
              status="in_progress",
            )
            slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=[chunk])
          except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK appendStream tool start FAILED: {e}")

      # --- TOOL_CALL_ARGS ---
      elif event.type == SSEEventType.TOOL_CALL_ARGS:
        # Tool arguments — not displayed to user, just logged
        pass

      # --- TOOL_CALL_END ---
      elif event.type == SSEEventType.TOOL_CALL_END:
        tool_call_id = event.tool_call_id
        tool_name = active_tools.pop(tool_call_id, None) if tool_call_id else None
        display_name = tool_name or current_tool or "unknown"
        logger.info(f"[{thread_ts}] Tool completed: {display_name}")
        current_tool = None
        needs_separator = True
        # Update task_update chunk to completed
        if stream_ts and tool_call_id:
          try:
            chunk = slack_formatter.build_single_task_update(
              step_id=tool_call_id,
              title=display_name,
              status="completed",
            )
            slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=[chunk])
          except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK appendStream tool end FAILED: {e}")
        if not stream_ts:
          _set_typing_status("is working...")

      # --- STEP_STARTED ---
      elif event.type == SSEEventType.STEP_STARTED:
        step_name = event.name or event.run_id or "step"
        logger.info(f"[{thread_ts}] Step started: {step_name}")
        if not stream_ts:
          _set_typing_status(f"is working on: {step_name}")

      # --- STEP_FINISHED ---
      elif event.type == SSEEventType.STEP_FINISHED:
        step_name = event.name or event.run_id or "step"
        logger.info(f"[{thread_ts}] Step finished: {step_name}")

      # --- STATE_DELTA ---
      elif event.type == SSEEventType.STATE_DELTA:
        # Plan step updates via JSON Patch or structured delta
        if event.steps and isinstance(event.steps, list):
          if stream_buf:
            stream_buf.flush()
          for step in event.steps:
            if isinstance(step, dict) and "step_id" in step:
              plan_steps[step["step_id"]] = step
              # Send updates for changed steps
              if not overthink_mode:
                _start_stream_if_needed()
              cur_status = step.get("status", "pending")
              if stream_ts and (step["step_id"] not in sent_step_status or sent_step_status[step["step_id"]] != cur_status):
                sent_step_status[step["step_id"]] = cur_status
                try:
                  chunk = slack_formatter.build_single_task_update(
                    step_id=step["step_id"],
                    title=slack_formatter._format_step_title(step),
                    status=cur_status,
                  )
                  slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=[chunk])
                except Exception as e:
                  logger.warning(f"[{thread_ts}] SLACK appendStream step update FAILED: {e}")
              elif not stream_ts and cur_status == "in_progress":
                title = step.get("title", "working")
                _set_typing_status(f"is working on: {title}")

      # --- STATE_SNAPSHOT ---
      elif event.type == SSEEventType.STATE_SNAPSHOT:
        # Full state snapshot — logged but not acted on (deferred per spec)
        if event.snapshot:
          logger.debug(f"[{thread_ts}] STATE_SNAPSHOT received ({len(event.snapshot)} keys)")

      # --- CUSTOM ---
      elif event.type == SSEEventType.CUSTOM:
        if event.name == "WARNING":
          warning_msg = (event.value or {}).get("message", "unknown warning")
          logger.warning(f"[{thread_ts}] Agent warning: {warning_msg}")
        elif event.name == "NAMESPACE_CONTEXT":
          namespace = (event.value or {}).get("namespace", [])
          logger.info(f"[{thread_ts}] Subagent context: {namespace}")
        elif event.name == "TOOL_ERROR":
          tool_error = (event.value or {}).get("error", "unknown error")
          tool_id = (event.value or {}).get("tool_call_id")
          logger.warning(f"[{thread_ts}] Tool error (call={tool_id}): {tool_error}")
          # Mark tool as failed in UI if we have the ID
          if stream_ts and tool_id and tool_id in active_tools:
            tool_name = active_tools.pop(tool_id, "unknown")
            try:
              chunk = slack_formatter.build_single_task_update(
                step_id=tool_id,
                title=tool_name,
                status="failed",
              )
              slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=[chunk])
            except Exception as e:
              logger.warning(f"[{thread_ts}] SLACK appendStream tool error FAILED: {e}")
        else:
          logger.debug(f"[{thread_ts}] CUSTOM event: name={event.name}")

      # --- RUN_FINISHED ---
      elif event.type == SSEEventType.RUN_FINISHED:
        outcome = event.outcome or "success"
        logger.info(f"[{thread_ts}] RUN_FINISHED outcome={outcome}")

        if outcome == "interrupt" and event.interrupt:
          # HITL interrupt — render form and return
          logger.info(f"[{thread_ts}] HITL interrupt: {event.interrupt.get('reason', 'unknown')}")
          form = parse_agui_interrupt(
            event,
            conversation_id=conversation_id,
            agent_id=agent_id,
          )
          form_blocks = format_hitl_form_blocks(form)

          # Stop any active stream before posting the form
          if stream_ts:
            try:
              slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
            except Exception as e:
              logger.debug(f"[{thread_ts}] Failed to stop stream before HITL form: {e}")

          # Post or update with form blocks
          if response_ts:
            try:
              slack_client.chat_update(
                channel=channel_id,
                ts=response_ts,
                blocks=form_blocks,
                text="Action required",
              )
            except Exception:
              slack_client.chat_postMessage(
                channel=channel_id,
                thread_ts=thread_ts,
                blocks=form_blocks,
                text="Action required",
              )
          else:
            slack_client.chat_postMessage(
              channel=channel_id,
              thread_ts=thread_ts,
              blocks=form_blocks,
              text="Action required",
            )
          return form_blocks

        # outcome == "success" — handled in finalization below
        break

      # --- RUN_ERROR ---
      elif event.type == SSEEventType.RUN_ERROR:
        error_msg = event.message or "Unknown agent error"
        logger.error(f"[{thread_ts}] RUN_ERROR: {error_msg}")

        # If we got any text content, show it despite the error
        final_text = "".join(accumulated_text).strip()
        if final_text and final_text != "I've completed your request.":
          logger.info(f"[{thread_ts}] Recovered from error — showing {len(final_text)} chars of content")
          # Fall through to finalization
          break

        # No content — return retry marker
        if stream_ts:
          try:
            error_blocks = slack_formatter.format_error_message(error_msg)
            error_blocks.extend(
              _build_stream_final_blocks(
                channel_id,
                thread_ts,
                response_ts,
                triggered_by_user_id=triggered_by_user_id,
                additional_footer=additional_footer,
                escalation_config=escalation_config,
              )
            )
            slack_client.chat_stopStream(channel=channel_id, ts=stream_ts, blocks=error_blocks)
          except Exception as e:
            logger.warning(f"[{thread_ts}] Failed to stop stream with error: {e}")
        if response_ts:
          try:
            slack_client.chat_delete(channel=channel_id, ts=response_ts)
          except Exception as e:
            logger.debug(f"[{thread_ts}] Failed to delete message {response_ts}: {e}")
        return {"retry_needed": True, "error": error_msg}

      # --- RAW / unknown ---
      elif event.type == SSEEventType.RAW:
        logger.debug(f"[{thread_ts}] RAW event (ignored)")

    # --- Finalization ---
    final_text = "".join(accumulated_text).strip()

    # Overthink mode: check for skip markers
    if overthink_mode and final_text:
      skip_result = _check_overthink_skip(final_text, thread_ts)
      if skip_result:
        return skip_result
      if "[CONFIDENCE: HIGH]" in final_text:
        final_text = final_text.replace("[CONFIDENCE: HIGH]", "").rstrip()
        logger.info(f"[{thread_ts}] Stripped [CONFIDENCE: HIGH] marker from response")

    # Default fallback
    if not final_text:
      final_text = "I've completed your request."

    logger.info(f"[{thread_ts}] Final text: {len(final_text)} chars")

    # Clear typing status
    _set_typing_status("")

    # Start stream if never started
    _start_stream_if_needed()

    if stream_ts:
      # Flush remaining buffer
      if stream_buf:
        stream_buf.flush()

      streamed_any_text = stream_buf.has_flushed if stream_buf else False

      # Force-complete any pending plan steps
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
            slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=final_chunks)
          except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK appendStream final steps FAILED: {e}")

      # Build stop call
      stop_chunks = []
      if not streamed_any_text and final_text:
        stop_chunks.append({"type": "markdown_text", "text": final_text})

      stop_blocks = _build_stream_final_blocks(
        channel_id,
        thread_ts,
        response_ts,
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
        escalation_config=escalation_config,
      )
      logger.info(f"[{thread_ts}] SLACK stopStream: chunks={len(stop_chunks)}, blocks={len(stop_blocks)}")
      try:
        slack_client.chat_stopStream(
          channel=channel_id,
          ts=stream_ts,
          chunks=stop_chunks if stop_chunks else None,
          blocks=stop_blocks,
        )
        return stop_blocks
      except Exception as stop_err:
        err_str = str(stop_err)
        if "message_not_in_streaming_state" in err_str or "not_in_streaming_state" in err_str:
          logger.warning(f"[{thread_ts}] Streaming message expired — posting final answer as regular message")
          return _post_final_response(
            slack_client,
            channel_id,
            thread_ts,
            final_text,
            response_ts,
            triggered_by_user_id=triggered_by_user_id,
            additional_footer=additional_footer,
            escalation_config=escalation_config,
          )
        raise

    elif can_stream:
      if thread_deleted:
        logger.warning(f"[{thread_ts}] Thread deleted — dropping response")
        return None
      logger.warning(f"[{thread_ts}] Stream not started, falling back to regular post")
      return _post_final_response(
        slack_client,
        channel_id,
        thread_ts,
        final_text,
        response_ts,
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
        escalation_config=escalation_config,
      )
    else:
      if thread_deleted:
        logger.warning(f"[{thread_ts}] Thread deleted — dropping response")
        return None
      # Bot user — delete progress msg, post final
      if response_ts:
        try:
          slack_client.chat_delete(channel=channel_id, ts=response_ts)
          logger.info(f"[{thread_ts}] Deleted progress message {response_ts}")
        except Exception as e:
          logger.warning(f"[{thread_ts}] Could not delete progress message: {e}")
      return _post_final_response(
        slack_client,
        channel_id,
        thread_ts,
        final_text,
        response_ts,
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
        escalation_config=escalation_config,
      )

  except Exception as e:
    logger.exception(f"[{thread_ts}] Error during streaming: {e}")
    error_blocks = slack_formatter.format_error_message(str(e))
    try:
      error_blocks.extend(
        _build_stream_final_blocks(
          channel_id,
          thread_ts,
          response_ts,
          triggered_by_user_id=triggered_by_user_id,
          additional_footer=additional_footer,
          escalation_config=escalation_config,
        )
      )
    except Exception:
      logger.warning(f"[{thread_ts}] Failed to build feedback blocks for error response")
    if stream_ts:
      try:
        slack_client.chat_stopStream(channel=channel_id, ts=stream_ts, blocks=error_blocks)
      except Exception as slack_err:
        logger.warning(f"[{thread_ts}] Failed to stop stream with error: {slack_err}")
    elif response_ts:
      try:
        slack_client.chat_update(
          channel=channel_id,
          ts=response_ts,
          blocks=error_blocks,
          text="Error",
        )
      except Exception as slack_err:
        logger.warning(f"[{thread_ts}] Failed to post error to Slack: {slack_err}")
    elif not thread_deleted:
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


def invoke_response(
  sse_client: SSEClient,
  slack_client,
  channel_id: str,
  thread_ts: str,
  message_text: str,
  agent_id: str,
  conversation_id: str,
  triggered_by_user_id=None,
  additional_footer=None,
  escalation_config=None,
):
  """
  Non-streaming invoke for bot users.

  Calls the invoke endpoint and posts the response as a regular message.

  Returns:
      List of Slack blocks for the response, or dict with retry_needed=True on errors.
  """
  try:
    result = sse_client.invoke(
      message=message_text,
      conversation_id=conversation_id,
      agent_id=agent_id,
    )

    if not result.get("success", True):
      error_msg = result.get("error", "Invoke failed")
      logger.error(f"[{thread_ts}] Invoke error: {error_msg}")
      return {"retry_needed": True, "error": error_msg}

    content = result.get("content", "I've completed your request.")
    if not content or not content.strip():
      content = "I've completed your request."

    return _post_final_response(
      slack_client,
      channel_id,
      thread_ts,
      content.strip(),
      None,
      triggered_by_user_id=triggered_by_user_id,
      additional_footer=additional_footer,
      escalation_config=escalation_config,
    )

  except Exception as e:
    logger.exception(f"[{thread_ts}] Error during invoke: {e}")
    error_blocks = slack_formatter.format_error_message(str(e))
    try:
      error_blocks.extend(
        _build_stream_final_blocks(
          channel_id,
          thread_ts,
          None,
          triggered_by_user_id=triggered_by_user_id,
          additional_footer=additional_footer,
          escalation_config=escalation_config,
        )
      )
    except Exception:
      pass
    slack_client.chat_postMessage(
      channel=channel_id,
      thread_ts=thread_ts,
      blocks=error_blocks,
      text="Error",
    )
    return error_blocks


_STEP_STATUS_EMOJI = {
  "pending": "⏳",
  "in_progress": "🔄",
  "completed": "✅",
  "failed": "❌",
}


def _build_progress_blocks(current_tool, plan_steps=None):
  """Build progress blocks for throttled updates (bot-user fallback)."""
  header_text = f"*{APP_NAME} is {current_tool}-ing...*" if current_tool else f"*{APP_NAME} is working...*"
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
  if "[DEFER]" in final_text:
    logger.info(f"[{thread_ts}] Overthink: skipping response (DEFER - human action needed)")
    return {"skipped": True, "reason": "defer"}

  if "[LOW_CONFIDENCE]" in final_text:
    logger.info(f"[{thread_ts}] Overthink: skipping response (LOW_CONFIDENCE - no good sources)")
    logger.debug(f"[{thread_ts}] LOW_CONFIDENCE response: {final_text}")
    return {"skipped": True, "reason": "low_confidence"}

  return None


def _post_final_response(
  slack_client,
  channel_id,
  thread_ts,
  final_text,
  original_ts,
  triggered_by_user_id=None,
  additional_footer=None,
  escalation_config=None,
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

  final_blocks.extend(
    _build_stream_final_blocks(
      channel_id,
      thread_ts,
      original_ts,
      triggered_by_user_id=triggered_by_user_id,
      additional_footer=additional_footer,
      escalation_config=escalation_config,
    )
  )

  slack_client.chat_postMessage(
    channel=channel_id,
    thread_ts=thread_ts,
    blocks=final_blocks,
    text=final_text[:100],
  )

  return final_blocks


def _build_stream_final_blocks(
  channel_id,
  thread_ts,
  original_ts,
  triggered_by_user_id=None,
  additional_footer=None,
  escalation_config=None,
):
  """Build the feedback + footer blocks used by both stream types."""
  final_blocks = []
  action_value = f"{channel_id}|{thread_ts}|{original_ts or ''}"

  context_elements = [
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
  ]
  if escalation_config and escalation_config.delete_admins:
    context_elements.append(
      {
        "type": "icon_button",
        "action_id": "caipe_delete_message",
        "text": {"type": "plain_text", "text": "Delete"},
        "icon": "trash",
        "value": action_value,
        "accessibility_label": "Delete this response",
      }
    )
  final_blocks.append({"type": "context_actions", "elements": context_elements})

  footer_text = _build_footer_text(triggered_by_user_id=triggered_by_user_id, additional_footer=additional_footer)
  final_blocks.append(
    {
      "type": "context",
      "elements": [{"type": "mrkdwn", "text": footer_text}],
    }
  )

  return final_blocks


def handle_ai_alert_processing(
  sse_client: SSEClient,
  slack_client,
  event,
  channel_id,
  bot_username,
  channel_config,
  agent_id: str,
  custom_prompt=None,
  escalation_config=None,
):
  """AI-powered alert processing.

  Args:
      sse_client: SSEClient for dynamic agents.
      slack_client: Slack WebClient.
      event: Slack event dict.
      channel_id: Slack channel ID.
      bot_username: Name of the bot that triggered the alert.
      channel_config: JiraConfig for the channel.
      agent_id: Dynamic agent config ID.
      custom_prompt: Optional custom prompt template.
      escalation_config: Optional escalation config.
  """
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

  jira_config_str = json.dumps(channel_config.model_dump(), indent=2)
  jira_project = channel_config.project_key
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

  if not _utils.verify_thread_exists(slack_client, channel_id, thread_ts):
    logger.warning(f"[{thread_ts}] Ignoring alert — parent message was deleted")
    return None

  if config.silence_env:
    logger.info(f"[{thread_ts}] Silencing AI alert processing")
    return "Silenced"

  conversation_id = thread_ts_to_conversation_id(thread_ts)

  result = stream_response(
    sse_client=sse_client,
    slack_client=slack_client,
    channel_id=channel_id,
    thread_ts=thread_ts,
    message_text=prompt,
    team_id=team_id,
    user_id=user_id,
    agent_id=agent_id,
    conversation_id=conversation_id,
    escalation_config=escalation_config,
  )

  logger.info(f"[{thread_ts}] AI processed alert from {bot_username}")
  return result
