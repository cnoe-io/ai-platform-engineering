# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterable
from typing import Any, Optional

# A2A tracing is disabled via cnoe-agent-utils disable_a2a_tracing() in main.py
from a2a.types import (
    Message as A2AMessage,
    Task as A2ATask,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
)
from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    AIPlatformEngineerMAS,
)
from ai_platform_engineering.skills_middleware.mas_registry import set_mas_instance
from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from ai_platform_engineering.utils.a2a_common.langmem_utils import (
    summarize_messages,
    preflight_context_check,
    _extract_tool_call_ids,
)
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langgraph.types import Command

# Import LangGraph error types for proper handling
try:
    from langgraph.errors import GraphInterrupt, GraphRecursionError
except ImportError:
    # Fallback for older versions
    GraphInterrupt = None
    GraphRecursionError = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def _tool_narration(tool_name: str, tool_args: dict) -> str | None:
    """Generate a brief narration sentence to stream before a tool call.

    Returns None for internal/structural tools that should not narrate.
    Yields word-by-word in the caller to simulate LLM token streaming.
    """
    name_lower = tool_name.lower()

    if name_lower in ("write_todos", "responseformat", "platformengineerresponse",
                      "read_file", "write_file", "ls", "glob", "grep", "edit_file",
                      "reflect_on_output", "format_markdown", "get_current_date"):
        return None

    if "search" in name_lower:
        query = tool_args.get("query", "") or tool_args.get("q", "")
        if query and len(query) < 150:
            return f"I'll search the knowledge base for information about **{query[:120]}**.\n\n"
        thought = tool_args.get("thought", "")
        if thought and len(thought) < 150:
            return f"I'll search the knowledge base — *{thought[:100]}*\n\n"
        return "I'll search the knowledge base for relevant information.\n\n"

    if "fetch_document" in name_lower or "fetch_doc" in name_lower:
        thought = tool_args.get("thought", "")
        if thought and len(thought) < 150:
            return f"Let me fetch the full document — *{thought[:100]}*\n\n"
        return "Let me fetch the full document for more details.\n\n"

    if "rag" in name_lower or "knowledge" in name_lower:
        return "I'll query the knowledge base for relevant information.\n\n"

    purpose = tool_args.get("query", "") or tool_args.get("task", "") or tool_args.get("message", "")
    if purpose and len(purpose) < 120:
        label = tool_name.replace("_", " ").replace("-", " ").title()
        return f"I'll use {label} to help with: *{purpose[:100]}*\n\n"

    label = tool_name.replace("_", " ").replace("-", " ").title()
    return f"I'll use the {label} tool to gather the information you need.\n\n"


class AIPlatformEngineerA2ABinding:
  """
  AI Platform Engineer Multi-Agent System (MAS) for platform engineering tasks.
  """

  SYSTEM_INSTRUCTION = system_prompt

  def __init__(self):
      # Store the MAS instance (not yet initialized - call ensure_initialized() first)
      self._mas_instance = AIPlatformEngineerMAS()
      set_mas_instance(self._mas_instance)
      self.graph = None  # Set after ensure_initialized()
      self.tracing = TracingManager()
      self._execution_plan_sent = False
      self._previous_todos: dict[int, dict] = {}  # Track todo states for notifications
      self._task_plan_entries: dict[str, dict] = {}  # Track task (subagent) calls for execution plan
      self._in_self_service_workflow = False  # Suppress intermediate text during deterministic workflows
      self._initialized = False

  async def ensure_initialized(self) -> None:
      """Ensure the agent is initialized with MCP tools loaded."""
      if self._initialized:
          return

      await self._mas_instance.ensure_initialized()
      self.graph = self._mas_instance.get_graph()
      self._initialized = True
      logging.info("✅ AIPlatformEngineerA2ABinding initialized with MCP tools")

  async def _repair_orphaned_tool_calls(self, config: dict) -> None:
      """
      CRITICAL: Repair orphaned tool calls in message history.

      Bedrock/Anthropic requires ToolMessages to appear IMMEDIATELY after
      the AIMessage with tool_use. If we can't properly repair the ordering,
      we remove the problematic AIMessages entirely.

      This is essential for recovery when:
      - A sub-agent call fails mid-stream (e.g., context overflow)
      - A tool call is interrupted
      - Network issues cause incomplete responses

      Args:
          config: Runnable configuration with thread_id
      """
      try:
          from langchain_core.messages import RemoveMessage

          state = await self.graph.aget_state(config)
          if not state or not state.values:
              return

          messages = state.values.get("messages", [])
          if not messages:
              return

          # Build a map of tool_call_id -> (index, tool_name, msg_id)
          tool_calls_info = {}  # {tool_call_id: (msg_index, tool_name, ai_msg_id)}
          resolved_tool_calls = set()

          for idx, msg in enumerate(messages):
              # Track tool calls from AIMessages
              if isinstance(msg, AIMessage):
                  msg_id = getattr(msg, 'id', None)

                  # Build a name lookup from the standard tool_calls list
                  tc_name_by_id = {}
                  for tc in (getattr(msg, 'tool_calls', None) or []):
                      tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                      tc_name = tc.get('name') if isinstance(tc, dict) else getattr(tc, 'name', 'unknown')
                      if tc_id:
                          tc_name_by_id[tc_id] = tc_name

                  # _extract_tool_call_ids checks tool_calls, additional_kwargs,
                  # and content blocks (all three Bedrock storage locations).
                  for tc_id in _extract_tool_call_ids(msg):
                      if tc_id not in tool_calls_info:
                          tool_calls_info[tc_id] = (idx, tc_name_by_id.get(tc_id, 'unknown'), msg_id)

              # Track resolved tool calls
              if isinstance(msg, ToolMessage):
                  tc_id = getattr(msg, 'tool_call_id', None)
                  if tc_id:
                      resolved_tool_calls.add(tc_id)

          # Find orphaned tool calls (have tool_use but no tool_result)
          orphaned = {tc_id: info for tc_id, info in tool_calls_info.items()
                      if tc_id not in resolved_tool_calls}

          if not orphaned:
              return

          # CRITICAL: Check for pending deterministic task execution
          # If pending_task_tool_call_id is in state, skip cleaning up that specific tool call
          # This allows DeterministicTaskMiddleware to inject task calls that will be
          # executed by the tools node without being cleaned up
          pending_task_id = state.values.get("pending_task_tool_call_id")
          if pending_task_id and pending_task_id in orphaned:
              logging.info(
                  f"⏳ Supervisor: Skipping repair of pending deterministic task tool call: {pending_task_id}"
              )
              del orphaned[pending_task_id]
              if not orphaned:
                  return

          orphaned_names = [info[1] for info in orphaned.values()]
          logging.warning(
              f"⚠️ Supervisor: Found {len(orphaned)} orphaned tool calls. "
              f"IDs: {list(orphaned.keys())}, Names: {orphaned_names}"
          )

          # STRATEGY: Remove ONLY the AIMessages that have orphaned tool calls.
          # This preserves earlier conversation history while eliminating the problematic
          # messages that would cause Bedrock validation errors.
          #
          # We cannot simply append ToolMessages at the end because Bedrock requires
          # tool_result immediately after tool_use. And we cannot remove ALL messages
          # because that triggers IndexError when LangGraph's should_continue runs.

          # Get the IDs of AIMessages that have orphaned tool calls
          ai_msg_ids_to_remove = set()
          for tool_call_id, (msg_idx, tool_name, ai_msg_id) in orphaned.items():
              if ai_msg_id:
                  ai_msg_ids_to_remove.add(ai_msg_id)
                  logging.info(
                      f"🔧 Will remove AIMessage with orphaned tool_call: "
                      f"msg_id={ai_msg_id[:20] if ai_msg_id else 'None'}..., "
                      f"tool={tool_name}, tool_call_id={tool_call_id[:20]}..."
                  )

          if ai_msg_ids_to_remove:
              # Remove only the problematic AIMessages
              remove_messages = [RemoveMessage(id=msg_id) for msg_id in ai_msg_ids_to_remove]
              await self.graph.aupdate_state(config, {"messages": remove_messages})
              logging.info(
                  f"✅ Supervisor: Removed {len(ai_msg_ids_to_remove)} AIMessage(s) with orphaned tool calls. "
                  f"Earlier conversation history preserved."
              )
          else:
              # No message IDs found - fall back to just logging
              logging.warning(
                  f"⚠️ Supervisor: Found orphaned tool calls but no message IDs to remove. "
                  f"Orphaned tools: {orphaned_names}"
              )

      except Exception as e:
          logging.error(f"Supervisor: Error repairing orphaned tool calls: {e}", exc_info=True)
          # If repair fails, try a fallback: clear the thread state entirely
          # This loses history but allows future queries to work
          try:
              logging.warning("⚠️ Attempting fallback: clearing corrupted thread state")
              # Get the thread_id from config
              thread_id = config.get("configurable", {}).get("thread_id")
              if thread_id and hasattr(self.graph, 'checkpointer') and self.graph.checkpointer:
                  # Try to clear the checkpoint for this thread
                  logging.info(f"Clearing checkpoint for thread_id: {thread_id}")
                  # We can't easily delete checkpoints, so we'll just add a fresh HumanMessage
                  # to reset the conversation flow
                  from langchain_core.messages import HumanMessage
                  reset_msg = HumanMessage(content="[System: Previous conversation was interrupted. Starting fresh.]")
                  await self.graph.aupdate_state(config, {"messages": [reset_msg]})
                  logging.info("✅ Added reset message to recover from corrupted state")
          except Exception as fallback_err:
              logging.error(f"Fallback recovery also failed: {fallback_err}")
              # At this point, the conversation is corrupted - user will need to start a new thread

  def _deserialize_a2a_event(self, data: Any):
      """Try to deserialize a dict payload into known A2A models."""
      if not isinstance(data, dict):
          return None
      for model in (TaskStatusUpdateEvent, TaskArtifactUpdateEvent, A2ATask, A2AMessage):
          try:
              return model.model_validate(data)  # type: ignore[attr-defined]
          except Exception:
              continue
      return None

  def _build_task_plan_text(self) -> str:
      """Build execution plan text from tracked task (subagent) calls.

      Returns text in the emoji+bracket format the UI expects, e.g.:
          ⏳ [Jira] Search for user's tickets
          ✅ [GitHub] List pull requests
      """
      status_icons = {
          "pending": "⏳",
          "in_progress": "🔄",
          "completed": "✅",
          "failed": "❌",
      }
      lines = []
      for entry in self._task_plan_entries.values():
          icon = status_icons.get(entry["status"], "⏳")
          agent = entry["subagent"].title()
          lines.append(f"{icon} [{agent}] {entry['description']}")
      return "\n".join(lines)

  def _build_todo_plan_text(self) -> str:
      """Build execution plan text from tracked todos (_previous_todos).

      Todo content already contains [AgentName] prefix from the middleware/prompt.
      We just need to prepend the status emoji.
      """
      status_icons = {
          "pending": "⏳",
          "in_progress": "🔄",
          "completed": "✅",
          "failed": "❌",
      }
      lines = []
      for todo_id in sorted(
          self._previous_todos.keys(),
          key=lambda x: (int(x) if str(x).isdigit() else float('inf')),
      ):
          entry = self._previous_todos[todo_id]
          icon = status_icons.get(entry["status"], "⏳")
          content = entry["content"]
          lines.append(f"{icon} {content}")
      return "\n".join(lines)

  def _extract_interrupt_value(self, exc: Exception):
      """Extract the interrupt value from a GraphInterrupt exception."""
      if hasattr(exc, 'value'):
          return exc.value
      if hasattr(exc, 'args') and exc.args:
          first_arg = exc.args[0]
          if hasattr(first_arg, 'value'):
              return first_arg.value
          if isinstance(first_arg, tuple) and len(first_arg) > 0:
              first_intr = first_arg[0]
              if hasattr(first_intr, 'value'):
                  return first_intr.value
              if isinstance(first_intr, dict):
                  return first_intr
          if isinstance(first_arg, dict):
              return first_arg
      return None

  def _build_hitl_form_event(self, interrupt_value, *, label: str = "") -> dict | None:
      """Build a HITL form yield dict from an extracted interrupt value, or None."""
      action_requests = []
      if isinstance(interrupt_value, dict):
          action_requests = interrupt_value.get("action_requests", [])
      elif isinstance(interrupt_value, list):
          action_requests = interrupt_value

      tool_calls = []
      for action_req in action_requests:
          try:
              name = action_req.get("name", "CAIPEAgentResponse")
              args = action_req.get("arguments", {}) or action_req.get("args", {})
              tool_calls.append({"name": name, "args": args, "id": action_req.get("id")})
              logging.info(f"[{label} Interrupt] Parsed: name={name}")
          except Exception as parse_err:
              logging.warning(f"[{label} Interrupt] Failed to parse action_request: {parse_err}")

      if not tool_calls:
          logging.warning(f"[{label} Interrupt] No tool_calls extracted, cannot show form")
          return None

      form_response = ""
      for tc in tool_calls:
          if tc.get("name") == "CAIPEAgentResponse":
              form_response = (tc.get("args") or {}).get("response", "")
              break
      synth_msg = AIMessage(
          content=form_response or "Please provide the required information.",
          tool_calls=tool_calls,
      )
      logging.info(f"[{label} Interrupt] Yielding form with {len(tool_calls)} tool_calls")
      return {
          "event_type": "interrupt",
          "message": synth_msg,
          "is_task_complete": False,
          "require_user_input": True,
          "content": form_response,
          "agent_type": "user_input",
          "node_name": "user_input",
      }

  def _handle_interrupt_event(self, item: dict, *, label: str = "") -> dict | None:
      """Handle an __interrupt__ dict from astream updates. Returns form event or None."""
      intr_obj = item.get("__interrupt__")
      intr = intr_obj[0] if isinstance(intr_obj, (list, tuple)) and intr_obj else intr_obj
      intr_value = getattr(intr, "value", None)
      if intr_value is None and isinstance(intr, dict):
          intr_value = intr
      if intr_value is None:
          logging.warning(f"[{label} Interrupt] Could not extract interrupt value")
          return None
      logging.info(f"[{label}] __interrupt__ event received")
      return self._build_hitl_form_event(intr_value, label=label)

  async def _direct_structured_response(self, config: dict, context: str = "") -> dict | None:
      """Produce a final structured response by calling the LLM directly.

      Bypasses the LangGraph graph entirely so no RAG tools or middleware can
      interfere.  Uses with_structured_output(PlatformEngineerResponse) to
      force the model to produce a clean final answer from the accumulated
      conversation history.

      Returns a response_format_result dict or None on failure.
      """
      from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
      from langchain_core.messages import HumanMessage as _HumanMessage

      try:
          state = await self.graph.aget_state(config)
          raw_messages = (state.values or {}).get("messages", []) if state else []
          # Trim to last 30 messages to stay well within context limits
          messages = list(raw_messages)[-30:]
          if not messages:
              return None

          wrap_prompt = (
              "You have finished gathering information. "
              "Based ONLY on what was retrieved above, write your final answer now. "
              "Do not call any more tools."
          )
          if context:
              wrap_prompt = f"[Recovery after error: {context[:200]}]\n\n" + wrap_prompt

          messages = messages + [_HumanMessage(content=wrap_prompt)]

          llm = LLMFactory().get_llm()
          structured_llm = llm.with_structured_output(PlatformEngineerResponse)
          result = await structured_llm.ainvoke(messages)
          if result is None:
              return None

          content = getattr(result, 'content', None) or str(result)
          # Prepend a blank line so the answer is visually separated from
          # the last narration line that precedes it in the stream.
          if content and not content.startswith("\n"):
              content = "\n\n" + content
          resp = {
              'content': content,
              'is_task_complete': getattr(result, 'is_task_complete', True),
              'require_user_input': getattr(result, 'require_user_input', False),
              'from_response_format_tool': True,
          }
          md = getattr(result, 'metadata', None)
          if md:
              resp['metadata'] = {
                  'user_input': getattr(md, 'user_input', None),
                  'input_title': getattr(md, 'input_title', None),
                  'input_description': getattr(md, 'input_description', None),
                  'input_fields': [
                      {
                          'field_name': f.field_name,
                          'field_description': f.field_description,
                          'field_values': getattr(f, 'field_values', None),
                          'required': getattr(f, 'required', True),
                      }
                      for f in (md.input_fields or [])
                  ] if getattr(md, 'input_fields', None) else None,
              }
          return resp
      except Exception as e:
          logging.error(f"_direct_structured_response failed: {e}")
          return None

  # NOTE: Not using @trace_agent_stream decorator because it doesn't support the 'command' parameter
  # needed for HITL resume functionality. Manual tracing is handled via TracingManager.
  async def stream(
      self,
      query: Optional[str],
      context_id: str,
      trace_id: Optional[str] = None,
      command: Optional[Command] = None,
      user_email: Optional[str] = None,
  ) -> AsyncIterable[dict[str, Any]]:
      logging.debug(f"Starting stream with query: {query}, context_id: {context_id}, trace_id: {trace_id}, has_command: {command is not None}, user_email: {user_email}")

      # Ensure agent is initialized with MCP tools (lazy loading on first stream)
      await self.ensure_initialized()

      # Track tool calls to ensure every AIMessage.tool_call gets a ToolMessage
      pending_tool_calls = {}  # {tool_call_id: tool_name}

      # Dedup narration: Bedrock streams many AIMessageChunks per tool call,
      # each with tool_calls populated — gate by call ID so we emit once per call.
      # Also dedup by text: identical RAG searches would emit the same line twice.
      _narrated_tool_call_ids: set[str] = set()
      _narrated_texts: set[str] = set()

      # Build input based on whether we have a query or a command (resume from interrupt)
      if command is not None:
          inputs = command
      else:

          state_dict = {'messages': [('user', query or '')]}
          # Store user_email in graph state for middleware to use in task prompts
          if user_email:
              state_dict['user_email'] = user_email
          inputs = state_dict

      config = self.tracing.create_config(context_id)

      # Set recursion limit - LangGraph default is 25 which is too low for
      # deterministic task workflows (e.g. S3 creation has 8 steps, each with
      # model + tools cycles). Match the multi-node agent's limit of 100.
      config['recursion_limit'] = int(os.getenv("LANGGRAPH_RECURSION_LIMIT", "500"))

      # Ensure metadata exists in config for tools to access
      if 'metadata' not in config:
          config['metadata'] = {}

      # Add context_id to metadata so tools can maintain conversation continuity
      if context_id:
          config['metadata']['context_id'] = context_id
          logging.info(f"Added context_id to config metadata: {context_id}")

      # Add user_email to metadata for tools and subagents
      if user_email:
          config['metadata']['user_email'] = user_email
          logging.info(f"Added user_email to config metadata: {user_email}")

      # Add trace_id to metadata for distributed tracing
      if trace_id:
          config['metadata']['trace_id'] = trace_id
          logging.info(f"Added trace_id to config metadata: {trace_id}")
      else:
          # Try to get trace_id from TracingManager context if not provided
          current_trace_id = self.tracing.get_trace_id()
          if current_trace_id:
              config['metadata']['trace_id'] = current_trace_id
              logging.debug(f"Added trace_id from context to config metadata: {current_trace_id}")
          else:
              logging.debug("No trace_id available from parameter or context")

      logging.debug(f"Created tracing config: {config}")

      # ========================================================================
      # EXECUTION PLAN STATE: re-seed on HITL resume, reset on fresh query
      # ========================================================================
      if command is not None:
          self._task_plan_entries = {}
          self._in_self_service_workflow = False
          try:
              state = await self.graph.aget_state(config)
              existing_todos = (state.values or {}).get("todos", []) if state else []
              if existing_todos:
                  self._execution_plan_sent = True
                  self._previous_todos = {}
                  for todo in existing_todos:
                      if isinstance(todo, dict):
                          self._previous_todos[todo.get("id")] = {
                              "status": todo.get("status", "pending"),
                              "content": todo.get("content", f"Step {todo.get('id')}"),
                          }
                  logging.info(f"📋 HITL resume: re-seeded {len(self._previous_todos)} todos from graph state")
              else:
                  self._execution_plan_sent = False
                  self._previous_todos = {}
                  logging.debug("HITL resume: no existing todos in graph state")
          except Exception as e:
              logging.warning(f"Could not re-seed todos on resume: {e}")
              self._execution_plan_sent = False
              self._previous_todos = {}
      else:
          self._execution_plan_sent = False
          self._previous_todos = {}
          self._task_plan_entries = {}
          self._in_self_service_workflow = False

      # Reset RAG caps and hard-stop state so each new query starts fresh.
      # Cap counters use a TTL-based cleanup that spans 5 minutes; without an
      # explicit reset, a previous query on the same thread would exhaust the
      # caps before the new query even calls a RAG tool.
      thread_id_for_rag = (config or {}).get("configurable", {}).get("thread_id")
      if thread_id_for_rag:
          try:
              from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import clear_rag_state  # noqa: PLC0415
              clear_rag_state(thread_id_for_rag)
              logging.debug(f"RAG state cleared for thread_id={thread_id_for_rag}")
          except Exception as rag_clear_err:
              logging.debug(f"Could not clear RAG state: {rag_clear_err}")

      # ========================================================================
      # PRE-FLIGHT CONTEXT CHECK: Proactively compress if approaching limit
      # ========================================================================
      try:
          max_context_tokens = int(os.getenv("MAX_CONTEXT_TOKENS", "100000"))
          min_messages_to_keep = int(os.getenv("MIN_MESSAGES_TO_KEEP", "4"))

          context_result = await preflight_context_check(
              graph=self.graph,
              config=config,
              query=query,
              system_prompt=self.SYSTEM_INSTRUCTION,
              model=LLMFactory().get_llm(),
              agent_name="supervisor",
              max_context_tokens=max_context_tokens,
              min_messages_to_keep=min_messages_to_keep,
              tool_count=50,  # Supervisor has many tools
          )

          if context_result.compressed:
              logging.info(
                  f"🧠 Supervisor pre-flight: Context compressed, "
                  f"saved {context_result.tokens_saved:,} tokens, "
                  f"LangMem used: {context_result.used_langmem}"
              )
          elif context_result.needs_compression and context_result.error:
              logging.warning(
                  f"⚠️ Supervisor pre-flight: Compression needed but failed: {context_result.error}"
              )
      except Exception as preflight_error:
          logging.error(f"❌ Supervisor pre-flight check failed: {preflight_error}")
          # Don't fail the request - continue without compression

      # ========================================================================
      # CRITICAL: Repair orphaned tool calls BEFORE LLM invocation
      # This prevents "Found AIMessages with tool_calls that do not have a
      # corresponding ToolMessage" errors when sub-agents fail mid-stream
      # ========================================================================
      try:
          await self._repair_orphaned_tool_calls(config)
      except Exception as repair_error:
          logging.error(f"⚠️ Supervisor: Failed to repair orphaned tool calls: {repair_error}")
          # Don't fail - this is a recovery mechanism

      try:
          # Track accumulated AI message content for final parsing
          accumulated_ai_content = []
          yielded_chunk_count = 0
          final_ai_message = None

          # Track sub-agent responses for fallback if synthesis fails
          # Format: {tool_name: response_content}
          accumulated_subagent_responses = {}

          # [FINAL ANSWER] marker split: buffer pre-marker text, stream post-marker tokens
          _final_answer_seen = False
          _pre_marker_buffer = ""

          # Response tracking (always None in [FINAL ANSWER] mode; kept for error-recovery path)
          response_format_result = None

          # Check if token-by-token streaming is enabled (default: true)
          # When disabled, uses 'values' mode which waits for complete messages
          enable_streaming = os.getenv("ENABLE_STREAMING", "true").lower() == "true"

          if enable_streaming:
              # Use astream with multiple stream modes to get both token-level streaming AND custom events
              # stream_mode=['messages', 'custom', 'updates'] enables:
              # - 'messages': Token-level streaming via AIMessageChunk
              # - 'custom': Custom events from sub-agents via get_stream_writer()
              # - 'updates': Updates including __interrupt__ events for HITL forms
              stream_mode = ['messages', 'custom', 'updates']
              logging.info("Supervisor: Token-by-token streaming ENABLED")
          else:
              # Use values mode for complete messages (better spacing, less responsive)
              stream_mode = ['values', 'custom', 'updates']
              logging.info("Supervisor: Token-by-token streaming DISABLED, using full message mode")

          # Track if we've hit an interrupt (HITL form)
          is_interrupt = False

          async for stream_item in self.graph.astream(inputs, config, stream_mode=stream_mode, subgraphs=True):
              # Handle variable tuple format from subgraphs=True
              # With subgraphs=True, format is (path, stream_mode, event)
              # Without subgraphs, format is (stream_mode, event)
              if isinstance(stream_item, tuple):
                  if len(stream_item) == 3:
                      _, event_type, event = stream_item
                  elif len(stream_item) == 2:
                      event_type, event = stream_item
                  else:
                      # Unexpected format, try to handle gracefully
                      event_type = stream_item[0] if len(stream_item) > 0 else None
                      event = stream_item[1] if len(stream_item) > 1 else stream_item
              else:
                  event_type = None
                  event = stream_item

              # Skip processing after an interrupt - client needs to respond first
              if is_interrupt:
                  continue

              # Handle __interrupt__ events (Human-in-the-Loop forms)
              if isinstance(event, dict) and "__interrupt__" in event:
                  logging.info(f"Interrupt received: {event}")
                  intr_obj = event.get("__interrupt__")
                  intr = intr_obj[0] if isinstance(intr_obj, (list, tuple)) and intr_obj else intr_obj

                  # Extract the interrupt value (HITL request data)
                  intr_value = getattr(intr, "value", None)
                  if intr_value is None and isinstance(intr, dict):
                      intr_value = intr

                  logging.info(f"[Interrupt] Extracted value: {type(intr_value)}")

                  # The HITL middleware generates data in format:
                  # {'action_requests': [{'name': 'CAIPEAgentResponse', 'arguments': {'metadata': {'input_fields': [...]}}, 'description': '...'}],
                  #  'review_configs': [{'action_name': 'CAIPEAgentResponse', 'allowed_decisions': [...]}]}
                  # Note: Standard HITL uses 'arguments', but some implementations use 'args'
                  action_requests = []
                  if isinstance(intr_value, dict):
                      action_requests = intr_value.get("action_requests", [])
                      logging.info(f"[Interrupt] Found {len(action_requests)} action_requests in dict, keys: {list(intr_value.keys())}")
                  elif isinstance(intr_value, list):
                      action_requests = intr_value
                      logging.info(f"[Interrupt] intr_value is list with {len(action_requests)} items")
                  else:
                      logging.warning(f"[Interrupt] Unexpected intr_value type: {type(intr_value)}, value: {intr_value}")

                  tool_calls = []
                  for action_req in action_requests:
                      try:
                          logging.info(f"[Interrupt] Processing action_req: {json.dumps(action_req, default=str)[:500]}")
                          name = action_req.get("name", "CAIPEAgentResponse")
                          # HITL middleware uses 'arguments', but also check 'args' for compatibility
                          args = action_req.get("arguments", {}) or action_req.get("args", {})

                          # The args should already contain metadata.input_fields from HITL middleware
                          # Just pass them through directly
                          tool_calls.append({
                              "name": name,
                              "args": args,
                              "id": getattr(intr, "id", None),
                          })
                          logging.info(f"[Interrupt] Parsed action request: name={name}, has_metadata={bool(args.get('metadata') if isinstance(args, dict) else False)}, args_keys={list(args.keys()) if isinstance(args, dict) else 'not dict'}")
                      except Exception as e:
                          logging.warning(f"Failed to parse interrupt action request: {e}", exc_info=True)

                  if not tool_calls:
                      logging.warning("[Interrupt] No tool_calls extracted from interrupt, skipping")
                      continue

                  # Extract response text from CAIPEAgentResponse args
                  form_response = ""
                  for tc in tool_calls:
                      if tc.get("name") == "CAIPEAgentResponse":
                          form_response = (tc.get("args") or {}).get("response", "")
                          break

                  # Create synthetic AIMessage with tool_calls for form display
                  synth_msg = AIMessage(
                      content=form_response or "Please provide the required information.",
                      tool_calls=tool_calls,
                  )
                  logging.info(f"[Interrupt] Yielding form with {len(tool_calls)} tool_calls, response={bool(form_response)}")
                  is_interrupt = True
                  yield {
                      "event_type": "interrupt",
                      "message": synth_msg,
                      "is_task_complete": False,
                      "require_user_input": True,
                      "content": form_response,
                      "agent_type": "user_input",
                      "node_name": "user_input",
                  }
                  continue

              # Handle custom A2A event payloads from sub-agents
              if event_type == 'custom' and isinstance(event, dict):
                  # Handle different custom event types
                  if event.get("type") == "a2a_event":
                      # Legacy a2a_event format (text-based)
                      custom_text = event.get("data", "")
                      if custom_text:
                          logging.debug(f"Processing custom a2a_event from sub-agent: {len(custom_text)} chars")
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": custom_text,
                          }
                      continue
                  elif event.get("type") == "human_prompt":
                      prompt_text = event.get("prompt", "")
                      options = event.get("options", [])
                      logging.debug("Received human-in-the-loop prompt from sub-agent")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": True,
                          "content": prompt_text,
                          "metadata": {"options": options} if options else {},
                      }
                      continue
                  elif event.get("type") == "artifact-update":
                      # New artifact-update format from sub-agents (full A2A event)
                      # Yield the entire event dict for the executor to handle
                      logging.debug("Received artifact-update custom event from sub-agent, forwarding to executor")
                      yield event
                      continue

              # ── Track state changes from updates stream ──
              # The updates stream contains full state after each node completes.
              # Two key uses:
              # 1. Todo transitions from middleware-injected write_todos
              # 2. Task (subagent) tool_calls with COMPLETE args (chunks have partial args)
              if event_type == 'updates' and isinstance(event, dict):
                  todos_lists = []
                  messages_lists = []
                  for key, value in event.items():
                      if key == 'todos' and isinstance(value, list):
                          todos_lists.append(value)
                      elif key == 'messages' and isinstance(value, list):
                          messages_lists.append(value)
                      elif isinstance(value, dict):
                          node_todos = value.get('todos')
                          if node_todos and isinstance(node_todos, list):
                              todos_lists.append(node_todos)
                          node_msgs = value.get('messages')
                          if node_msgs and isinstance(node_msgs, list):
                              messages_lists.append(node_msgs)

                  # ── Detect task (subagent) tool_calls from full AIMessages ──
                  # Entries are ONLY created here or in the AIMessage handler (messages stream),
                  # never from chunks, so they always have complete subagent_type/description.
                  plan_dirty = False
                  for msgs in messages_lists:
                      for msg in msgs:
                          if not (isinstance(msg, AIMessage) and hasattr(msg, 'tool_calls') and msg.tool_calls):
                              continue
                          for tc in msg.tool_calls:
                              if tc.get("name") != "task":
                                  continue
                              tc_id = tc.get("id", "")
                              if not tc_id:
                                  continue
                              tc_args = tc.get("args") or {}
                              subagent_type = tc_args.get("subagent_type", "general-purpose") if isinstance(tc_args, dict) else "general-purpose"
                              task_desc = tc_args.get("description", "Processing task") if isinstance(tc_args, dict) else "Processing task"
                              display_desc = task_desc[:120].strip()
                              if len(task_desc) > 120:
                                  display_desc += "..."

                              if tc_id not in self._task_plan_entries:
                                  self._task_plan_entries[tc_id] = {
                                      "subagent": subagent_type,
                                      "description": display_desc,
                                      "status": "in_progress",
                                  }
                                  plan_dirty = True
                                  logging.info(f"📋 Detected task from updates: [{subagent_type}] {display_desc}")

                  # Re-emit plan when new tasks detected or existing entries refined
                  if plan_dirty:
                      if self._previous_todos:
                          plan_text = self._build_todo_plan_text()
                      else:
                          plan_text = self._build_task_plan_text()
                      artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                      self._execution_plan_sent = True
                      logging.info(f"📋 Emitting {artifact_name} from updates (entries={len(self._task_plan_entries)})")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "artifact": {
                              "name": artifact_name,
                              "description": "Execution plan from subagent delegation",
                              "text": plan_text,
                          }
                      }

                  # ── Detect task completion from ToolMessages in updates stream ──
                  # The `task` tool returns a Command, so its ToolMessage is applied
                  # via state update and does NOT stream through the messages path.
                  # We must detect completion here instead.
                  completion_dirty = False
                  for msgs in messages_lists:
                      for msg in msgs:
                          if not isinstance(msg, ToolMessage):
                              continue
                          tc_id = msg.tool_call_id if hasattr(msg, 'tool_call_id') else None
                          if tc_id and tc_id in self._task_plan_entries:
                              if self._task_plan_entries[tc_id]["status"] != "completed":
                                  self._task_plan_entries[tc_id]["status"] = "completed"
                                  completion_dirty = True
                                  logging.info(f"✅ Task completed (from updates stream): {tc_id}")

                  if completion_dirty:
                      plan_text = self._build_todo_plan_text() if self._previous_todos else self._build_task_plan_text()
                      logging.info(f"📋 Emitting execution_plan_status_update: {sum(1 for e in self._task_plan_entries.values() if e['status'] == 'completed')}/{len(self._task_plan_entries)} tasks completed")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "artifact": {
                              "name": "execution_plan_status_update",
                              "description": "Task completed",
                              "text": plan_text,
                          }
                      }

                  # ── Track todo transitions and re-emit execution plan ──
                  plan_changed = False
                  for todos in todos_lists:
                      for idx, todo in enumerate(todos):
                          if not isinstance(todo, dict):
                              continue
                          todo_id = todo.get("id") if todo.get("id") is not None else idx
                          new_status = todo.get("status", "pending")
                          old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                          todo_content = todo.get("content", f"Step {todo_id}")

                          # New todo → always counts as a plan change
                          if todo_id not in self._previous_todos:
                              plan_changed = True
                              self._previous_todos[todo_id] = {
                                  "status": new_status,
                                  "content": todo_content,
                              }

                          if old_status != new_status:
                              plan_changed = True
                              if new_status == "in_progress":
                                  logging.info(f"📋 Task started (from updates): {todo_content}")
                                  yield {
                                      "is_task_complete": False,
                                      "require_user_input": False,
                                      "content": f"🔧 Workflow: Calling {todo_content}...\n",
                                      "tool_call": {
                                          "name": todo_content,
                                          "status": "started",
                                          "type": "notification"
                                      }
                                  }
                              elif new_status == "completed":
                                  logging.info(f"✅ Task completed (from updates): {todo_content}")
                                  yield {
                                      "is_task_complete": False,
                                      "require_user_input": False,
                                      "content": f"✅ Workflow: {todo_content} completed\n",
                                      "tool_result": {
                                          "name": todo_content,
                                          "status": "completed",
                                          "type": "notification"
                                      }
                                  }

                              self._previous_todos[todo_id] = {
                                  "status": new_status,
                                  "content": todo_content,
                              }

                  # Re-emit execution plan artifact so the UI sidebar updates
                  if plan_changed and self._previous_todos:
                      plan_text = self._build_todo_plan_text()
                      artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                      self._execution_plan_sent = True
                      logging.info(f"📋 Emitting {artifact_name} from todo transition ({len(self._previous_todos)} todos)")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "artifact": {
                              "name": artifact_name,
                              "description": "Execution plan progress update",
                              "text": plan_text,
                          }
                      }
                  continue

              # Process message stream
              if event_type != 'messages':
                  continue

              message = event[0] if event else None
              if not message:
                  continue

              # Check if this message has tool_calls (can be in AIMessageChunk or AIMessage)
              has_tool_calls = hasattr(message, "tool_calls") and message.tool_calls
              if has_tool_calls:
                  logging.debug(f"Message with tool_calls detected: type={type(message).__name__}, tool_calls={message.tool_calls}")

              # Stream LLM tokens (includes execution plans and responses)
              if isinstance(message, AIMessageChunk):
                  # Check if this chunk has tool_calls (tool invocation)
                  if hasattr(message, "tool_calls") and message.tool_calls:
                      # This is a tool call chunk - emit tool start notifications
                      for tool_call in message.tool_calls:
                          tool_name = tool_call.get("name", "")
                          tc_id = tool_call.get("id", "")
                          # Skip tool calls with empty names (they're partial chunks being streamed)
                          if not tool_name or not tool_name.strip():
                              logging.debug("Skipping tool call with empty name (streaming chunk)")
                              continue

                          # Track tool call for ToolMessage resolution
                          if tc_id:
                              pending_tool_calls[tc_id] = tool_name

                          # invoke_self_service_task — enter self-service mode to suppress intermediate text
                          if tool_name == "invoke_self_service_task":
                              self._in_self_service_workflow = True
                              logging.info("🔄 Self-service workflow detected — suppressing intermediate text streaming")
                              continue

                          # write_todos — skip generic notification (handled by ToolMessage path)
                          if tool_name == "write_todos":
                              logging.debug("Skipping chunk notification for 'write_todos' (handled by ToolMessage path)")
                              continue

                          # task — defer entry creation to updates/AIMessage handler
                          # where full args (subagent_type, description) are available.
                          # Chunks often have empty/partial args → phantom "Agent" entries.
                          if tool_name == "task":
                              logging.debug(f"Noted task chunk tool_call_id={tc_id}, deferring plan entry to full AIMessage")
                              continue

                          logging.debug(f"Tool call started (from AIMessageChunk): {tool_name}")

                          # Emit narration word-by-word before the tool notification.
                          # Haiku doesn't generate pre-tool text naturally, so we need
                          # this to give users visible progress between tool calls.
                          # When stream_ts is already set (2nd+ tool), text streams into
                          # Slack. For the 1st tool, it briefly shows in the typing status.
                          _call_id = tc_id or tool_name
                          if _call_id not in _narrated_tool_call_ids:
                              _narrated_tool_call_ids.add(_call_id)
                              narration = _tool_narration(tool_name, tool_call.get("args", {}) or {})
                              if narration and narration not in _narrated_texts:
                                  _narrated_texts.add(narration)
                                  yield {
                                      "is_task_complete": False,
                                      "require_user_input": False,
                                      "content": narration,
                                  }

                          # Stream tool start notification to client with metadata
                          tool_name_formatted = tool_name.title()
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": f"🔧 Supervisor: Calling Agent {tool_name_formatted}...\n",
                              "tool_call": {
                                  "name": tool_name,
                                  "status": "started",
                                  "type": "notification"
                              }
                          }
                      # Don't process content for tool call chunks
                      continue

                  content = message.content
                  # Normalize content (handle both string and list formats)
                  if isinstance(content, list):
                      text_parts = []
                      for item in content:
                          if isinstance(item, dict):
                              text_parts.append(item.get('text', ''))
                          elif isinstance(item, str):
                              text_parts.append(item)
                          else:
                              text_parts.append(str(item))
                      content = ''.join(text_parts)
                  elif not isinstance(content, str):
                      content = str(content) if content else ''

                  # Accumulate ALL content for post-stream parsing (including pre-marker)
                  if content:
                      accumulated_ai_content.append(content)

                  # During self-service workflows, suppress intermediate text
                  # (execution plan updates and tool notifications are still emitted
                  # via the write_todos and task handlers above)
                  if content and self._in_self_service_workflow:
                      logging.debug(f"Suppressed intermediate text ({len(content)} chars) during self-service workflow")
                      continue

                  # [FINAL ANSWER] real-time split:
                  # Buffer tokens until the marker appears, then stream post-marker text only.
                  # This suppresses the model's thinking/reasoning and streams only the answer.
                  if content:
                      _MARKER = "[FINAL ANSWER]"
                      _MARKER_ALT = "[FINAL_ANSWER]"
                      if not _final_answer_seen:
                          _pre_marker_buffer += content
                          marker_used = None
                          if _MARKER in _pre_marker_buffer:
                              marker_used = _MARKER
                          elif _MARKER_ALT in _pre_marker_buffer:
                              marker_used = _MARKER_ALT
                          if marker_used:
                              _final_answer_seen = True
                              content = _pre_marker_buffer.split(marker_used, 1)[1]
                              logging.info(f"[FINAL ANSWER] marker found; streaming post-marker content ({len(content)} chars)")
                          else:
                              # Pre-marker: suppress (thinking/reasoning)
                              continue
                      if content:
                          yielded_chunk_count += 1
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": content,
                              "is_final_answer": True,
                          }

              # Handle AIMessage with tool calls (tool start indicators)
              elif isinstance(message, AIMessage) and hasattr(message, "tool_calls") and message.tool_calls:
                  for tool_call in message.tool_calls:
                      tool_name = tool_call.get("name", "")
                      tool_call_id = tool_call.get("id", "")

                      # Skip tool calls with empty names
                      if not tool_name or not tool_name.strip():
                          logging.debug("Skipping tool call with empty name")
                          continue

                      # Track this tool call as pending
                      if tool_call_id:
                          pending_tool_calls[tool_call_id] = tool_name
                          logging.debug(f"Tracked tool call: {tool_call_id} -> {tool_name}")

                      logging.info(f"Tool call started: {tool_name}")

                      # ── invoke_self_service_task: enter self-service mode ──
                      if tool_name == "invoke_self_service_task":
                          self._in_self_service_workflow = True
                          logging.info("🔄 Self-service workflow detected (AIMessage) — suppressing intermediate text streaming")
                          continue

                      # ── write_todos: emit per-task notifications + execution plan ──
                      if tool_name == "write_todos":
                          todos = tool_call.get("args", {}).get("todos", [])
                          plan_changed = False
                          for idx, todo in enumerate(todos):
                              todo_id = todo.get("id") if todo.get("id") is not None else idx
                              new_status = todo.get("status", "pending")
                              old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                              todo_content = todo.get("content", f"Step {todo_id}")

                              if todo_id not in self._previous_todos:
                                  plan_changed = True

                              if old_status != new_status:
                                  plan_changed = True
                                  if new_status == "in_progress":
                                      logging.info(f"📋 Task started: {todo_content}")
                                      yield {
                                          "is_task_complete": False,
                                          "require_user_input": False,
                                          "content": f"🔧 Workflow: Calling {todo_content}...\n",
                                          "tool_call": {
                                              "name": todo_content,
                                              "status": "started",
                                              "type": "notification"
                                          }
                                      }
                                  elif new_status == "completed":
                                      logging.info(f"✅ Task completed: {todo_content}")
                                      yield {
                                          "is_task_complete": False,
                                          "require_user_input": False,
                                          "content": f"✅ Workflow: {todo_content} completed\n",
                                          "tool_result": {
                                              "name": todo_content,
                                              "status": "completed",
                                              "type": "notification"
                                          }
                                      }

                              # Update tracked state
                              self._previous_todos[todo_id] = {
                                  "status": new_status,
                                  "content": todo_content,
                              }

                          # Emit execution plan from write_todos args directly
                          # (don't rely on ToolMessage path — write_todos returns a
                          # Command whose inner ToolMessage may not stream)
                          if todos and (plan_changed or not self._execution_plan_sent):
                              plan_text = self._build_todo_plan_text()
                              artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                              self._execution_plan_sent = True
                              logging.info(f"📋 Emitting {artifact_name} from write_todos AIMessage ({len(todos)} todos)")
                              yield {
                                  "is_task_complete": False,
                                  "require_user_input": False,
                                  "artifact": {
                                      "name": artifact_name,
                                      "description": "Execution plan",
                                      "text": plan_text,
                                  }
                              }
                          continue  # Skip generic notification for write_todos

                      # ── task: track subagent delegation and emit execution plan ──
                      if tool_name == "task":
                          task_args = tool_call.get("args", {})
                          subagent_type = task_args.get("subagent_type", "general-purpose")
                          task_desc = task_args.get("description", "Processing task")
                          display_desc = task_desc[:120].strip()
                          if len(task_desc) > 120:
                              display_desc += "..."
                          tc_id = tool_call.get("id", "")
                          if tc_id and tc_id not in self._task_plan_entries:
                              self._task_plan_entries[tc_id] = {
                                  "subagent": subagent_type,
                                  "description": display_desc,
                                  "status": "in_progress",
                              }
                              plan_text = self._build_todo_plan_text() if self._previous_todos else self._build_task_plan_text()
                              artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                              self._execution_plan_sent = True
                              logging.info(f"📋 Emitting {artifact_name} from task call: [{subagent_type}] {display_desc}")
                              yield {
                                  "is_task_complete": False,
                                  "require_user_input": False,
                                  "artifact": {
                                      "name": artifact_name,
                                      "description": "Execution plan from subagent delegation",
                                      "text": plan_text,
                                  }
                              }
                          continue

                      # ── All other tools: emit standard tool notification ──
                      tool_name_formatted = tool_name.title()
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "content": f"🔧 Supervisor: Calling Agent {tool_name_formatted}...\n",
                          "tool_call": {
                              "name": tool_name,
                              "status": "started",
                              "type": "notification"
                          }
                      }

              # Handle ToolMessage (tool completion indicators + content)
              elif isinstance(message, ToolMessage):
                  tool_name = message.name if hasattr(message, 'name') else None
                  tool_content = message.content if hasattr(message, 'content') else ""

                  # Normalize tool_content to string (Bedrock returns list, OpenAI returns string)
                  if isinstance(tool_content, list):
                      # If content is a list (AWS Bedrock), extract text from content blocks
                      text_parts = []
                      for item in tool_content:
                          if isinstance(item, dict):
                              text_parts.append(item.get('text', ''))
                          elif isinstance(item, str):
                              text_parts.append(item)
                          else:
                              text_parts.append(str(item))
                      tool_content = ''.join(text_parts)
                  elif not isinstance(tool_content, str):
                      tool_content = str(tool_content) if tool_content else ""

                  # Mark tool call as completed (remove from pending)
                  # Also resolve tool_name from pending_tool_calls if message.name is None
                  # (middleware-injected ToolMessages may have name=None)
                  tool_call_id = message.tool_call_id if hasattr(message, 'tool_call_id') else None
                  if tool_call_id and tool_call_id in pending_tool_calls:
                      resolved_name = pending_tool_calls.pop(tool_call_id)
                      if not tool_name:
                          tool_name = resolved_name
                      logging.debug(f"Resolved tool call: {tool_call_id} -> {tool_name}")

                  # Ensure tool_name is never None
                  if not tool_name:
                      tool_name = "unknown"

                  logging.debug(f"Tool call completed: {tool_name} (content: {len(tool_content)} chars)")

                  # Track sub-agent responses for fallback if synthesis fails
                  # Only track significant responses (sub-agent tools like 'task', agent names)
                  if tool_content and len(tool_content) > 100:
                      if tool_name not in accumulated_subagent_responses:
                          accumulated_subagent_responses[tool_name] = []
                      accumulated_subagent_responses[tool_name].append(tool_content)
                      logging.debug(f"📦 Tracked sub-agent response from {tool_name}: {len(tool_content)} chars")

                  # Get RAG tool names dynamically from the MAS instance
                  rag_tool_names = self._mas_instance.get_rag_tool_names()

                  # Mark task (subagent) completion in execution plan
                  if tool_name == "task" and tool_call_id and tool_call_id in self._task_plan_entries:
                      self._task_plan_entries[tool_call_id]["status"] = "completed"
                      plan_text = self._build_todo_plan_text() if self._previous_todos else self._build_task_plan_text()
                      logging.info(f"✅ Emitting execution_plan_status_update: task {tool_call_id} completed")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "artifact": {
                              "name": "execution_plan_status_update",
                              "description": "Task completed",
                              "text": plan_text,
                          }
                      }

                  # Special handling for write_todos ToolMessages:
                  # Skip emitting execution plan here — the updates handler
                  # (todo transition at line ~762) already emits the plan using
                  # _build_todo_plan_text() which produces the emoji+bracket
                  # format the UI can parse (e.g. "🔄 [PagerDuty] Get on-call").
                  # The raw ToolMessage content is just "Updated todo list to
                  # [{...}]" which doesn't match the UI regex.
                  if tool_name == "write_todos":
                      logging.debug("📋 Skipping write_todos ToolMessage for exec plan (handled by updates handler)")
                  elif tool_name in rag_tool_names:
                    # For RAG tools, we don't want to stream the content, as its a LOT of text
                      logging.debug(f"Suppressing RAG tool content for {tool_name} (tool_call notification already sent)")
                  # Stream other tool content as a tool notification (not chat text)
                  # During self-service workflows, suppress intermediate tool output —
                  # the final structured response will contain a clean summary
                  elif tool_content and tool_content.strip():
                      if self._in_self_service_workflow:
                          logging.debug(f"Suppressed tool output ({tool_name}, {len(tool_content)} chars) during self-service workflow")
                      else:
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": tool_content + "\n",
                              "tool_result": {
                                  "name": tool_name,
                                  "status": "output",
                                  "type": "tool_output"
                              }
                          }

                  # Stream completion notification (skip for write_todos and task —
                  # their lifecycle is handled via per-task notifications above)
                  # Also skip during self-service workflows to avoid noisy notifications
                  if tool_name not in ("write_todos", "task") and not self._in_self_service_workflow:
                      tool_name_formatted = (tool_name or "unknown").title()
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "content": f"✅ Supervisor: Agent task {tool_name_formatted} completed\n",
                          "tool_result": {
                              "name": tool_name,
                              "status": "completed",
                              "type": "notification"
                          }
                      }

              # Handle final AIMessage (without tool calls) from primary stream
              elif isinstance(message, AIMessage):
                  # This is the final complete AIMessage - store it for post-stream parsing
                  #
                  # FIX #1 for A2A Streaming Duplication:
                  # ---------------------------------
                  # During streaming, we receive AIMessageChunk tokens one-by-one, each appended to
                  # accumulated_ai_content. At the end, LangChain emits a final AIMessage containing
                  # the COMPLETE text (all tokens combined). If we also append this final message,
                  # we get: [chunk1, chunk2, ..., chunkN, "chunk1+chunk2+...+chunkN"] = DUPLICATION!
                  #
                  # Solution: Only accumulate the final AIMessage if NO streaming chunks were received
                  # (non-streaming fallback mode). Otherwise, skip it since chunks already have the content.
                  logging.info(f"🎯 CAPTURED final AIMessage from primary stream: type={type(message).__name__}, has_content={hasattr(message, 'content')}")
                  if hasattr(message, 'content'):
                      content_preview = str(message.content)[:200]
                      logging.info(f"🎯 AIMessage content preview: {content_preview}...")
                      if not accumulated_ai_content:
                          # Non-streaming mode: no chunks received, use the complete AIMessage
                          logging.info("📝 Accumulating AIMessage content (no streaming chunks received)")
                          accumulated_ai_content.append(str(message.content))
                      else:
                          # Streaming mode: chunks already contain the content, skip the final AIMessage
                          logging.info(f"⏭️ SKIPPING AIMessage accumulation - already have {len(accumulated_ai_content)} streaming chunks")
                  final_ai_message = message

      except asyncio.CancelledError:
          logging.warning("⚠️ Primary stream cancelled by client disconnection - parsing final response before exit")
          # Don't return immediately - let post-stream parsing run below
      except Exception as e:
          # ── GraphInterrupt (HITL) takes priority ──
          exception_type = type(e).__name__
          is_graph_interrupt = (
              "Interrupt" in exception_type
              or (GraphInterrupt is not None and isinstance(e, GraphInterrupt))
          )

          if is_graph_interrupt:
              logging.info("🔄 GraphInterrupt caught in stream exception handler - propagating as HITL form")
              interrupt_value = self._extract_interrupt_value(e)
              if interrupt_value:
                  form_event = self._build_hitl_form_event(interrupt_value, label="primary")
                  if form_event:
                      yield form_event
                      return
              logging.warning("[Interrupt] Could not extract form data, falling through to error handling")

          error_str = str(e)
          is_recursion_limit = (
              (GraphRecursionError is not None and isinstance(e, GraphRecursionError))
              or "recursion limit" in error_str.lower()
          )
          logging.warning(f"Primary stream failed (recursion_limit={is_recursion_limit}): {error_str}")

          # ==============================================================
          # Phase 1: State Repair (always, best-effort)
          # ==============================================================
          yield {
              "is_task_complete": False,
              "require_user_input": False,
              "clear_accumulators": True,
              "content": "",
          }
          accumulated_ai_content.clear()
          final_ai_message = None
          response_format_result = None
          _final_answer_seen = False
          _pre_marker_buffer = ""

          try:
              await self._repair_orphaned_tool_calls(config)
          except Exception as repair_err:
              logging.warning(f"State repair (orphaned tools) failed: {repair_err}")

          is_context_overflow = any(
              phrase in error_str.lower()
              for phrase in (
                  "input is too long", "prompt is too long",
                  "too many tokens", "context length exceeded",
              )
          ) or ("token" in error_str.lower() and "maximum" in error_str.lower())

          if is_context_overflow:
              logging.warning(f"Context overflow detected, attempting aggressive summarization: {error_str[:200]}")
              try:
                  state = await self.graph.aget_state(config)
                  messages = state.values.get("messages", []) if state and state.values else []
                  if messages:
                      model = LLMFactory().get_llm()
                      result = await summarize_messages(
                          messages=messages,
                          model=model,
                          agent_name="supervisor",
                      )
                      if result.success and result.summary_message:
                          await self.graph.aupdate_state(config, {"messages": [result.summary_message]})
                          logging.info(
                              f"Context summarized: langmem={result.used_langmem}, "
                              f"tokens_saved={result.tokens_saved:,}"
                          )
                      else:
                          await self.graph.aupdate_state(config, {"messages": []})
                          logging.warning(f"Summarization failed ({result.error}), cleared history")
              except Exception as summ_err:
                  logging.error(f"Aggressive summarization failed: {summ_err}")
          else:
              try:
                  max_ctx = int(os.getenv("MAX_CONTEXT_TOKENS", "0"))
                  if not max_ctx:
                      logging.warning("MAX_CONTEXT_TOKENS not set; skipping context compression in error recovery")
                  else:
                      await preflight_context_check(
                          graph=self.graph,
                          config=config,
                          model=LLMFactory().get_llm(),
                          agent_name="supervisor",
                          max_context_tokens=max_ctx,
                          min_messages_to_keep=4,
                          tool_count=50,
                      )
              except Exception as ctx_err:
                  logging.warning(f"State repair (context compression) failed: {ctx_err}")

          # ==============================================================
          # Decision: retry once, or go straight to wrap-up?
          # Recursion limit means the agent looped -- more steps won't help.
          # Everything else might be fixed by the state repair above.
          # ==============================================================
          if not is_recursion_limit:
              try:
                  message = None
                  async for item_type, item in self.graph.astream(
                      inputs, config,
                      stream_mode=['messages', 'custom', 'updates'],
                  ):
                      # ── GraphInterrupt in retry ──
                      if isinstance(item, dict) and "__interrupt__" in item:
                          form_event = self._handle_interrupt_event(item, label="retry")
                          if form_event:
                              yield form_event
                              return
                          continue

                      if isinstance(item, dict):
                          if item.get("type") == "a2a_event":
                              event_obj = self._deserialize_a2a_event(item.get("data"))
                              if event_obj is not None:
                                  yield event_obj
                                  continue
                              else:
                                  logging.warning("Retry: a2a_event deserialization failed; ignoring.")
                          elif item.get("type") == "human_prompt":
                              yield {
                                  "is_task_complete": False,
                                  "require_user_input": True,
                                  "content": item.get("prompt", ""),
                                  "metadata": {"options": item.get("options", [])} if item.get("options") else {},
                              }
                              continue

                      if item_type == 'updates' and isinstance(item, dict) and 'generate_structured_response' in item:
                          structured_resp = item['generate_structured_response'].get('structured_response')
                          if structured_resp is not None:
                              parsed = self.handle_structured_response(structured_resp)
                              parsed['from_response_format_tool'] = True
                              response_format_result = parsed
                              logging.info(
                                  f"Retry stream: generate_structured_response captured "
                                  f"(content_len={len(parsed.get('content', ''))})"
                              )
                              yield parsed
                          continue

                      if item_type == 'messages':
                          message = item[0] if item else None

                      if message is None:
                          continue

                      if (
                          isinstance(message, AIMessage)
                          and getattr(message, "tool_calls", None)
                          and len(message.tool_calls) > 0
                      ):
                          yield {"is_task_complete": False, "require_user_input": False, "content": ""}
                      elif isinstance(message, AIMessageChunk):
                          content = message.content
                          if isinstance(content, list):
                              content = ''.join(
                                  item.get('text', '') if isinstance(item, dict) else str(item)
                                  for item in content
                              )
                          elif not isinstance(content, str):
                              content = str(content) if content else ''
                          if content:
                              accumulated_ai_content.append(content)
                          yield {"is_task_complete": False, "require_user_input": False, "content": content}
                      elif isinstance(message, AIMessage):
                          if hasattr(message, 'content'):
                              accumulated_ai_content.append(str(message.content))
                          final_ai_message = message

              except Exception as retry_err:
                  # GraphInterrupt from retry stream
                  retry_exc_type = type(retry_err).__name__
                  if (
                      "Interrupt" in retry_exc_type
                      or (GraphInterrupt is not None and isinstance(retry_err, GraphInterrupt))
                  ):
                      interrupt_value = self._extract_interrupt_value(retry_err)
                      if interrupt_value:
                          form_event = self._build_hitl_form_event(interrupt_value, label="retry-exception")
                          if form_event:
                              yield form_event
                              return
                  logging.error(f"Retry after state repair also failed: {retry_err}")
                  error_str = str(retry_err)

          # ==============================================================
          # Phase 2: Wrap-up -- if retry was skipped (recursion limit) or
          # retry didn't produce a structured response, re-invoke the
          # graph's generate_structured_response node. We inject an
          # AIMessage describing the error (as_node="model") so the
          # graph routes to structured response generation using its
          # own system prompt and the full conversation context.
          # ==============================================================
          # Phase 2: direct LLM call with structured output.
          # Bypasses the graph entirely so RAG tools cannot interfere.
          # Uses with_structured_output(PlatformEngineerResponse) to force
          # a clean final answer from the accumulated conversation context.
          # ==============================================================
          if not response_format_result:
              logging.info(f"Phase 2 wrap-up: direct LLM structured output call (error: {error_str[:80]}...)")
              try:
                  response_format_result = await self._direct_structured_response(config, error_str)
                  if response_format_result:
                      logging.info(f"Phase 2 structured response captured (content_len={len(response_format_result.get('content',''))})")
                      yield response_format_result
              except Exception as wrapup_err:
                  logging.error(f"Phase 2 wrap-up failed: {wrapup_err}")

          if not response_format_result:
              fallback_msg = (
                  "I ran into an issue while processing your request. "
                  "Please ask me to continue or try your question again."
              )
              response_format_result = {
                  'content': fallback_msg,
                  'is_task_complete': True,
                  'require_user_input': False,
              }
              yield {
                  "is_task_complete": True,
                  "require_user_input": False,
                  "content": fallback_msg,
                  "from_response_format_tool": True,
              }

      # ── Catch-all: sync execution plan with final graph state ──
      # Command-based state updates (from DeterministicTaskMiddleware) may not
      # produce updates-stream events, so _previous_todos can fall behind.
      # Reading the graph state here guarantees the UI sees the true final plan.
      try:
          final_state = await self.graph.aget_state(config)
          final_todos = (final_state.values or {}).get("todos", []) if final_state else []
          if final_todos:
              plan_dirty = False
              for todo in final_todos:
                  if not isinstance(todo, dict):
                      continue
                  tid = todo.get("id")
                  new_s = todo.get("status", "pending")
                  old_s = self._previous_todos.get(tid, {}).get("status", "pending")
                  if tid not in self._previous_todos or old_s != new_s:
                      plan_dirty = True
                      self._previous_todos[tid] = {
                          "status": new_s,
                          "content": todo.get("content", f"Step {tid}"),
                      }
              if plan_dirty:
                  plan_text = self._build_todo_plan_text()
                  artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                  self._execution_plan_sent = True
                  logging.info(f"📋 Post-stream catch-all: emitting {artifact_name} ({len(self._previous_todos)} todos)")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "artifact": {
                          "name": artifact_name,
                          "description": "Execution plan sync",
                          "text": plan_text,
                      }
                  }
      except Exception as plan_sync_err:
          logging.warning(f"Post-stream plan sync failed: {plan_sync_err}")

      # Retrieve the supervisor's final AIMessage from graph state.
      # In streaming mode, AIMessageChunks are emitted but the final complete
      # AIMessage is not — so final_ai_message is typically None. We get it
      # from the committed graph state instead (the last AIMessage with text content).
      if final_ai_message is None:
          try:
              graph_state = await self.graph.aget_state(config)
              if graph_state and graph_state.values:
                  state_messages = graph_state.values.get("messages", [])
                  for msg in reversed(state_messages):
                      if isinstance(msg, AIMessage) and not isinstance(msg, AIMessageChunk):
                          msg_content = msg.content if hasattr(msg, 'content') else ""
                          has_text = bool(msg_content) if isinstance(msg_content, str) else any(
                              (isinstance(p, str) and p) or (isinstance(p, dict) and p.get('text'))
                              for p in (msg_content if isinstance(msg_content, list) else [])
                          )
                          if has_text:
                              final_ai_message = msg
                              logging.info(f"📥 Retrieved final AIMessage from graph state ({len(str(msg_content))} chars)")
                              break
          except Exception as state_err:
              logging.warning(f"Could not retrieve graph state for final message: {state_err}")

      logging.info(f"🔍 POST-STREAM PARSING: final_ai_message={final_ai_message is not None}, accumulated_chunks={len(accumulated_ai_content)}, final_answer_seen={_final_answer_seen}")

      # If structured response was already extracted from ResponseFormat tool,
      # use it directly — no need to re-parse accumulated text content
      if response_format_result:
          logging.info(f"✅ Using ResponseFormat result: is_task_complete={response_format_result.get('is_task_complete')}")
          final_response = {
              'is_task_complete': response_format_result.get('is_task_complete', True),
              'require_user_input': response_format_result.get('require_user_input', False),
              'content': response_format_result.get('content', ''),
          }
      # Try to use final_ai_message first, otherwise use accumulated content
      elif final_ai_message:
          logging.info("✅ Using final AIMessage for structured response parsing")
          # Extract content from AIMessage
          final_content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
          # Normalize final_content to string (Bedrock returns list, OpenAI returns string)
          if isinstance(final_content, list):
              text_parts = []
              for item in final_content:
                  if isinstance(item, dict):
                      text_parts.append(item.get('text', ''))
                  elif isinstance(item, str):
                      text_parts.append(item)
                  else:
                      text_parts.append(str(item))
              final_content = ''.join(text_parts)
          elif not isinstance(final_content, str):
              final_content = str(final_content) if final_content else ""
          logging.info(f"📝 Extracted content from AIMessage: type={type(final_content)}, length={len(final_content)}")
          logging.info(f"📝 Content preview: {final_content[:300]}...")
          final_response = self.handle_structured_response(final_content)
          logging.info(f"✅ Parsed response from final AIMessage: is_task_complete={final_response.get('is_task_complete')}")
      elif accumulated_ai_content:
          accumulated_text = ''.join(accumulated_ai_content)
          logging.info(f"⚠️ Using accumulated content ({len(accumulated_text)} chars) for structured response parsing")
          logging.info(f"📝 Accumulated content preview: {accumulated_text[:300]}...")
          final_response = self.handle_structured_response(accumulated_text)
          logging.info(f"✅ Parsed response from accumulated content: is_task_complete={final_response.get('is_task_complete')}")
      else:
          logging.warning("❌ No final message or accumulated content to parse - defaulting to complete")
          final_response = {
              'is_task_complete': True,
              'require_user_input': False,
              'content': '',
          }

      # Attach the clean final model response so the executor can use it
      # for the final_result artifact instead of the accumulated streaming text.
      # This is the output of the LAST model call only (the supervisor summary),
      # not the intermediate thinking/sub-agent text that was streamed live.
      if final_ai_message:
          clean_content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
          if isinstance(clean_content, list):
              parts = []
              for item in clean_content:
                  if isinstance(item, dict):
                      parts.append(item.get('text', ''))
                  elif isinstance(item, str):
                      parts.append(item)
                  else:
                      parts.append(str(item))
              clean_content = ''.join(parts)
          elif not isinstance(clean_content, str):
              clean_content = str(clean_content) if clean_content else ""
          if clean_content:
              # Strip pre-marker thinking so final_model_content is the clean answer only
              for _m in ('[FINAL ANSWER]', '[FINAL_ANSWER]'):
                  if _m in clean_content:
                      clean_content = clean_content.split(_m, 1)[1].strip()
                      break
              final_response['final_model_content'] = clean_content
              logging.info(f"📤 Attached final_model_content ({len(clean_content)} chars) for executor final_result")

      # Dedup: clear streaming content when it was already streamed to the client.
      # The final_model_content field (above) is NOT cleared — the executor uses
      # it to build the final_result artifact that replaces the streaming text.
      #
      # Pass yielded_chunk_count to the executor so it can decide whether to
      # emit deterministic streaming chunks for the final answer.  When > 0 the
      # answer was already streamed live (post-marker tokens); when 0 the pre-marker
      # buffer held everything back and the executor must chunk-stream it now.
      final_response['streaming_chunks_yielded'] = yielded_chunk_count
      if yielded_chunk_count > 1:
          logging.info(f"⏭️ Clearing content from final response - already streamed {yielded_chunk_count} chunks (accumulated {len(accumulated_ai_content)})")
          final_response['content'] = ''
      elif accumulated_ai_content:
          logging.info(f"📤 Keeping content in final response - {len(accumulated_ai_content)} chunks accumulated but only {yielded_chunk_count} yielded")

      c_len = len(final_response.get('content', ''))
      fmc_len = len(final_response.get('final_model_content', ''))
      logging.info(
          f"🚀 YIELDING FINAL RESPONSE: is_task_complete={final_response.get('is_task_complete')}, "
          f"require_user_input={final_response.get('require_user_input')}, "
          f"content_length={c_len}, final_model_content={fmc_len}"
      )
      yield final_response

  def handle_structured_response(self, ai_message):
    logging.info(f"🔧 handle_structured_response called: input_type={type(ai_message).__name__}")
    try:
      response_obj = None
      if isinstance(ai_message, PlatformEngineerResponse):
          logging.info("✅ Input is already PlatformEngineerResponse")
          response_obj = ai_message
      elif isinstance(ai_message, dict):
          logging.info("✅ Input is dict, validating as PlatformEngineerResponse")
          response_obj = PlatformEngineerResponse.model_validate(ai_message)
      elif isinstance(ai_message, str):
          raw_content = ai_message.strip()
          logging.info(f"✅ Input is string ({len(raw_content)} chars), attempting to parse JSON")
          # Strip Markdown code fences if present
          if raw_content.startswith('```') and raw_content.endswith('```'):
              if raw_content.startswith('```json'):
                  raw_content = raw_content[7:-3].strip()
                  logging.info("Stripped ```json``` markdown")
              else:
                  raw_content = raw_content[3:-3].strip()
                  logging.info("Stripped ``` markdown")

          # Try to find and parse the last valid PlatformEngineerResponse JSON object
          # The LLM sometimes outputs multiple JSON objects or text before JSON
          # Strategy: Find all potential JSON start positions and try to parse from the LAST valid one

          response_obj = None
          brace_positions = [i for i, c in enumerate(raw_content) if c == '{']

          # Try parsing from each '{' position, starting from the END (last JSON object)
          for start_pos in reversed(brace_positions):
              try:
                  candidate = raw_content[start_pos:]
                  response_obj = PlatformEngineerResponse.model_validate_json(candidate)
                  logging.info(f"✅ Successfully parsed PlatformEngineerResponse from position {start_pos}")
                  break
              except Exception:
                  continue

          if response_obj is None:
              logging.info("❌ Could not parse any valid PlatformEngineerResponse from content")
    except Exception as e:
      logging.warning(f"❌ Failed to deserialize PlatformEngineerResponse: {e}")

    if response_obj is not None:
      logging.info(f"✅ Successfully created response_obj: is_task_complete={response_obj.is_task_complete}, require_user_input={response_obj.require_user_input}")
      result = {
        'is_task_complete': response_obj.is_task_complete,
        'require_user_input': response_obj.require_user_input,
        'content': response_obj.content,
      }
      # Add metadata if present
      if getattr(response_obj, "metadata", None):
          md = response_obj.metadata
          result['metadata'] = {
            'user_input': getattr(md, 'user_input', None),
            'input_fields': [
              {
                'field_name': f.field_name,
                'field_description': f.field_description,
                'field_values': getattr(f, 'field_values', None),
                'required': getattr(f, 'required', True)
              }
              for f in (md.input_fields or [])
            ] if getattr(md, 'input_fields', None) else None
          }
      logging.info(f"🎉 Returning structured response: is_task_complete={result.get('is_task_complete')}, require_user_input={result.get('require_user_input')}")
      return result

    # Fallback: handle plain text or attempt JSON parsing for backward compatibility
    logging.info("⚠️ Falling back to legacy JSON parsing")
    try:
      content = ai_message if isinstance(ai_message, str) else str(ai_message)

      # Log the raw content for debugging
      logging.info(f"Raw LLM content (fallback handling): {repr(content)}")

      # Strip markdown code block formatting if present
      if content.startswith('```json') and content.endswith('```'):
        content = content[7:-3].strip()  # Remove ```json at start and ``` at end
        logging.info("Stripped ```json``` formatting")
      elif content.startswith('```') and content.endswith('```'):
        content = content[3:-3].strip()  # Remove ``` at start and end
        logging.info("Stripped ``` formatting")

      logging.info(f"Content after stripping: {repr(content)}")

      # If content doesn't look like JSON, treat it as plain text
      if not (content.startswith('{') or content.startswith('[')):
        # Check if content contains [FINAL ANSWER] marker indicating task completion
        marker = '[FINAL ANSWER]'
        alt_marker = '[FINAL_ANSWER]'
        if marker in content or alt_marker in content:
          logging.info("Content contains [FINAL ANSWER] marker; marking as complete.")
          return {
            'is_task_complete': True,
            'require_user_input': False,
            'content': content,
          }
        else:
          # Plain text with no [FINAL ANSWER] marker — model is still working.
          logging.info("Content is plain text with no marker; treating as incomplete.")
          return {
            'is_task_complete': False,
            'require_user_input': False,
            'content': content,
          }

      # Attempt to parse JSON
      response_dict = json.loads(content)
      if isinstance(response_dict, dict):
        logging.info("Successfully parsed JSON response (fallback)")
        return response_dict
      else:
        logging.warning("Parsed JSON is not a dictionary; treating as incomplete plain-text response.")
        return {
          'is_task_complete': False,
          'require_user_input': False,
          'content': content,
        }
    except json.JSONDecodeError as e:
      logging.warning(f"Failed to decode content as JSON, treating as incomplete response: {e}")
      logging.warning(f"Content that failed to parse: {repr(content)}")
      return {
        'is_task_complete': False,
        'require_user_input': False,
        'content': content,
      }
