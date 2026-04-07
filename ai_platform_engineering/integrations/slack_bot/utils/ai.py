# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Slack AI Streaming Integration

This module handles all interactions with the CAIPE supervisor, including:
- Streaming responses via SSE (the only streaming path for the Slack bot)
- Alert processing and Jira ticket creation
- Real-time progress updates in Slack
"""

import json
import os
import time

from loguru import logger

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
    logger.info(f"[{thread_ts}] Overthink: skipping response (LOW_CONFIDENCE - no good sources)")
    logger.debug(f"[{thread_ts}] LOW_CONFIDENCE response: {final_text}")
    return {"skipped": True, "reason": "low_confidence"}

  # Response has content, allow posting
  return None


def _get_final_text(final_result_text, partial_result_text, final_message_text, artifacts, thread_ts):
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
  triggered_by_user_id=None,
  additional_footer=None,
  escalation_config=None,
):
  """Post final response as a regular message (fallback when streaming unavailable)."""
  text_chunks = slack_formatter.split_text_into_blocks(final_text)

  final_blocks = []
  for chunk in text_chunks:
    final_blocks.append(
      {
        "type": "markdown",
        "text": chunk,
      }
    )

  # Append feedback + footer blocks
  final_blocks.extend(
    _build_feedback_blocks(
      channel_id, thread_ts,
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


def _build_feedback_blocks(
  channel_id,
  thread_ts,
  triggered_by_user_id=None,
  additional_footer=None,
  escalation_config=None,
):
  """Build the feedback + footer blocks appended to all responses."""
  final_blocks = []
  action_value = f"{channel_id}|{thread_ts}"

  # Add thumbs up/down feedback buttons (and optional trash icon)
  context_elements = [
    {
      "type": "feedback_buttons",
      "action_id": "caipe_feedback",
      "positive_button": {
        "text": {"type": "plain_text", "text": "\U0001f44d"},
        "value": f"positive|{thread_ts}",
        "accessibility_label": "Submit positive feedback on this response",
      },
      "negative_button": {
        "text": {"type": "plain_text", "text": "\U0001f44e"},
        "value": f"negative|{thread_ts}",
        "accessibility_label": "Submit negative feedback on this response",
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

  # Build footer
  footer_text = _build_footer_text(triggered_by_user_id=triggered_by_user_id, additional_footer=additional_footer)
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


def stream_sse_response(
  sse_client,
  slack_client,
  channel_id,
  thread_ts,
  message_text,
  team_id,
  user_id,
  conversation_id=None,
  user_email=None,
  trace_id=None,
  session_manager=None,
  triggered_by_user_id=None,
  additional_footer=None,
  overthink_mode=False,
  escalation_config=None,
):
  """
  Stream a response from the Platform Engineer SSE endpoint to Slack.

  Uses the simple /chat/stream SSE endpoint instead of the A2A protocol.
  Drives the same Slack streaming API (startStream/appendStream/stopStream)
  and reuses all existing plan-card, feedback, and fallback logic.

  Returns:
      List of Slack blocks for the final response, or dict with retry_needed=True
      on recoverable errors, or dict with skipped=True if overthink_mode filtered
      the response.
  """
  try:
    from ..sse_client import ChatRequest, SSEEventType
  except ImportError:
    # Fallback for direct execution where slack_bot/ is on sys.path
    from sse_client import ChatRequest, SSEEventType  # type: ignore[no-redef]

  # Plan-mode streaming state
  thread_deleted = False
  stream_ts = None
  stream_buf = None
  plan_steps = {}        # step_id -> step dict
  sent_step_status = {}  # step_id -> last status sent to Slack
  needs_separator = False
  active_plan_step_id = None   # step_id of the current in_progress step
  step_thinking_buf = {}       # step_id -> accumulated thinking text

  _loading_messages = [
    "is thinking...",
    "Convincing the AI to stop overthinking...",
    "is resorting to some magic",
  ]

  def _set_typing_status(status_text, loading_messages=None):
    if overthink_mode:
      return
    try:
      kwargs = dict(channel_id=channel_id, thread_ts=thread_ts, status=status_text)
      if loading_messages:
        kwargs["loading_messages"] = loading_messages
      slack_client.assistant_threads_setStatus(**kwargs)
    except Exception as e:
      logger.warning(f"[{thread_ts}] SLACK setStatus('{status_text}') FAILED: {e}")

  def _start_stream_if_needed():
    nonlocal stream_ts, stream_buf, thread_deleted
    if thread_deleted:
      return None
    if stream_ts:
      return stream_ts
    if overthink_mode:
      return None
    try:
      effective_team_id = team_id
      effective_user_id = user_id if user_id and user_id[0] in ("U", "W") else None

      if not effective_team_id or not effective_user_id:
        try:
          auth_info = slack_client.auth_test()
          if not effective_team_id:
            effective_team_id = auth_info.get("team_id")
          if not effective_user_id:
            effective_user_id = auth_info.get("user_id")
        except Exception as auth_err:
          logger.warning(f"[{thread_ts}] Failed to get info from auth_test: {auth_err}")

      start_kwargs = {
        "channel": channel_id,
        "thread_ts": thread_ts,
        "recipient_team_id": effective_team_id,
        "recipient_user_id": effective_user_id,
        "task_display_mode": "plan",
      }
      start_response = slack_client.chat_startStream(**start_kwargs)
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
    _set_typing_status("is thinking...", loading_messages=_loading_messages)

  final_text_parts: list[str] = []
  streaming_final_answer = False
  current_tool = None
  task_error = None

  try:
    request = ChatRequest(
      message=message_text,
      conversation_id=conversation_id,
      user_email=user_email,
      trace_id=trace_id,
      source="slack",
      slack_channel_id=channel_id,
      slack_thread_ts=thread_ts,
      slack_user_id=user_id,
    )

    for event in sse_client.stream_chat(request):
      if thread_deleted:
        logger.info(f"[{thread_ts}] Thread deleted — stopping SSE stream processing")
        break

      if event.type == SSEEventType.RUN_STARTED:
        logger.info(f"[{thread_ts}] AG-UI run started, run_id={event.run_id}")

      elif event.type == SSEEventType.TEXT_MESSAGE_START:
        logger.debug(f"[{thread_ts}] AG-UI text message start, message_id={event.message_id}")

      elif event.type == SSEEventType.TEXT_MESSAGE_CONTENT:
        text = event.delta or ""
        if text:
          final_text_parts.append(text)
          # Accumulate thinking text under the active plan step
          if active_plan_step_id:
            step_thinking_buf.setdefault(active_plan_step_id, [])
            step_thinking_buf[active_plan_step_id].append(text)
          else:
            _start_stream_if_needed()
            if stream_buf:
              out = text
              if needs_separator and stream_buf.has_flushed:
                out = "\n\n" + out
                needs_separator = False
              stream_buf.append(out)
          streaming_final_answer = True

      elif event.type == SSEEventType.TEXT_MESSAGE_END:
        logger.debug(f"[{thread_ts}] AG-UI text message end, message_id={event.message_id}")

      elif event.type == SSEEventType.TOOL_CALL_START:
        if stream_buf:
          stream_buf.flush()
        current_tool = event.tool_call_name or "(unknown)"
        logger.info(f"[{thread_ts}] Tool started: {current_tool}")
        if not overthink_mode:
          _start_stream_if_needed()
        if not stream_ts and current_tool:
          _set_typing_status(f"is {current_tool}-ing...")

      elif event.type == SSEEventType.TOOL_CALL_END:
        display_name = event.tool_call_name or current_tool or "(unknown)"
        logger.info(f"[{thread_ts}] Tool completed: {display_name}")
        current_tool = None
        needs_separator = True
        if not stream_ts:
          _set_typing_status("is working...")

      elif event.type == SSEEventType.STATE_DELTA:
        # STATE_DELTA carries plan step updates as JSON Patch operations
        if stream_buf:
          stream_buf.flush()
        steps = event.steps or []
        if steps:
          for step in steps:
            if isinstance(step, dict) and "step_id" in step:
              plan_steps[step["step_id"]] = step

          # Track the currently active (in_progress) plan step
          active_plan_step_id = None
          for s in plan_steps.values():
            if s.get("status") == "in_progress":
              active_plan_step_id = s["step_id"]

          if not overthink_mode:
            _start_stream_if_needed()
          if not overthink_mode and stream_ts:
            changed_steps = []
            for step in steps:
              if not isinstance(step, dict) or "step_id" not in step:
                continue
              sid = step["step_id"]
              cur_status = step.get("status", "pending")
              if sid not in sent_step_status or sent_step_status[sid] != cur_status:
                changed_steps.append(step)
                sent_step_status[sid] = cur_status
            if changed_steps:
              # Attach accumulated thinking text as details for completed/failed steps
              details_map = {}
              for step in changed_steps:
                sid = step["step_id"]
                if step.get("status") in ("completed", "failed") and sid in step_thinking_buf:
                  thinking = "".join(step_thinking_buf[sid])
                  if thinking:
                    details_map[sid] = thinking[:500]
              chunks = slack_formatter.build_task_update_chunks(changed_steps, step_details=details_map)
              try:
                slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=chunks)
                logger.info(f"[{thread_ts}] SLACK appendStream plan chunks: {len(chunks)}")
              except Exception as e:
                logger.warning(f"[{thread_ts}] SLACK appendStream plan FAILED: {e}")

          logger.info(f"[{thread_ts}] Received AG-UI STATE_DELTA plan update ({len(plan_steps)} steps)")

      elif event.type == SSEEventType.STATE_SNAPSHOT:
        # STATE_SNAPSHOT carries the full LangGraph state including todos from write_todos
        snapshot = event.snapshot or {}
        todos = snapshot.get("todos")
        if isinstance(todos, list) and todos:
          if stream_buf:
            stream_buf.flush()
          # Convert todos [{content, status}] → plan steps [{step_id, title, status}]
          for idx, todo in enumerate(todos):
            if not isinstance(todo, dict):
              continue
            sid = todo.get("id") or f"todo-{idx}"
            plan_steps[sid] = {
              "step_id": sid,
              "title": todo.get("content", ""),
              "status": todo.get("status", "pending"),
            }

          # Track the currently active (in_progress) plan step
          active_plan_step_id = None
          for s in plan_steps.values():
            if s.get("status") == "in_progress":
              active_plan_step_id = s["step_id"]

          if not overthink_mode:
            _start_stream_if_needed()
          if not overthink_mode and stream_ts:
            changed_steps = []
            for sid, step in plan_steps.items():
              cur_status = step.get("status", "pending")
              if sid not in sent_step_status or sent_step_status[sid] != cur_status:
                changed_steps.append(step)
                sent_step_status[sid] = cur_status
            if changed_steps:
              # Attach accumulated thinking text as details for completed/failed steps
              details_map = {}
              for step in changed_steps:
                sid = step["step_id"]
                if step.get("status") in ("completed", "failed") and sid in step_thinking_buf:
                  thinking = "".join(step_thinking_buf[sid])
                  if thinking:
                    details_map[sid] = thinking[:500]
              chunks = slack_formatter.build_task_update_chunks(changed_steps, step_details=details_map)
              try:
                slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=chunks)
                logger.info(f"[{thread_ts}] SLACK appendStream todo chunks: {len(chunks)}")
              except Exception as e:
                logger.warning(f"[{thread_ts}] SLACK appendStream todos FAILED: {e}")

          logger.info(f"[{thread_ts}] Received AG-UI STATE_SNAPSHOT with {len(todos)} todos")

      elif event.type == SSEEventType.CUSTOM:
        # CUSTOM events with name=INPUT_REQUIRED trigger a Block Kit HITL form
        if event.name == "INPUT_REQUIRED":
          input_value = event.value or {}
          fields = input_value.get("fields", []) if isinstance(input_value, dict) else []
          logger.info(f"[{thread_ts}] Input required — fields: {fields}")
          # Stop any active stream before returning
          if stream_ts:
            try:
              slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
            except Exception as e:
              logger.debug(f"[{thread_ts}] Failed to stop stream before INPUT_REQUIRED: {e}")
          # Post plain message asking for input
          fields_text = ", ".join(f.get("label", f.get("name", "?")) for f in fields)
          slack_client.chat_postMessage(
            channel=channel_id,
            thread_ts=thread_ts,
            text=f"Input required. Please provide: {fields_text}" if fields_text else "Input required.",
          )
          return []
        else:
          logger.debug(f"[{thread_ts}] AG-UI CUSTOM event: name={event.name}")

      elif event.type == SSEEventType.RUN_FINISHED:
        run_id = event.run_id
        if run_id and session_manager:
          session_manager.set_trace_id(thread_ts, run_id)
          logger.info(f"[{thread_ts}] Stored run_id for feedback: {run_id}")
        logger.info(f"[{thread_ts}] AG-UI run finished, run_id={run_id}")

      elif event.type == SSEEventType.RUN_ERROR:
        task_error = event.message or "Unknown error from SSE endpoint"
        logger.error(f"[{thread_ts}] AG-UI run error: {task_error}")

    final_text = "".join(final_text_parts).strip() or None

    # Overthink mode filtering
    if overthink_mode and final_text:
      skip_result = _check_overthink_skip(final_text, thread_ts)
      if skip_result:
        return skip_result
      if "[CONFIDENCE: HIGH]" in final_text:
        final_text = final_text.replace("[CONFIDENCE: HIGH]", "").rstrip()

    if not final_text and task_error:
      logger.error(f"[{thread_ts}] No content received and SSE had error: {task_error}")
      if stream_ts:
        try:
          error_blocks = slack_formatter.format_error_message(str(task_error))
          error_blocks.extend(
            _build_feedback_blocks(
              channel_id, thread_ts,
              triggered_by_user_id=triggered_by_user_id,
              additional_footer=additional_footer,
              escalation_config=escalation_config,
            )
          )
          slack_client.chat_stopStream(channel=channel_id, ts=stream_ts, blocks=error_blocks)
        except Exception as e:
          logger.debug(f"[{thread_ts}] Failed to stop stream {stream_ts}: {e}")
      return {"retry_needed": True, "error": task_error}

    _set_typing_status("")
    _start_stream_if_needed()

    if stream_ts:
      if stream_buf:
        stream_buf.flush()

      # Force-complete any plan steps still in_progress/pending
      if plan_steps:
        final_chunks = []
        for step in plan_steps.values():
          sid = step["step_id"]
          if sent_step_status.get(sid) != "completed":
            thinking = "".join(step_thinking_buf.get(sid, []))
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

      stop_chunks = []
      if not streaming_final_answer and final_text:
        stop_chunks.append({"type": "markdown_text", "text": final_text})

      stop_blocks = _build_feedback_blocks(
        channel_id, thread_ts,
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
        escalation_config=escalation_config,
      )
      slack_client.chat_stopStream(
        channel=channel_id,
        ts=stream_ts,
        chunks=stop_chunks if stop_chunks else None,
        blocks=stop_blocks,
      )
      return stop_blocks

    else:
      if thread_deleted:
        logger.warning(f"[{thread_ts}] Thread deleted — dropping response")
        return None
      logger.info(f"[{thread_ts}] Stream not started, posting final response directly")
      return _post_final_response(
        slack_client,
        channel_id,
        thread_ts,
        final_text or "I've completed your request.",
        triggered_by_user_id=triggered_by_user_id,
        additional_footer=additional_footer,
        escalation_config=escalation_config,
      )

  except Exception as e:
    logger.exception(f"[{thread_ts}] Error during SSE streaming: {e}")
    error_blocks = slack_formatter.format_error_message(str(e))
    try:
      error_blocks.extend(
        _build_feedback_blocks(
          channel_id, thread_ts,
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


def handle_ai_alert_processing(
  sse_client,
  slack_client,
  event,
  channel_id,
  bot_username,
  channel_config,
  session_manager,
  custom_prompt=None,
  escalation_config=None,
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

  # channel_config is now a JiraConfig model
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

  context_id = session_manager.get_context_id(thread_ts)

  result = stream_sse_response(
    sse_client=sse_client,
    slack_client=slack_client,
    channel_id=channel_id,
    thread_ts=thread_ts,
    message_text=prompt,
    team_id=team_id,
    user_id=user_id,
    conversation_id=context_id,
    session_manager=session_manager,
    escalation_config=escalation_config,
  )

  logger.info(f"[{thread_ts}] AI processed alert from {bot_username}")
  return result
