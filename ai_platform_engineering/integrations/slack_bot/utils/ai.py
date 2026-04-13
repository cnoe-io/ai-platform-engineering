# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
A2A Streaming Integration

This module handles all interactions with the CAIPE supervisor, including:
- Streaming responses from AI agents
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
from .event_parser import (
  parse_event,
  EventType,
)
from .throttler import create_throttled_updater

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
  escalation_config=None,
):
  """
  Stream an A2A response to Slack.

  Hybrid approach:
  1. Throttled updates during processing (tools, execution plan)
  2. Stream final output using Slack's streaming API

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
  thread_deleted = False  # True if Slack reports the thread_ts is gone
  stream_ts = None  # ts from chat.startStream (None = not started)
  stream_buf = None  # StreamBuffer instance (created when stream starts)
  plan_steps = {}  # step_id -> step dict (latest plan state)
  sent_step_status = {}  # step_id -> last status we sent to Slack
  step_thinking = {}  # step_id -> accumulated thinking text per step
  current_step_id = None  # which step is in_progress
  needs_separator = False  # insert \n\n before next streamed markdown (after tool_end)

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
      # logger.info(f"[{thread_ts}] SLACK setStatus('{status_text}')")
    except Exception as e:
      logger.warning(f"[{thread_ts}] SLACK setStatus('{status_text}') FAILED: {e}")

  def _start_stream_if_needed():
    """Lazily start the Slack stream on first real content. Returns stream_ts or None."""
    nonlocal stream_ts, stream_buf, thread_deleted
    if thread_deleted:
      return None
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
      stream_buf = StreamBuffer(slack_client, channel_id, stream_ts)
      logger.info(f"[{thread_ts}] SLACK startStream -> ts={stream_ts}")
      # Clear the typing status now that the stream message is visible
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
  any_subagent_completed = False  # Set after first sub-agent TOOL_NOTIFICATION_END; suppress post-tool echoes
  completed_tool_names = set()  # Track which tools have completed for sub-agent vs RAG distinction
  task_error = None  # Track errors but don't raise immediately - allow recovery
  trace_id = None  # Langfuse trace ID for feedback scoring
  # streamed_any_text is tracked by stream_buf.has_flushed
  streaming_final_answer = False  # Latch: once last plan step streams, keep streaming

  try:
    for event_data in a2a_client.send_message_stream(
      message_text=message_text,
      context_id=context_id,
      metadata=metadata,
    ):
      if thread_deleted:
        logger.info(f"[{thread_ts}] Thread deleted — stopping A2A stream processing")
        break

      parsed = parse_event(event_data)

      # # Debug: uncomment to log every A2A event for diagnostics
      # _artifact_name = parsed.artifact_name or ""
      # _text_len = len(parsed.text_content) if parsed.text_content else 0
      # _extra = ""
      # if parsed.plan_data:
      #     _statuses = [f"{s.get('step_id','?')}:{s.get('status','?')}" for s in parsed.plan_data.get("steps", [])]
      #     _extra = f" steps=[{', '.join(_statuses)}]"
      # elif parsed.tool_notification:
      #     _extra = f" tool={parsed.tool_notification.tool_name} status={parsed.tool_notification.status}"
      # elif _text_len:
      #     _preview = (parsed.text_content or "")[:80].replace("\n", "\\n")
      #     _extra = f" preview={_preview!r}"
      # logger.info(
      #     f"[{thread_ts}] A2A #{event_data.get('kind', '?')}: "
      #     f"type={parsed.event_type.value} artifact={_artifact_name!r} "
      #     f"text_len={_text_len} append={parsed.should_append} "
      #     f"final={parsed.is_final}{_extra}"
      # )

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
        if parsed.text_content:
          # Deterministic chunker tags its chunks with is_final_answer=True.
          # Latch streaming_final_answer so the FINAL_RESULT handler skips
          # re-streaming the same content (prevents duplicate output).
          artifact_meta = (parsed.artifact or {}).get("metadata", {})
          if artifact_meta.get("is_final_answer") and not streaming_final_answer:
            streaming_final_answer = True

          # Track plan progress and latch final-answer streaming.
          if current_step_id and plan_steps and not streaming_final_answer:
            sorted_steps = sorted(plan_steps.values(), key=lambda s: s.get("order", 0))
            last_step = sorted_steps[-1]
            is_last = last_step.get("step_id") == current_step_id
            if is_last:
              # Only latch streaming_final_answer when the step is already completed
              # (supervisor is summarizing after sub-agents finished). While the step is
              # in_progress, this text is sub-agent narration ("I'll search...") — not
              # the supervisor's final answer. Latching here would cause FINAL_RESULT to
              # be skipped, leaving the user with only the narration and no real answer.
              if last_step.get("status") == "completed":
                streaming_final_answer = True
            else:
              # Accumulate for step-detail cards (shown on step completion)
              if parsed.should_append is False:
                step_thinking[current_step_id] = [parsed.text_content]
              else:
                step_thinking.setdefault(current_step_id, [])
                step_thinking[current_step_id].append(parsed.text_content)
              if not stream_ts:
                step = plan_steps.get(current_step_id, {})
                title = step.get("title", "working")
                _set_typing_status(f"is {title}...")
            # Fall through to stream — narrative text like "I'll search
            # the knowledge base..." should be visible. Post-tool echo
            # suppression is handled by any_subagent_completed below.

          # Stream markdown (no plan, or final answer)
          # Safety filter: suppress any ToolStrategy metadata that may have leaked.
          text = parsed.text_content
          if "is_task_complete=" in text or text.startswith("Returning structured response"):
            logger.debug(f"[{thread_ts}] Suppressing metadata STREAMING_RESULT chunk")
            continue
          # After a sub-agent completes, allow post-subagent STREAMING_RESULT through
          # when the stream is already open. In [FINAL ANSWER] mode, pre-marker thinking
          # is suppressed at the agent level so only the clean final answer reaches here.
          # If the stream is not yet open (typing indicator), accumulate for step cards
          # UNLESS this is the final answer — then fall through to open the stream.
          if any_subagent_completed:
            if not stream_ts and not streaming_final_answer:
              if current_step_id and plan_steps:
                step_thinking.setdefault(current_step_id, [])
                step_thinking[current_step_id].append(text)
              else:
                logger.debug(f"[{thread_ts}] Suppressing pre-stream post-subagent chunk ({len(text)} chars)")
              continue
            # Latch streaming_final_answer only when ALL plan steps are done.
            # In multi-step plans, sub-agent N's narration arrives after sub-agent
            # N-1 completes (any_subagent_completed=True) but while sub-agent N is
            # still in_progress.  Latching here would cause FINAL_RESULT to be skipped,
            # leaving the user with only intermediate narration and no real answer.
            all_steps_done = not plan_steps or all(
              s.get("status") == "completed" for s in plan_steps.values()
            )
            if all_steps_done:
              streaming_final_answer = True
          # Before the stream starts (typing indicator still visible), show narration
          # text as a typing status update rather than immediately opening the stream.
          # The stream will start when the first tool fires (TOOL_NOTIFICATION_START).
          # This keeps CAIPE in "thinking/typing" state while it searches/fetches.
          # Exception: is_final_answer chunks ARE the answer — open the stream for them.
          if not stream_ts and not streaming_final_answer:
            status = text.strip().rstrip('\n')
            if status:
              _set_typing_status(status[:80])
            continue
          _start_stream_if_needed()
          if stream_buf:
            if needs_separator and stream_buf.has_flushed:
              text = "\n\n" + text
              needs_separator = False
            stream_buf.append(text)

        # Update progress for non-streaming fallback (bot users)
        if throttler and throttler.should_update():
          blocks = _build_progress_blocks(current_tool, plan_steps)
          throttler.update(blocks, "Working on your request...")

      elif parsed.event_type == EventType.FINAL_RESULT:
        # This is the authoritative final content
        if parsed.text_content:
          final_result_text = parsed.text_content
          logger.info(f"[{thread_ts}] Got FINAL_RESULT: {len(parsed.text_content)} chars, streaming_final_answer={streaming_final_answer}")
          if streaming_final_answer:
            # Answer was already streamed token-by-token via STREAMING_RESULT chunks.
            # Skip re-streaming to avoid duplicate output in Slack.
            logger.info(f"[{thread_ts}] Skipping FINAL_RESULT re-stream — already streamed via STREAMING_RESULT")
          elif plan_steps:
            # Plan flow: text chunks appended after block chunks aren't rendered by Slack.
            # Leave final_result_text set so finalization puts it in stopStream.chunks.
            logger.info(f"[{thread_ts}] Plan flow — deferring FINAL_RESULT to stopStream.chunks")
          else:
            # No-plan flow: stream the final answer live via appendStream.
            _start_stream_if_needed()
            if stream_buf:
              if needs_separator and stream_buf.has_flushed:
                stream_buf.append("\n\n")
                needs_separator = False
              stream_buf.append(parsed.text_content)
              stream_buf.flush()  # Flush immediately — don't wait for the interval
              streaming_final_answer = True  # Mark as already streamed
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
          logger.debug(f"[{thread_ts}] Got partial_result: {len(parsed.text_content)} chars")

      elif parsed.event_type == EventType.TOOL_NOTIFICATION_START:
        if stream_buf:
          stream_buf.flush()
        if parsed.tool_notification:
          tool_name = parsed.tool_notification.tool_name
          tool_id = parsed.tool_notification.tool_id
          current_tool = tool_name or tool_id or None
          logger.info(f"[{thread_ts}] Tool started: {current_tool or '(unknown)'}")
          # Open the stream on first tool call so the user sees progress immediately.
          # Without this, RAG queries (no sub-agents) are silent for 30-60s while
          # search/fetch_document run, because STREAMING_RESULT only arrives at the end.
          _start_stream_if_needed()
          # Do NOT push tool-name blocks into Slack — it clutters the message
          # with ":mag: search..." indicators that the user shouldn't see.
          # _start_stream_if_needed() above is enough to show the bot is active.

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
          completed_tool_names.add(display_name)
          # When plan steps are present, use plan step completion (in EXECUTION_PLAN
          # handler below) as the authoritative "sub-agent done" signal. This avoids
          # false positives from sub-agent-internal tool completions (search, fetch,
          # compile, etc.) that are case-mismatched or missing from the filter list.
          # For no-plan flows (rare), fall back to tool completion as a proxy.
          if not plan_steps:
            _RAG_TOOL_NAMES = {"search", "fetch_document", "list_datasources", "fetch_url"}
            if display_name.lower() not in _RAG_TOOL_NAMES:
              any_subagent_completed = True
          needs_separator = True
          if not stream_ts:
            _set_typing_status("is working...")
          # Update to clear tool indicator
          if throttler:
            blocks = _build_progress_blocks(None, plan_steps)
            throttler.force_update(blocks, "Working on your request...")

      elif parsed.event_type == EventType.EXECUTION_PLAN:
        if stream_buf:
          stream_buf.flush()
        if parsed.plan_data and parsed.plan_data.get("steps"):
          # Update plan state from structured DataPart; detect step completions.
          # A step transitioning to "completed" is the authoritative signal that
          # the sub-agent for that step is done and the supervisor is responding.
          for step in parsed.plan_data["steps"]:
            prev_status = plan_steps.get(step["step_id"], {}).get("status")
            plan_steps[step["step_id"]] = step
            if step.get("status") == "completed" and prev_status != "completed":
              any_subagent_completed = True
              logger.debug(f"[{thread_ts}] Sub-agent done (step {step['step_id'][:16]} completed)")

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
              chunks = slack_formatter.build_task_update_chunks(changed_steps, step_details=details_map)
              try:
                slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=chunks)
                logger.info(f"[{thread_ts}] SLACK appendStream plan chunks: {[c.get('id', '?') + ':' + c.get('status', '?') for c in chunks]}")
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
          # Stop any active stream before returning to prevent orphaned streams
          if stream_ts:
            try:
              slack_client.chat_stopStream(channel=channel_id, ts=stream_ts)
            except Exception as e:
              logger.debug(f"[{thread_ts}] Failed to stop stream before HITL form: {e}")
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
    logger.info(f"[{thread_ts}]   final_result_text: {len(final_result_text) if final_result_text else 0} chars")
    logger.info(f"[{thread_ts}]   partial_result_text: {len(partial_result_text) if partial_result_text else 0} chars")
    logger.info(f"[{thread_ts}]   final_message_text: {len(final_message_text) if final_message_text else 0} chars")
    logger.info(f"[{thread_ts}]   artifacts count: {len(last_artifacts)}")
    if final_result_text:
      logger.debug(f"[{thread_ts}]   FINAL_RESULT preview: {final_result_text[:200]}...")
    if partial_result_text:
      logger.debug(f"[{thread_ts}]   PARTIAL_RESULT preview: {partial_result_text[:200]}...")
    if final_message_text:
      logger.debug(f"[{thread_ts}]   MESSAGE preview: {final_message_text[:200]}...")

    final_text = _get_final_text(final_result_text, partial_result_text, final_message_text, last_artifacts, thread_ts)

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
        logger.info(f"[{thread_ts}] Recovered from error - showing final content despite: {task_error}")
      logger.info(f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}...")
    elif task_error:
      # No useful content AND we had an error - return retry marker for caller to handle
      logger.error(f"[{thread_ts}] No content received and task had error: {task_error}")
      # Clean up: stop active stream with error blocks, or delete progress message
      if stream_ts:
        try:
          error_blocks = slack_formatter.format_error_message(str(task_error))
          error_blocks.extend(
            _build_stream_final_blocks(
              channel_id, thread_ts, response_ts,
              triggered_by_user_id=triggered_by_user_id,
              additional_footer=additional_footer,
              escalation_config=escalation_config,
                          )
          )
          slack_client.chat_stopStream(
            channel=channel_id, ts=stream_ts, blocks=error_blocks
          )
        except Exception as e:
          logger.debug(f"[{thread_ts}] Failed to stop stream {stream_ts}: {e}")
      if response_ts:
        try:
          slack_client.chat_delete(channel=channel_id, ts=response_ts)
        except Exception as e:
          logger.debug(f"[{thread_ts}] Failed to delete message {response_ts}: {e}")
      # Return marker to trigger retry at caller level
      return {"retry_needed": True, "error": task_error}
    else:
      logger.info(f"[{thread_ts}] Selected final text: {len(final_text)} chars, preview: {final_text[:100]}...")

    # Clear typing status before final response
    _set_typing_status("")

    # --- Finalization: single path per delivery mode ---
    # If stream was never started (no content arrived), start it now for the final answer
    _start_stream_if_needed()

    if stream_ts:
      # Everything in ONE stream message
      # Flush any remaining buffered text before finalizing
      if stream_buf:
        stream_buf.flush()

      streamed_any_text = stream_buf.has_flushed if stream_buf else False
      logger.info(f"[{thread_ts}] Finalizing plan stream: {len(final_text)} chars, streamed_any_text={streamed_any_text}, plan_steps={len(plan_steps)}, sent_step_status={sent_step_status}")

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
            slack_client.chat_appendStream(channel=channel_id, ts=stream_ts, chunks=final_chunks)
            logger.info(f"[{thread_ts}] SLACK appendStream final step completions: {len(final_chunks)}")
          except Exception as e:
            logger.warning(f"[{thread_ts}] SLACK appendStream final steps FAILED: {e}")

      # 2. Build stop call with final answer + feedback blocks.
      # Skip final_text if the answer was already streamed live.
      # For plan flows: only streaming_final_answer means the answer was streamed
      #   (pre-plan chatter sets streamed_any_text but isn't the answer).
      # For no-plan flows: streamed_any_text means the answer was streamed.
      stop_chunks = []
      streamed_any_text = stream_buf.has_flushed if stream_buf else False
      # streaming_final_answer=True  → answer already streamed token-by-token (STREAMING_RESULT)
      #                                 or via appendStream (no-plan FINAL_RESULT path)
      # For plan flows, FINAL_RESULT text is deferred to stopStream.chunks (block+text mixing issue)
      # so streaming_final_answer stays False and needs_final=True sends it in stop_chunks.
      already_streamed = streaming_final_answer or (not plan_steps and streamed_any_text and not final_result_text)
      needs_final = not already_streamed
      if needs_final and final_text:
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
          # Stream expired (long-running query). Fall back to regular message.
          logger.warning(
            f"[{thread_ts}] Streaming message expired — posting final answer as regular message"
          )
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
        logger.warning(f"[{thread_ts}] Thread deleted — dropping response to avoid posting in main channel")
        return None
      # startStream failed earlier — post as regular message
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
        logger.warning(f"[{thread_ts}] Thread deleted — dropping response to avoid posting in main channel")
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
    # Append feedback blocks so users can still rate even on errors
    try:
      error_blocks.extend(
        _build_stream_final_blocks(
          channel_id, thread_ts, response_ts,
          triggered_by_user_id=triggered_by_user_id,
          additional_footer=additional_footer,
          escalation_config=escalation_config,
                  )
      )
    except Exception:
      logger.warning(f"[{thread_ts}] Failed to build feedback blocks for error response")
    if stream_ts:
      # Stop the plan stream with error in blocks
      try:
        slack_client.chat_stopStream(channel=channel_id, ts=stream_ts, blocks=error_blocks)
      except Exception as slack_err:
        logger.warning(f"[{thread_ts}] Failed to stop stream with error: {slack_err}")
    elif throttler:
      try:
        throttler.force_update(error_blocks, "Error")
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

  # Append feedback + footer blocks (actions, context_actions, footer)
  final_blocks.extend(
    _build_stream_final_blocks(
      channel_id, thread_ts, original_ts,
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

  # Add thumbs up/down feedback buttons (and optional trash icon)
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


def handle_ai_alert_processing(
  a2a_client,
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

  result = stream_a2a_response(
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
      "jira_config": channel_config.model_dump(),
    },
    session_manager=session_manager,
    escalation_config=escalation_config,
  )

  logger.info(f"[{thread_ts}] AI processed alert from {bot_username}")
  return result
