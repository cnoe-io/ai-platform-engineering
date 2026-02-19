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
from ai_platform_engineering.multi_agents.platform_engineer.deep_agent_single import (
    AIPlatformEngineerMAS,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager
from ai_platform_engineering.utils.a2a_common.langmem_utils import (
    summarize_messages,
    preflight_context_check,
)
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from langgraph.types import Command

# Import GraphInterrupt for proper HITL handling
try:
    from langgraph.errors import GraphInterrupt
except ImportError:
    # Fallback for older versions
    GraphInterrupt = None

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AIPlatformEngineerA2ABinding:
  """
  AI Platform Engineer Multi-Agent System (MAS) for platform engineering tasks.
  """

  SYSTEM_INSTRUCTION = system_prompt

  def __init__(self):
      # Store the MAS instance (not yet initialized - call ensure_initialized() first)
      self._mas_instance = AIPlatformEngineerMAS()
      self.graph = None  # Set after ensure_initialized()
      self.tracing = TracingManager()
      self._execution_plan_sent = False
      self._previous_todos: dict[int, dict] = {}  # Track todo states for notifications
      self._task_plan_entries: dict[str, dict] = {}  # Track task (subagent) calls for execution plan
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
                  tool_calls = getattr(msg, 'tool_calls', None) or []
                  msg_id = getattr(msg, 'id', None)
                  for tc in tool_calls:
                      tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                      tc_name = tc.get('name') if isinstance(tc, dict) else getattr(tc, 'name', 'unknown')
                      if tc_id:
                          tool_calls_info[tc_id] = (idx, tc_name, msg_id)

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
      for todo_id in sorted(self._previous_todos.keys(), key=lambda x: (int(x) if str(x).isdigit() else x)):
          entry = self._previous_todos[todo_id]
          icon = status_icons.get(entry["status"], "⏳")
          content = entry["content"]
          lines.append(f"{icon} {content}")
      return "\n".join(lines)

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
      config['recursion_limit'] = 100

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

      # ========================================================================
      # SYNTHESIS RETRY CONFIGURATION
      # If synthesis fails (orphaned tool calls, timeout), retry before failing
      # ========================================================================
      max_synthesis_retries = int(os.getenv("MAX_SYNTHESIS_RETRIES", "0"))
      synthesis_retry_count = 0

      try:
          # Track accumulated AI message content for final parsing
          accumulated_ai_content = []
          final_ai_message = None

          # Track sub-agent responses for fallback if synthesis fails
          # Format: {tool_name: response_content}
          accumulated_subagent_responses = {}

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

                  # Create synthetic AIMessage with tool_calls for form display
                  synth_msg = AIMessage(
                      content="Please provide the required information.",
                      tool_calls=tool_calls,
                  )
                  logging.info(f"[Interrupt] Yielding form with {len(tool_calls)} tool_calls")
                  is_interrupt = True
                  yield {
                      "event_type": "interrupt",
                      "message": synth_msg,
                      "is_task_complete": False,
                      "require_user_input": True,
                      "content": "",
                      "agent_type": "caipe",
                      "node_name": "caipe",
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
                  new_task_detected = False
                  for msgs in messages_lists:
                      for msg in msgs:
                          if not (isinstance(msg, AIMessage) and hasattr(msg, 'tool_calls') and msg.tool_calls):
                              continue
                          for tc in msg.tool_calls:
                              if tc.get("name") != "task":
                                  continue
                              tc_id = tc.get("id", "")
                              if not tc_id or tc_id in self._task_plan_entries:
                                  continue
                              tc_args = tc.get("args") or {}
                              subagent_type = tc_args.get("subagent_type", "general-purpose") if isinstance(tc_args, dict) else "general-purpose"
                              task_desc = tc_args.get("description", "Processing task") if isinstance(tc_args, dict) else "Processing task"
                              display_desc = task_desc[:120].strip()
                              if len(task_desc) > 120:
                                  display_desc += "..."
                              self._task_plan_entries[tc_id] = {
                                  "subagent": subagent_type,
                                  "description": display_desc,
                                  "status": "in_progress",
                              }
                              new_task_detected = True
                              logging.info(f"📋 Detected task from updates: [{subagent_type}] {display_desc}")

                  # Emit plan for newly detected tasks.
                  # When _previous_todos is populated (deterministic workflows),
                  # use the todo plan (which includes ALL steps like CAIPE).
                  # Otherwise fall back to the task-plan-only view.
                  if new_task_detected:
                      if self._previous_todos:
                          plan_text = self._build_todo_plan_text()
                      else:
                          plan_text = self._build_task_plan_text()
                      artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                      self._execution_plan_sent = True
                      logging.info(f"📋 Emitting {artifact_name} from task detection (todo-backed={bool(self._previous_todos)})")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "artifact": {
                              "name": artifact_name,
                              "description": "Execution plan from subagent delegation",
                              "text": plan_text,
                          }
                      }

                  # ── Track todo transitions and re-emit execution plan ──
                  plan_changed = False
                  for todos in todos_lists:
                      for todo in todos:
                          if not isinstance(todo, dict):
                              continue
                          todo_id = todo.get("id")
                          new_status = todo.get("status", "pending")
                          old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                          todo_content = todo.get("content", f"Step {todo_id}")

                          # Always track every todo we see (needed to rebuild the full plan)
                          if todo_id not in self._previous_todos:
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

                          # write_todos — skip generic notification (handled by ToolMessage path)
                          if tool_name == "write_todos":
                              logging.debug("Skipping chunk notification for 'write_todos' (handled by ToolMessage path)")
                              continue

                          # task — note the tool_call_id for later (args are incomplete in chunks,
                          # the full AIMessage with complete args arrives via the updates stream)
                          if tool_name == "task":
                              logging.debug(f"Noted task chunk tool_call_id={tool_call.get('id', '')}, will emit plan from updates stream")
                              continue

                          logging.debug(f"Tool call started (from AIMessageChunk): {tool_name}")

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

                  # Accumulate content for post-stream parsing
                  if content:
                      accumulated_ai_content.append(content)

                  if content:  # Only yield if there's actual content
                      # Check for querying announcements and emit as tool_update events
                      import re
                      querying_pattern = r'🔍\s+Querying\s+(\w+)\s+for\s+([^.]+?)\.\.\.'
                      match = re.search(querying_pattern, content)

                      if match:
                          agent_name = match.group(1)
                          purpose = match.group(2)
                          logging.debug(f"Tool update detected: {agent_name} - {purpose}")
                          # Emit as tool_update event
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": content,
                              "tool_update": {
                                  "name": agent_name.lower(),
                                  "purpose": purpose,
                                  "status": "querying",
                                  "type": "update"
                              }
                          }
                      else:
                          # Regular content - no special handling
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": content,
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

                      # ── write_todos: emit per-task notifications ──
                      if tool_name == "write_todos":
                          todos = tool_call.get("args", {}).get("todos", [])
                          for todo in todos:
                              todo_id = todo.get("id")
                              new_status = todo.get("status", "pending")
                              old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                              todo_content = todo.get("content", f"Step {todo_id}")

                              if old_status != new_status:
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
                          # Only emit if not already tracked from chunk path
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
                          elif tc_id and tc_id in self._task_plan_entries:
                              # Update with full args (chunk might have had partial args)
                              entry = self._task_plan_entries[tc_id]
                              if subagent_type != "general-purpose":
                                  entry["subagent"] = subagent_type
                              if task_desc != "Processing task":
                                  entry["description"] = display_desc
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

                  # This is a hard-coded list for now
                  # TODO: Fetch the rag tool names from when the deep agent is initialised
                  rag_tool_names = {
                      'search', 'fetch_document', 'fetch_datasources_and_entity_types',
                      'graph_explore_ontology_entity', 'graph_explore_data_entity',
                      'graph_fetch_data_entity_details', 'graph_shortest_path_between_entity_types',
                      'graph_raw_query_data', 'graph_raw_query_ontology'
                  }

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

                  # Special handling for write_todos: execution plan vs status updates
                  if tool_name == "write_todos" and tool_content and tool_content.strip():
                      if not self._execution_plan_sent:
                          self._execution_plan_sent = True
                          logging.debug("📋 Emitting initial TODO list as execution_plan_update artifact")
                          # Emit as execution plan artifact for client display in execution plan pane
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "artifact": {
                                  "name": "execution_plan_update",
                                  "description": "TODO-based execution plan",
                                  "text": tool_content
                              }
                          }
                      else:
                          logging.debug("📊 Emitting TODO progress update as execution_plan_status_update artifact")
                          # This is a TODO status update (merge=true) - emit as status update
                          # Client should update the execution plan pane in-place, not add to chat
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "artifact": {
                                  "name": "execution_plan_status_update",
                                  "description": "TODO progress update",
                                  "text": tool_content
                              }
                          }
                  elif tool_name in rag_tool_names:
                    # For RAG tools, we don't want to stream the content, as its a LOT of text
                      yield {
                            "is_task_complete": False,
                            "require_user_input": False,
                            "content": f"🔍 {tool_name}...",
                      }
                  # Stream other tool content normally (actual results for user)
                  elif tool_content and tool_content.strip():
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "content": tool_content + "\n",
                      }

                  # Stream completion notification (skip for write_todos and task —
                  # their lifecycle is handled via per-task notifications above)
                  if tool_name not in ("write_todos", "task"):
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
      except ValueError as ve:
          # Handle LangGraph validation errors (e.g., orphaned tool_calls, context overflow)
          error_str = str(ve)

          # Check if it's an orphaned tool call error
          if "tool_calls that do not have a corresponding ToolMessage" in error_str:
              logging.error(f"❌ Orphaned tool calls detected: {list(pending_tool_calls.values())}")

              # Add synthetic ToolMessages for orphaned calls to recover
              try:
                  synthetic_messages = []
                  for tool_call_id, tool_name in pending_tool_calls.items():
                      synthetic_msg = ToolMessage(
                          content="Tool call interrupted or failed to complete.",
                          tool_call_id=tool_call_id,
                          name=tool_name,
                      )
                      synthetic_messages.append(synthetic_msg)

                  if synthetic_messages:
                      await self.graph.aupdate_state(config, {"messages": synthetic_messages})
                      logging.info(f"✅ Added {len(synthetic_messages)} synthetic ToolMessages to recover from orphaned tool calls")
                      # Clear tracking
                      pending_tool_calls.clear()
              except Exception as recovery_error:
                  logging.error(f"Failed to add synthetic ToolMessages: {recovery_error}")

              # Preserve user's query in the error message
              user_query_preview = query[:200] if len(query) > 200 else query

              yield {
                  "is_task_complete": False,
                  "require_user_input": False,
                  "clear_accumulators": True,  # Signal to executor to clear accumulated content before retry
                  "content": (
                      "✅ I've recovered from an interrupted tool call. "
                      "Let me continue processing your request...\n\n"
                      f"Your query: {user_query_preview}\n\n"
                      "Proceeding..."
                  ),
              }

              # Try to re-invoke the graph with the same query to continue
              try:
                  # Re-stream with recovered state (use same streaming mode as main stream)
                  retry_stream_mode = ['messages', 'custom'] if os.getenv("ENABLE_STREAMING", "true").lower() == "true" else ['values', 'custom']
                  async for item_type, item in self.graph.astream(inputs, config, stream_mode=retry_stream_mode):
                      if item_type == 'custom' and isinstance(item, dict):
                          if item.get("type") == "a2a_event":
                              custom_text = item.get("data", "")
                              if custom_text:
                                  yield {"is_task_complete": False, "require_user_input": False, "content": custom_text}
                      elif item_type == 'messages':
                          message = item[0] if item else None
                          if isinstance(message, AIMessage) and hasattr(message, 'content') and message.content:
                              yield {"is_task_complete": False, "require_user_input": False, "content": str(message.content)}
                  return
              except Exception as retry_error:
                  logging.error(f"Retry after recovery failed: {retry_error}")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "❌ Recovery retry failed. Please ask your question again."
                  }
                  return

          # Check if it's a Bedrock tool_use ordering error
          # This happens when ToolMessage is not IMMEDIATELY after the AIMessage with tool_use
          elif "tool_use" in error_str and "tool_result" in error_str and "immediately after" in error_str:
              logging.error(f"❌ Bedrock tool_use ordering error: {error_str}")

              # Extract the problematic tool_use ID from error if possible
              import re
              id_match = re.search(r'tooluse_[A-Za-z0-9_-]+', error_str)
              problem_id = id_match.group(0) if id_match else "unknown"
              logging.error(f"Problematic tool_use ID: {problem_id}")

              # Aggressive fix: Remove ALL messages with orphaned tool_calls
              try:
                  from langchain_core.messages import RemoveMessage

                  state = await self.graph.aget_state(config)
                  messages = state.values.get("messages", []) if state and state.values else []

                  # Find all tool_call IDs and their resolutions
                  tool_call_to_msg = {}  # {tool_call_id: msg with that tool_call}
                  resolved = set()

                  for msg in messages:
                      if isinstance(msg, AIMessage):
                          tool_calls = getattr(msg, 'tool_calls', None) or []
                          for tc in tool_calls:
                              tc_id = tc.get('id') if isinstance(tc, dict) else getattr(tc, 'id', None)
                              if tc_id:
                                  tool_call_to_msg[tc_id] = msg
                      if isinstance(msg, ToolMessage):
                          tc_id = getattr(msg, 'tool_call_id', None)
                          if tc_id:
                              resolved.add(tc_id)

                  # Remove AIMessages with unresolved tool_calls
                  msgs_to_remove = []
                  for tc_id, msg in tool_call_to_msg.items():
                      if tc_id not in resolved:
                          msg_id = getattr(msg, 'id', None)
                          if msg_id:
                              msgs_to_remove.append(RemoveMessage(id=msg_id))
                              logging.info(f"Removing AIMessage with orphaned tool_call: {tc_id[:20]}...")

                  if msgs_to_remove:
                      await self.graph.aupdate_state(config, {"messages": msgs_to_remove})
                      logging.info(f"✅ Removed {len(msgs_to_remove)} AIMessages with orphaned tool_calls")

                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": (
                          "⚠️ A previous tool call failed and caused a message ordering issue. "
                          "I've cleaned up the conversation history.\n\n"
                          "Please ask your question again."
                      ),
                  }
                  return

              except Exception as cleanup_error:
                  logging.error(f"Failed to clean up orphaned tool_calls: {cleanup_error}")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "❌ Tool ordering error occurred. Please start a new conversation."
                  }
                  return

          # Check if it's a context overflow error
          elif "Input is too long" in error_str or "context" in error_str.lower():
              logging.error(f"❌ Context window overflow: {error_str}")

              # Try to summarize conversation history instead of clearing
              try:
                  state = await self.graph.aget_state(config)
                  messages = state.values.get("messages", []) if state and state.values else []

                  if messages:
                      # Use shared LangMem utility for consistent summarization
                      model = LLMFactory().get_llm()
                      result = await summarize_messages(
                          messages=messages,
                          model=model,
                          agent_name="supervisor",
                      )

                      if result.success and result.summary_message:
                          # Replace all messages with summary
                          await self.graph.aupdate_state(config, {"messages": [result.summary_message]})

                          logging.info(
                              f"✅ Summarized conversation history. "
                              f"LangMem used: {result.used_langmem}, "
                              f"tokens saved: {result.tokens_saved:,}"
                          )

                          recovery_msg = (
                              "❌ The conversation exceeded the model's context window. "
                              "I've summarized our conversation to recover.\n\n"
                              "Please continue - your previous context has been preserved in summary form."
                          )
                      else:
                          # Summarization failed, fall back to clearing
                          await self.graph.aupdate_state(config, {"messages": []})
                          logging.warning(f"⚠️ Summarization failed: {result.error}. Cleared history instead.")

                          recovery_msg = (
                              "❌ The conversation exceeded the model's context window. "
                              "I've cleared the history to recover.\n\n"
                              "**What happened:** The accumulated messages and tool outputs were too large for the model.\n\n"
                              "**To avoid this:** Try asking for smaller chunks of data or more specific queries.\n\n"
                              "Please ask your question again."
                          )
                  else:
                      recovery_msg = "❌ Context overflow occurred but no history to summarize. Please ask your question again."

              except Exception as recovery_error:
                  logging.error(f"Failed to recover from context overflow: {recovery_error}")
                  recovery_msg = "❌ Context overflow recovery failed. Please refresh and try again."

              yield {
                  "is_task_complete": False,
                  "require_user_input": False,
                  "content": recovery_msg,
              }
          elif "tool_calls" in error_str.lower() and "toolmessage" in error_str.lower():
              # Orphaned tool calls error - try to repair and retry, or fallback to raw output
              logging.warning(f"⚠️ Orphaned tool calls detected. Retry {synthesis_retry_count + 1}/{max_synthesis_retries}")

              if synthesis_retry_count < max_synthesis_retries:
                  synthesis_retry_count += 1
                  try:
                      # Try to repair orphaned tool calls
                      logging.info("🔧 Attempting to repair orphaned tool calls...")
                      await self._repair_orphaned_tool_calls(config)
                      logging.info("✅ Orphaned tool calls repaired. Retrying synthesis...")

                      # Don't return - fall through to try again
                      # Note: This won't actually retry in the current structure,
                      # but we can at least try to return the accumulated content
                  except Exception as repair_error:
                      logging.error(f"❌ Failed to repair orphaned tool calls: {repair_error}")

              # If we have accumulated sub-agent responses, return them as fallback
              if accumulated_subagent_responses:
                  logging.warning(f"📦 Synthesis failed. Returning {len(accumulated_subagent_responses)} accumulated sub-agent responses as fallback.")

                  # Format the raw sub-agent outputs
                  fallback_content = "⚠️ **Note:** The final synthesis timed out, but here are the results from the sub-agents:\n\n"
                  for tool_name, responses in accumulated_subagent_responses.items():
                      fallback_content += f"---\n\n### Results from {tool_name}:\n\n"
                      for resp in responses:
                          # Truncate very long responses
                          if len(resp) > 50000:
                              resp = resp[:50000] + "\n\n... [truncated due to length]"
                          fallback_content += f"{resp}\n\n"

                  fallback_content += "---\n\n⚠️ _The agent was unable to synthesize these results. Please review the raw output above._"

                  yield {
                      "is_task_complete": True,
                      "require_user_input": False,
                      "content": fallback_content,
                  }
              else:
                  # No accumulated responses - return error
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": f"❌ Synthesis failed: {error_str}\n\nNo sub-agent responses were captured. Please try again.",
                  }
          else:
              # Other validation errors
              error_msg = f"Validation error: {error_str}"
              logging.error(f"❌ {error_msg}")
              yield {
                  "is_task_complete": False,
                  "require_user_input": False,
                  "content": f"❌ Error: {error_msg}\n\nPlease try again or ask a follow-up question.",
              }

          # Don't yield completion event - keep queue open for follow-up questions
          return
      # Handle GraphInterrupt (HITL) specially - don't treat as a streaming failure
      except Exception as e:
          # Check if this is a GraphInterrupt (HITL form request)
          exception_type = type(e).__name__
          is_graph_interrupt = (
              "Interrupt" in exception_type or 
              (GraphInterrupt is not None and isinstance(e, GraphInterrupt))
          )
          
          if is_graph_interrupt:
              logging.info("🔄 GraphInterrupt caught in stream exception handler - propagating as HITL form")
              
              # Extract interrupt value from exception
              interrupt_value = None
              if hasattr(e, 'value'):
                  interrupt_value = e.value
              elif hasattr(e, 'args') and e.args:
                  first_arg = e.args[0]
                  if hasattr(first_arg, 'value'):
                      interrupt_value = first_arg.value
                  elif isinstance(first_arg, tuple) and len(first_arg) > 0:
                      first_intr = first_arg[0]
                      if hasattr(first_intr, 'value'):
                          interrupt_value = first_intr.value
                      elif isinstance(first_intr, dict):
                          interrupt_value = first_intr
                  elif isinstance(first_arg, dict):
                      interrupt_value = first_arg
              
              if interrupt_value:
                  logging.info(f"[Interrupt from exception] Extracted value type: {type(interrupt_value)}")
                  
                  # Extract action_requests
                  action_requests = []
                  if isinstance(interrupt_value, dict):
                      action_requests = interrupt_value.get("action_requests", [])
                      logging.info(f"[Interrupt from exception] Found {len(action_requests)} action_requests")
                  elif isinstance(interrupt_value, list):
                      action_requests = interrupt_value
                  
                  # Build tool_calls for the form
                  tool_calls = []
                  for action_req in action_requests:
                      try:
                          name = action_req.get("name", "CAIPEAgentResponse")
                          # HITL uses 'arguments', also check 'args' for compatibility
                          args = action_req.get("arguments", {}) or action_req.get("args", {})
                          tool_calls.append({
                              "name": name,
                              "args": args,
                              "id": action_req.get("id"),
                          })
                          logging.info(f"[Interrupt from exception] Parsed: name={name}, has_metadata={bool(args.get('metadata') if isinstance(args, dict) else False)}")
                      except Exception as parse_err:
                          logging.warning(f"Failed to parse action_request: {parse_err}")
                  
                  if tool_calls:
                      # Create synthetic AIMessage with tool_calls for form display
                      synth_msg = AIMessage(
                          content="Please provide the required information.",
                          tool_calls=tool_calls,
                      )
                      logging.info(f"[Interrupt from exception] Yielding form with {len(tool_calls)} tool_calls")
                      yield {
                          "event_type": "interrupt",
                          "message": synth_msg,
                          "is_task_complete": False,
                          "require_user_input": True,
                          "content": "",
                          "agent_type": "caipe",
                          "node_name": "caipe",
                      }
                      return
                  else:
                      logging.warning("[Interrupt from exception] No tool_calls extracted, cannot show form")
              else:
                  logging.warning(f"[Interrupt from exception] Could not extract interrupt value from: {e}")
              
              # If we couldn't extract the form data, fall through to error handling
          
          error_str = str(e)
          logging.warning(f"Token-level streaming failed, falling back to message-level: {e}")

          # Check if this is a timeout or orphaned tool call error that we can recover from
          is_timeout_error = "timed out" in error_str.lower() or "timeout" in error_str.lower()
          is_orphan_error = "tool_calls" in error_str.lower() and "toolmessage" in error_str.lower()

          # If we have accumulated sub-agent responses, return them as fallback
          if (is_timeout_error or is_orphan_error) and accumulated_subagent_responses:
              logging.warning(f"📦 Streaming failed with recoverable error. Returning {len(accumulated_subagent_responses)} accumulated sub-agent responses as fallback.")

              # Format the raw sub-agent outputs
              fallback_content = "⚠️ **Note:** The agent encountered a timeout, but here are the results from the sub-agents:\n\n"
              for tool_name, responses in accumulated_subagent_responses.items():
                  fallback_content += f"---\n\n### Results from {tool_name}:\n\n"
                  for resp in responses:
                      # Truncate very long responses
                      if len(resp) > 50000:
                          resp = resp[:50000] + "\n\n... [truncated due to length]"
                      fallback_content += f"{resp}\n\n"

              fallback_content += "---\n\n⚠️ _The agent was unable to synthesize these results due to timeout. Please review the raw output above._"

              yield {
                  "is_task_complete": True,
                  "require_user_input": False,
                  "content": fallback_content,
              }
              return

          # Signal to executor to clear accumulated content before fallback stream
          # This prevents duplication from partial content streamed before the exception
          yield {
              "is_task_complete": False,
              "require_user_input": False,
              "clear_accumulators": True,
              "content": "🔄 Switching to fallback streaming mode...",
          }
          
          # Wrap fallback streaming in try/except to catch GraphInterrupt
          try:
            async for item_type, item in self.graph.astream(inputs, config, stream_mode=['messages', 'custom', 'updates']):

              # Handle __interrupt__ events (HITL forms) in fallback streaming
              # When interrupt() is called, it yields an event with __interrupt__ key
              if isinstance(item, dict) and "__interrupt__" in item:
                  logging.info(f"[Fallback] __interrupt__ event received: {item}")
                  intr_obj = item.get("__interrupt__")
                  intr = intr_obj[0] if isinstance(intr_obj, (list, tuple)) and intr_obj else intr_obj
                  
                  # Extract the interrupt value (HITL request data)
                  intr_value = getattr(intr, "value", None)
                  if intr_value is None and isinstance(intr, dict):
                      intr_value = intr
                  
                  logging.info(f"[Fallback Interrupt] Extracted value: {type(intr_value)}")
                  
                  # Extract action_requests
                  action_requests = []
                  if isinstance(intr_value, dict):
                      action_requests = intr_value.get("action_requests", [])
                      logging.info(f"[Fallback Interrupt] Found {len(action_requests)} action_requests, keys: {list(intr_value.keys())}")
                  elif isinstance(intr_value, list):
                      action_requests = intr_value
                  
                  # Build tool_calls for the form
                  tool_calls = []
                  for action_req in action_requests:
                      try:
                          logging.info(f"[Fallback Interrupt] Processing action_req: {json.dumps(action_req, default=str)[:500]}")
                          name = action_req.get("name", "CAIPEAgentResponse")
                          # HITL uses 'arguments', also check 'args' for compatibility
                          args = action_req.get("arguments", {}) or action_req.get("args", {})
                          tool_calls.append({
                              "name": name,
                              "args": args,
                              "id": action_req.get("id"),
                          })
                          logging.info(f"[Fallback Interrupt] Parsed: name={name}, has_metadata={bool(args.get('metadata') if isinstance(args, dict) else False)}")
                      except Exception as parse_err:
                          logging.warning(f"[Fallback Interrupt] Failed to parse action_request: {parse_err}")
                  
                  if tool_calls:
                      # Create synthetic AIMessage with tool_calls for form display
                      synth_msg = AIMessage(
                          content="Please provide the required information.",
                          tool_calls=tool_calls,
                      )
                      logging.info(f"[Fallback Interrupt] Yielding form with {len(tool_calls)} tool_calls")
                      yield {
                          "event_type": "interrupt",
                          "message": synth_msg,
                          "is_task_complete": False,
                          "require_user_input": True,
                          "content": "",
                          "agent_type": "caipe",
                          "node_name": "caipe",
                      }
                      return
                  else:
                      logging.warning("[Fallback Interrupt] No tool_calls extracted from interrupt")
                  continue

              # ── Track todo state changes from updates stream (fallback) ──
              if item_type == 'updates' and isinstance(item, dict):
                  todos_lists = []
                  for key, value in item.items():
                      if key == 'todos' and isinstance(value, list):
                          todos_lists.append(value)
                      elif isinstance(value, dict):
                          node_todos = value.get('todos')
                          if node_todos and isinstance(node_todos, list):
                              todos_lists.append(node_todos)

                  for todos_list in todos_lists:
                      for todo in todos_list:
                          if not isinstance(todo, dict):
                              continue
                          todo_id = todo.get("id")
                          new_status = todo.get("status", "pending")
                          old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                          todo_content = todo.get("content", f"Step {todo_id}")

                          if old_status != new_status:
                              if new_status == "in_progress":
                                  logging.info(f"📋 Task started (fallback updates): {todo_content}")
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
                                  logging.info(f"✅ Task completed (fallback updates): {todo_content}")
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
                  continue

              # Handle custom A2A event payloads emitted via get_stream_writer()
              if item_type == 'custom' and isinstance(item, dict):
                  if item.get("type") == "a2a_event":
                      event_obj = self._deserialize_a2a_event(item.get("data"))
                      if event_obj is not None:
                          yield event_obj
                          continue
                      else:
                          logging.warning("Supervisor: Received a2a_event but failed to deserialize; ignoring.")
                  elif item.get("type") == "human_prompt":
                      prompt_text = item.get("prompt", "")
                      options = item.get("options", [])
                      yield {
                          "is_task_complete": False,
                          "require_user_input": True,
                          "content": prompt_text,
                          "metadata": {"options": options} if options else {},
                      }
                      continue
                  elif item.get("type") == "artifact-update":
                      logging.debug("Received artifact-update custom event from sub-agent (fallback), forwarding")
                      yield item
                      continue

              # Extract message from messages stream
              if item_type == 'messages':
                message = item[0]
              elif isinstance(item, dict) and 'generate_structured_response' in item:
                yield self.handle_structured_response(item['generate_structured_response']['structured_response'])
                continue
              else:
                continue  # Skip unrecognized event types

              if (
                  isinstance(message, AIMessage)
                  and getattr(message, "tool_calls", None)
                  and len(message.tool_calls) > 0
              ):
                  # Check for write_todos and task calls — emit task lifecycle notifications
                  for tool_call in message.tool_calls:
                      tc_name = tool_call.get("name", "")
                      if tc_name == "task":
                          task_args = tool_call.get("args", {})
                          subagent_type = task_args.get("subagent_type", "general-purpose")
                          task_desc = task_args.get("description", "Processing task")
                          display_desc = task_desc[:120].strip()
                          if len(task_desc) > 120:
                              display_desc += "..."
                          tc_id = tool_call.get("id", "")
                          self._task_plan_entries[tc_id] = {
                              "subagent": subagent_type,
                              "description": display_desc,
                              "status": "in_progress",
                          }
                          plan_text = self._build_todo_plan_text() if self._previous_todos else self._build_task_plan_text()
                          artifact_name = "execution_plan_update" if not self._execution_plan_sent else "execution_plan_status_update"
                          self._execution_plan_sent = True
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "artifact": {
                                  "name": artifact_name,
                                  "description": "Execution plan from subagent delegation",
                                  "text": plan_text,
                              }
                          }
                      elif tc_name == "write_todos":
                          fb_todos = tool_call.get("args", {}).get("todos", [])
                          for todo in fb_todos:
                              todo_id = todo.get("id")
                              new_status = todo.get("status", "pending")
                              old_status = self._previous_todos.get(todo_id, {}).get("status", "pending")
                              todo_content = todo.get("content", f"Step {todo_id}")

                              if old_status != new_status:
                                  if new_status == "in_progress":
                                      logging.info(f"📋 Task started (fallback messages): {todo_content}")
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
                                      logging.info(f"✅ Task completed (fallback messages): {todo_content}")
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

                  logging.debug("Detected AIMessage with tool calls, yielding")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "",
                  }
              elif isinstance(message, ToolMessage):
                  # Stream ToolMessage content (includes formatted TODO lists)
                  tool_content = message.content if hasattr(message, 'content') else ""
                  # Normalize tool_content to string (Bedrock returns list, OpenAI returns string)
                  if isinstance(tool_content, list):
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
                  logging.debug(f"Detected ToolMessage with {len(tool_content)} chars, yielding")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": tool_content if tool_content else "",
                  }
              elif isinstance(message, AIMessageChunk):
                  # Normalize content to string (AWS Bedrock returns list, OpenAI returns string)
                  content = message.content
                  if isinstance(content, list):
                      # If content is a list (AWS Bedrock), extract text from content blocks
                      text_parts = []
                      for item in content:
                          if isinstance(item, dict):
                              # Extract text from Bedrock content block: {"type": "text", "text": "..."}
                              text_parts.append(item.get('text', ''))
                          elif isinstance(item, str):
                              text_parts.append(item)
                          else:
                              text_parts.append(str(item))
                      content = ''.join(text_parts)
                  elif not isinstance(content, str):
                      content = str(content) if content else ''

                  # Accumulate content for final parsing
                  if content:
                      accumulated_ai_content.append(content)

                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": content,
                  }
              elif isinstance(message, AIMessage):
                  # Final complete AIMessage (not a chunk) from fallback stream
                  # Store it for parsing after stream ends
                  logging.info(f"🎯 CAPTURED final AIMessage from fallback stream: type={type(message).__name__}, has_content={hasattr(message, 'content')}")
                  if hasattr(message, 'content'):
                      content_preview = str(message.content)[:200]
                      logging.info(f"🎯 AIMessage content preview: {content_preview}...")
                      accumulated_ai_content.append(str(message.content))
                  final_ai_message = message
          except Exception as fallback_ex:
              # Handle GraphInterrupt from fallback streaming (HITL form request)
              exception_type = type(fallback_ex).__name__
              is_graph_interrupt = (
                  "Interrupt" in exception_type or 
                  (GraphInterrupt is not None and isinstance(fallback_ex, GraphInterrupt))
              )
              
              if is_graph_interrupt:
                  logging.info("🔄 GraphInterrupt caught in FALLBACK stream - propagating as HITL form")
                  
                  # Extract interrupt value from exception
                  interrupt_value = None
                  if hasattr(fallback_ex, 'value'):
                      interrupt_value = fallback_ex.value
                  elif hasattr(fallback_ex, 'args') and fallback_ex.args:
                      first_arg = fallback_ex.args[0]
                      if hasattr(first_arg, 'value'):
                          interrupt_value = first_arg.value
                      elif isinstance(first_arg, tuple) and len(first_arg) > 0:
                          first_intr = first_arg[0]
                          if hasattr(first_intr, 'value'):
                              interrupt_value = first_intr.value
                          elif isinstance(first_intr, dict):
                              interrupt_value = first_intr
                      elif isinstance(first_arg, dict):
                          interrupt_value = first_arg
                  
                  if interrupt_value:
                      logging.info(f"[Fallback Interrupt] Extracted value type: {type(interrupt_value)}")
                      
                      # Extract action_requests
                      action_requests = []
                      if isinstance(interrupt_value, dict):
                          action_requests = interrupt_value.get("action_requests", [])
                          logging.info(f"[Fallback Interrupt] Found {len(action_requests)} action_requests")
                      elif isinstance(interrupt_value, list):
                          action_requests = interrupt_value
                      
                      # Build tool_calls for the form
                      tool_calls = []
                      for action_req in action_requests:
                          try:
                              name = action_req.get("name", "CAIPEAgentResponse")
                              # HITL uses 'arguments', also check 'args' for compatibility
                              args = action_req.get("arguments", {}) or action_req.get("args", {})
                              tool_calls.append({
                                  "name": name,
                                  "args": args,
                                  "id": action_req.get("id"),
                              })
                              logging.info(f"[Fallback Interrupt] Parsed: name={name}, has_metadata={bool(args.get('metadata') if isinstance(args, dict) else False)}")
                          except Exception as parse_err:
                              logging.warning(f"Failed to parse action_request in fallback: {parse_err}")
                      
                      if tool_calls:
                          # Create synthetic AIMessage with tool_calls for form display
                          synth_msg = AIMessage(
                              content="Please provide the required information.",
                              tool_calls=tool_calls,
                          )
                          logging.info(f"[Fallback Interrupt] Yielding form with {len(tool_calls)} tool_calls")
                          yield {
                              "event_type": "interrupt",
                              "message": synth_msg,
                              "is_task_complete": False,
                              "require_user_input": True,
                              "content": "",
                              "agent_type": "caipe",
                              "node_name": "caipe",
                          }
                          return
                      else:
                          logging.warning("[Fallback Interrupt] No tool_calls extracted, cannot show form")
                  else:
                      logging.warning(f"[Fallback Interrupt] Could not extract interrupt value from: {fallback_ex}")
              else:
                  # Re-raise non-interrupt exceptions
                  logging.error(f"Fallback streaming failed with non-interrupt exception: {fallback_ex}")
                  raise

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

      # After EITHER primary or fallback streaming completes, parse the final response to extract is_task_complete
      logging.info(f"🔍 POST-STREAM PARSING: final_ai_message={final_ai_message is not None}, accumulated_chunks={len(accumulated_ai_content)}")

      # Try to use final_ai_message first, otherwise use accumulated content
      if final_ai_message:
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

      # Yield the final parsed response with correct is_task_complete
      #
      # FIX #2 for A2A Streaming Duplication (Safety Net):
      # ------------------------------------------------
      # Even after Fix #1, the final_response may still contain 'content' that was parsed
      # from the accumulated chunks. When len(accumulated_ai_content) > 1, we know we're in
      # streaming mode where content was already sent token-by-token to the client.
      # Sending it again in the final response would cause duplication.
      #
      # Solution: Clear 'content' from final_response when in streaming mode.
      if accumulated_ai_content and len(accumulated_ai_content) > 1:
          logging.info(f"⏭️ Clearing content from final response - already streamed {len(accumulated_ai_content)} chunks")
          final_response['content'] = ''

      logging.info(f"🚀 YIELDING FINAL RESPONSE: is_task_complete={final_response.get('is_task_complete')}, require_user_input={final_response.get('require_user_input')}, content_length={len(final_response.get('content', ''))}")
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

      # If content doesn't look like JSON, treat it as a working text update
      if not (content.startswith('{') or content.startswith('[')):
        # Check if content contains [FINAL ANSWER] marker indicating task completion
        is_final = '[FINAL ANSWER]' in content or '[FINAL_ANSWER]' in content
        if is_final:
          logging.info("Content contains [FINAL ANSWER] marker; returning completed structured response.")
        else:
          logging.info("Content appears to be plain text; returning working structured response.")
        return {
          'is_task_complete': is_final,
          'require_user_input': False,
          'content': content,
        }

      # Attempt to parse JSON
      response_dict = json.loads(content)
      if isinstance(response_dict, dict):
        logging.info("Successfully parsed JSON response (fallback)")
        return response_dict
      else:
        logging.warning("Parsed JSON is not a dictionary; returning working structured response with text content.")
        return {
          'is_task_complete': False,
          'require_user_input': False,
          'content': content,
        }
    except json.JSONDecodeError as e:
      logging.warning(f"Failed to decode content as JSON, returning working structured response: {e}")
      logging.warning(f"Content that failed to parse: {repr(content)}")
      # Check if content contains [FINAL ANSWER] marker indicating task completion
      is_final = '[FINAL ANSWER]' in content or '[FINAL_ANSWER]' in content
      return {
        'is_task_complete': is_final,
        'require_user_input': False,
        'content': content,
      }
