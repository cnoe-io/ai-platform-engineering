# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import json
import logging
import os
import re
from collections.abc import AsyncIterable
from typing import Any

# A2A tracing is disabled via cnoe-agent-utils disable_a2a_tracing() in main.py
from a2a.types import (
    Message as A2AMessage,
    Task as A2ATask,
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
)
from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    AIPlatformEngineerMAS,
    USE_STRUCTURED_RESPONSE,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from ai_platform_engineering.utils.a2a_common.langmem_utils import (
    summarize_messages,
    preflight_context_check,
    _extract_tool_call_ids,
)
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

_log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, _log_level, logging.INFO), format='%(asctime)s - %(levelname)s - %(message)s')


class AIPlatformEngineerA2ABinding:
  """
  AI Platform Engineer Multi-Agent System (MAS) for currency conversion.
  """

  SYSTEM_INSTRUCTION = system_prompt

  def __init__(self):
      self.graph = AIPlatformEngineerMAS().get_graph()
      self.tracing = TracingManager()
      self._execution_plan_sent = False

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
      - LangMem summarization removes ToolMessages but leaves AIMessages
        with tool_use data in additional_kwargs (Bedrock-specific)

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
              logging.debug(
                  f"No orphaned tool calls found. "
                  f"Tracked {len(tool_calls_info)} tool_call IDs, "
                  f"{len(resolved_tool_calls)} resolved. "
                  f"Message types: {[type(m).__name__ for m in messages]}"
              )
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

  @trace_agent_stream("platform_engineer", update_input=True)
  async def stream(self, query, context_id, trace_id=None, user_id=None) -> AsyncIterable[dict[str, Any]]:
      # user_email is passed via _pending_user_email to avoid the
      # trace_agent_stream decorator stripping unknown kwargs.
      user_email = getattr(self, '_pending_user_email', None)
      self._pending_user_email = None
      logging.debug(f"Starting stream with query: {query}, context_id: {context_id}, trace_id: {trace_id}, user_email: {user_email}")
      # Reset execution plan state for each new stream
      self._execution_plan_sent = False

      # Track tool calls to ensure every AIMessage.tool_call gets a ToolMessage
      pending_tool_calls = {}  # {tool_call_id: tool_name}

      inputs = {'messages': [('user', query)]}
      config = self.tracing.create_config(context_id)

      # Ensure metadata exists in config for tools to access
      if 'metadata' not in config:
          config['metadata'] = {}

      # Add context_id to metadata so tools can maintain conversation continuity
      if context_id:
          config['metadata']['context_id'] = context_id
          logging.info(f"Added context_id to config metadata: {context_id}")

      # Add user_email to metadata so sub-agent tools can forward it
      if user_email:
          config['metadata']['user_email'] = user_email
          logging.info(f"Added user_email to config metadata: {user_email}")

      # Add user_id to metadata for cross-thread memory scoping
      if user_id:
          config['metadata']['user_id'] = user_id
          logging.info(f"Added user_id to config metadata: {user_id}")

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
      # CROSS-THREAD MEMORY: Retrieve prior context for new conversations
      # ========================================================================
      graph_store = getattr(self.graph, 'store', None)
      try:
          if graph_store and user_id:
              state = await self.graph.aget_state(config)
              is_new_thread = not state or not state.values or not state.values.get("messages")
              if is_new_thread:
                  from ai_platform_engineering.utils.store import store_get_cross_thread_context
                  cross_thread_ctx = await store_get_cross_thread_context(
                      store=graph_store,
                      user_id=user_id,
                  )
                  if cross_thread_ctx:
                      from langchain_core.messages import SystemMessage
                      inputs['messages'].insert(
                          0, SystemMessage(content=cross_thread_ctx)
                      )
                      logging.info(
                          f"Injected cross-thread context for user={user_id} "
                          f"({len(cross_thread_ctx)} chars)"
                      )
      except Exception as ctx_err:
          logging.debug(f"Cross-thread context retrieval skipped: {ctx_err}")

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
              store=graph_store,
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

      # ============ TEMPORARY: context overflow test ============
      # Inject ~180k tokens of dummy content so the next LLM call overflows.
      # Remove this block after testing.
      _TEST_CONTEXT_OVERFLOW = os.getenv("TEST_CONTEXT_OVERFLOW", "").lower() == "true"
      if _TEST_CONTEXT_OVERFLOW:
          logging.warning("TEST_CONTEXT_OVERFLOW enabled -- injecting ~180k tokens of padding")
          _pad = "x " * 30000  # ~30k tokens per message
          _num_blocks = 6
          _dummy_msgs = []
          for i in range(_num_blocks):
              _dummy_msgs.append(ToolMessage(
                  content=f"[test padding block {i+1}/{_num_blocks}] {_pad}",
                  tool_call_id=f"test_overflow_{i}",
                  name="test_padding",
              ))
          _dummy_ai = AIMessage(content="I will analyze these results.", tool_calls=[
              {"name": "test_padding", "args": {}, "id": f"test_overflow_{i}"}
              for i in range(_num_blocks)
          ])
          await self.graph.aupdate_state(config, {"messages": [_dummy_ai] + _dummy_msgs})
          logging.warning(f"Injected {_num_blocks} dummy messages (~{_num_blocks * 30}k tokens)")
      # ============ END TEMPORARY ============

      try:
          # Track accumulated AI message content for final parsing
          accumulated_ai_content = []
          final_ai_message = None

          # Track ResponseFormat tool call for structured response mode
          response_format_content = None
          response_format_args = None  # Complete tool args when captured
          response_format_streaming = False  # True when we're streaming ResponseFormat args

          # Track current active agent for sub-agent message grouping
          # This is used by the executor to add sourceAgent metadata to artifacts
          current_agent: str | None = None

          # Check if token-by-token streaming is enabled (default: true)
          # When disabled, uses 'values' mode which waits for complete messages
          enable_streaming = os.getenv("ENABLE_STREAMING", "true").lower() == "true"

          if enable_streaming:
              # Use astream with multiple stream modes to get both token-level streaming AND custom events
              # stream_mode=['messages', 'custom'] enables:
              # - 'messages': Token-level streaming via AIMessageChunk
              # - 'custom': Custom events from sub-agents via get_stream_writer()
              stream_mode = ['messages', 'custom']
              logging.info("Supervisor: Token-by-token streaming ENABLED")
          else:
              # Use values mode for complete messages (better spacing, less responsive)
              stream_mode = ['values', 'custom']
              logging.info("Supervisor: Token-by-token streaming DISABLED, using full message mode")

          async for item_type, item in self.graph.astream(inputs, config, stream_mode=stream_mode):

              # Handle custom A2A event payloads from sub-agents
              if item_type == 'custom' and isinstance(item, dict):
                  # Handle different custom event types
                  if item.get("type") == "a2a_event":
                      # Legacy a2a_event format (text-based)
                      custom_text = item.get("data", "")
                      if custom_text:
                          logging.debug(f"Processing custom a2a_event from sub-agent: {len(custom_text)} chars")
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": custom_text,
                          }
                      continue
                  elif item.get("type") == "human_prompt":
                      prompt_text = item.get("prompt", "")
                      options = item.get("options", [])
                      logging.debug("Received human-in-the-loop prompt from sub-agent")
                      yield {
                          "is_task_complete": False,
                          "require_user_input": True,
                          "content": prompt_text,
                          "metadata": {"options": options} if options else {},
                      }
                      continue
                  elif item.get("type") == "artifact-update":
                      # New artifact-update format from sub-agents (full A2A event)
                      # Yield the entire event dict for the executor to handle
                      logging.debug("Received artifact-update custom event from sub-agent, forwarding to executor")
                      yield item
                      continue

              # Process message stream
              if item_type != 'messages':
                  continue

              message = item[0] if item else None
              if not message:
                  continue

              # Check if this message has tool_calls (can be in AIMessageChunk or AIMessage)
              has_tool_calls = hasattr(message, "tool_calls") and message.tool_calls
              if has_tool_calls:
                  logging.debug(f"Message with tool_calls detected: type={type(message).__name__}, tool_calls={message.tool_calls}")

              # BEDROCK STREAMING: Accumulate tool args from tool_call_chunks
              # Bedrock streams tool args as partial JSON strings in tool_call_chunks[].args
              if hasattr(message, "tool_call_chunks") and message.tool_call_chunks:
                  for chunk in message.tool_call_chunks:
                      chunk_name = chunk.get("name", "")
                      chunk_args = chunk.get("args", "")

                      # If this chunk has the tool name, track that we're in a ResponseFormat call
                      if chunk_name and chunk_name.lower() in ('responseformat', 'platformengineerresponse'):
                          response_format_streaming = True
                          if response_format_args is None:
                              response_format_args = {"_partial_json": ""}
                          logging.info("🎯 BEDROCK: ResponseFormat tool streaming started")

                      # Accumulate args string (Bedrock streams JSON incrementally)
                      # Once we're streaming ResponseFormat, accumulate all args chunks
                      if chunk_args and response_format_streaming:
                          if response_format_args is None:
                              response_format_args = {"_partial_json": ""}
                          if "_partial_json" not in response_format_args:
                              response_format_args["_partial_json"] = ""
                          response_format_args["_partial_json"] += chunk_args

              # Stream LLM tokens (includes execution plans and responses)
              if isinstance(message, AIMessageChunk):
                  # BEDROCK DEBUG: Check additional_kwargs for tool use data
                  if hasattr(message, "additional_kwargs") and message.additional_kwargs:
                      add_kwargs = message.additional_kwargs
                      if "tool_use" in add_kwargs or "toolUse" in add_kwargs:
                          tool_use_data = add_kwargs.get("tool_use") or add_kwargs.get("toolUse")
                          logging.info(f"🔍 BEDROCK: Found tool_use in additional_kwargs: {str(tool_use_data)[:500]}")

                  # Check if this chunk has tool_calls (tool invocation)
                  if has_tool_calls:
                      # This is a tool call chunk - emit tool start notifications
                      for tool_call in message.tool_calls:
                          tool_name = tool_call.get("name", "")
                          # Skip tool calls with empty names (they're partial chunks being streamed)
                          if not tool_name or not tool_name.strip():
                              logging.debug("Skipping tool call with empty name (streaming chunk)")
                              continue

                          # Track current agent for sub-agent message grouping
                          current_agent = tool_name
                          logging.debug(f"Tool call started (from AIMessageChunk): {tool_name}")

                          # Agent returned the final structured response
                          if tool_name.lower() in ('responseformat', 'platformengineerresponse'):
                            tool_args = tool_call.get("args", {})

                            # CRITICAL: Always accumulate/update tool args as they stream in
                            # Bedrock streams tool args incrementally, so we keep the latest version
                            if tool_args:
                                # Merge new args into existing (in case they're incremental)
                                if response_format_args is None:
                                    response_format_args = {}
                                response_format_args.update(tool_args)
                                logging.info(f"📝 AIMessageChunk: Updated ResponseFormat args, keys={list(response_format_args.keys())}")

                            # Extract 'content' field which contains the actual response
                            structured_content = tool_args.get("content", "") or tool_args.get("message", "") or tool_args.get("response", "")
                            if structured_content:
                                response_format_content = structured_content
                                logging.info(f"📝 SUPERVISOR AIMessageChunk: Captured ResponseFormat content: {len(response_format_content)} chars")

                                # When structured response mode is enabled, yield completion event directly
                                if USE_STRUCTURED_RESPONSE:
                                    logging.info("🎯 Structured response mode: yielding completion from AIMessageChunk ResponseFormat tool")
                                    yield {
                                        "is_task_complete": tool_args.get("is_task_complete", True),
                                        "require_user_input": tool_args.get("require_user_input", False),
                                        "content": structured_content,
                                        "metadata": tool_args.get("metadata"),
                                        "from_response_format_tool": True
                                    }
                                    continue  # Skip tool notification, already handled
                            else:
                                # Args are empty or content not yet available - in structured response mode,
                                # skip and wait for complete args (they'll be captured in response_format_args)
                                if USE_STRUCTURED_RESPONSE:
                                    logging.debug(f"📝 Structured response mode: ResponseFormat content empty, waiting (accumulated args keys: {list(response_format_args.keys()) if response_format_args else 'none'})")
                                    continue  # Skip notification, wait for complete tool call

                          # Stream tool start notification to client with metadata
                          # But ONLY if we haven't already yielded the completion
                          if not (USE_STRUCTURED_RESPONSE and response_format_content):
                              tool_name_formatted = tool_name.title()
                              yield {
                                  "is_task_complete": False,
                                  "require_user_input": False,
                                  "content": f"🔧 Supervisor: Calling Agent {tool_name_formatted}...\n",
                                  "source_agent": tool_name,
                                  "tool_call": {
                                      "name": tool_name,
                                      "status": "started",
                                      "type": "notification"
                                  }
                              }

                      # CRITICAL: Before skipping content processing, check for tool_use blocks in content
                      # Bedrock puts complete tool args in content[].input, not in tool_calls[].args during streaming
                      msg_content = message.content
                      if isinstance(msg_content, list):
                          for item in msg_content:
                              if isinstance(item, dict) and item.get('type') == 'tool_use':
                                  tool_name = item.get('name', '')
                                  tool_input = item.get('input', {})
                                  if tool_name.lower() in ('responseformat', 'platformengineerresponse') and tool_input:
                                      logging.info(f"🎯 AIMessageChunk: Found tool_use in content! tool={tool_name}, input_keys={list(tool_input.keys())}")
                                      response_format_args = tool_input
                                      response_format_content = tool_input.get("content", "") or tool_input.get("message", "")
                                      if response_format_content and USE_STRUCTURED_RESPONSE:
                                          logging.info(f"🎯 AIMessageChunk: Yielding completion from tool_use block ({len(response_format_content)} chars)")
                                          yield {
                                              "is_task_complete": tool_input.get("is_task_complete", True),
                                              "require_user_input": tool_input.get("require_user_input", False),
                                              "content": response_format_content,
                                              "metadata": tool_input.get("metadata"),
                                              "from_response_format_tool": True
                                          }
                      continue

                  content = message.content
                  # Normalize content (handle both string and list formats)
                  if isinstance(content, list):
                      text_parts = []
                      for item in content:
                          if isinstance(item, dict):
                              # CRITICAL: Check for tool_use blocks in content (Bedrock format)
                              # This is where Bedrock puts the complete tool args!
                              item_type = item.get('type', '')
                              if item_type == 'tool_use':
                                  tool_name = item.get('name', '')
                                  tool_input = item.get('input', {})
                                  if tool_name.lower() in ('responseformat', 'platformengineerresponse') and tool_input:
                                      logging.info(f"🎯 BEDROCK: Found tool_use in content! tool={tool_name}, input_keys={list(tool_input.keys())}")
                                      response_format_args = tool_input
                                      response_format_content = tool_input.get("content", "") or tool_input.get("message", "")
                                      if response_format_content and USE_STRUCTURED_RESPONSE:
                                          logging.info(f"🎯 BEDROCK: Yielding completion from content tool_use block ({len(response_format_content)} chars)")
                                          yield {
                                              "is_task_complete": tool_input.get("is_task_complete", True),
                                              "require_user_input": tool_input.get("require_user_input", False),
                                              "content": response_format_content,
                                              "metadata": tool_input.get("metadata"),
                                              "from_response_format_tool": True
                                          }
                                          continue  # Skip normal content processing
                              else:
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
                      querying_pattern = r'🔍\s+Querying\s+(\w+)\s+for\s+([^.]+?)\.\.\.'
                      match = re.search(querying_pattern, content)

                      if match:
                          agent_name = match.group(1)
                          purpose = match.group(2)
                          current_agent = agent_name.lower()  # Update current agent
                          logging.debug(f"Tool update detected: {agent_name} - {purpose}")
                          # Emit as tool_update event
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": content,
                              "source_agent": current_agent,
                              "tool_update": {
                                  "name": agent_name.lower(),
                                  "purpose": purpose,
                                  "status": "querying",
                                  "type": "update"
                              }
                          }
                      else:
                          # Regular content - include source_agent for grouping
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": content,
                              "source_agent": current_agent or "supervisor",
                          }

              # Handle AIMessage with tool calls (tool start indicators)
              elif isinstance(message, AIMessage) and has_tool_calls:
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

                      # Track current agent for sub-agent message grouping
                      current_agent = tool_name
                      logging.info(f"Tool call started: {tool_name}")

                      # CRITICAL: Capture ResponseFormat content from AIMessage
                      # This is the DETERMINISTIC way to get the final response
                      # ResponseFormat tool contains the structured final output
                      # Note: Tool is defined as @tool("ResponseFormat") but Bedrock returns the schema name "PlatformEngineerResponse"
                      if tool_name.lower() in ('responseformat', 'platformengineerresponse'):
                          tool_args = tool_call.get("args", {})
                          logging.info(f"🎯 AIMessage ResponseFormat detected! tool_name={tool_name}, args_keys={list(tool_args.keys()) if tool_args else 'empty'}")
                          # Extract 'content' or 'message' field which contains the actual response
                          structured_content = tool_args.get("content", "") or tool_args.get("message", "") or tool_args.get("response", "")
                          if structured_content:
                              response_format_content = structured_content
                              response_format_args = tool_args  # Save complete args for final yield
                              logging.info(f"🎯 AIMessage ResponseFormat: Captured content ({len(response_format_content)} chars)")
                              logging.info(f"🎯 AIMessage ResponseFormat content preview: {response_format_content[:300]}")

                              # When structured response mode is enabled, yield completion event directly
                              if USE_STRUCTURED_RESPONSE:
                                  logging.info("🎯 Structured response mode: yielding completion from AIMessage ResponseFormat tool")
                                  yield {
                                      "is_task_complete": tool_args.get("is_task_complete", True),
                                      "require_user_input": tool_args.get("require_user_input", False),
                                      "content": structured_content,
                                      "metadata": tool_args.get("metadata"),
                                      "from_response_format_tool": True
                                  }
                                  continue  # Skip tool notification, already handled
                          else:
                              # Fallback: try to get any string value from args
                              for key, val in tool_args.items():
                                  if isinstance(val, str) and len(val) > 10:
                                      response_format_content = val
                                      response_format_args = tool_args  # Save args
                                      logging.info(f"📝 SUPERVISOR: Captured ResponseFormat '{key}' field: {len(response_format_content)} chars")
                                      break
                              if not response_format_content and tool_args:
                                  try:
                                      response_format_content = json.dumps(tool_args)
                                      response_format_args = tool_args  # Save args
                                      logging.info(f"📝 SUPERVISOR: Captured ResponseFormat args as JSON: {len(response_format_content)} chars")
                                  except Exception:
                                      response_format_content = str(tool_args)
                                      response_format_args = tool_args  # Save args

                      # Stream tool start notification to client with metadata
                      tool_name_formatted = tool_name.title()
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "content": f"🔧 Supervisor: Calling Agent {tool_name_formatted}...\n",
                          "source_agent": tool_name,
                          "tool_call": {
                              "name": tool_name,
                              "status": "started",
                              "type": "notification"
                          }
                      }

              # Handle ToolMessage (tool completion indicators + content)
              elif isinstance(message, ToolMessage):
                  tool_name = message.name if hasattr(message, 'name') else "unknown"
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
                  tool_call_id = message.tool_call_id if hasattr(message, 'tool_call_id') else None
                  if tool_call_id and tool_call_id in pending_tool_calls:
                      pending_tool_calls.pop(tool_call_id)
                      logging.debug(f"Resolved tool call: {tool_call_id} -> {tool_name}")


                  # This is a hard-coded list for now
                  # TODO: Fetch the rag tool names from when the deep agent is initialised
                  rag_tool_names = {
                      'search', 'fetch_document', 'fetch_datasources_and_entity_types',
                      'graph_explore_ontology_entity', 'graph_explore_data_entity',
                      'graph_fetch_data_entity_details', 'graph_shortest_path_between_entity_types',
                      'graph_raw_query_data', 'graph_raw_query_ontology'
                  }

                  # CRITICAL: Handle ResponseFormat tool in structured response mode
                  # The tool returns JSON with the structured response fields
                  if USE_STRUCTURED_RESPONSE and tool_name.lower() in ('responseformat', 'platformengineerresponse'):
                      try:
                          # Parse the JSON result from the tool
                          tool_result = json.loads(tool_content) if tool_content else {}
                          structured_content = tool_result.get("content", "") or tool_result.get("message", "") or tool_result.get("response", "")
                          if structured_content:
                              # Save for final yield fallback
                              response_format_args = tool_result
                              response_format_content = structured_content
                              is_task_complete_val = tool_result.get("is_task_complete", True)
                              require_user_input_val = tool_result.get("require_user_input", False)
                              yield {
                                  "is_task_complete": is_task_complete_val,
                                  "require_user_input": require_user_input_val,
                                  "content": structured_content,
                                  "metadata": tool_result.get("metadata"),
                                  "from_response_format_tool": True
                              }
                              continue  # Skip normal tool completion handling
                          else:
                              logging.warning(f"ResponseFormat tool result has no content: {tool_result}")
                      except json.JSONDecodeError as e:
                          logging.warning(f"Failed to parse ResponseFormat result as JSON: {e}, content was: {tool_content[:200] if tool_content else 'EMPTY'}")
                          # Fall through to normal handling

                  # Special handling for write_todos: execution plan vs status updates
                  if tool_name == "write_todos" and tool_content and tool_content.strip():
                      if not self._execution_plan_sent:
                          self._execution_plan_sent = True
                          logging.debug("📋 Emitting initial TODO list as execution_plan_update artifact")
                          # Emit as execution plan artifact for client display in execution plan pane
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "source_agent": "supervisor",
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
                              "source_agent": "supervisor",
                              "artifact": {
                                  "name": "execution_plan_status_update",
                                  "description": "TODO progress update",
                                  "text": tool_content
                              }
                          }
                  # Special handling for request_user_input: emit structured form metadata
                  elif tool_name == "request_user_input" and tool_content:
                      logging.info("📝 Intercepting request_user_input tool - emitting structured form")
                      try:
                          # Parse the tool output which contains structured field data
                          tool_result = json.loads(tool_content)
                          fields = tool_result.get("fields", [])
                          title = tool_result.get("title", "User Input Required")
                          description = tool_result.get("description", "Please provide the following information")

                          # Convert to the metadata.input_fields format expected by frontend
                          input_fields = []
                          for field in fields:
                              input_fields.append({
                                  "field_name": field.get("field_name", ""),
                                  "field_label": field.get("field_label", field.get("field_name", "")),
                                  "field_description": field.get("field_description", ""),
                                  "field_type": field.get("field_type", "text"),
                                  "field_values": field.get("field_values"),
                                  "placeholder": field.get("placeholder"),
                                  "required": field.get("required", True),
                                  "default_value": field.get("default_value"),
                              })

                          logging.info(f"📝 Emitting user input form: {title} with {len(input_fields)} fields")

                          # Yield structured user input request
                          yield {
                              "is_task_complete": False,
                              "require_user_input": True,
                              "content": f"**{title}**\n\n{description}",
                              "metadata": {
                                  "user_input": True,
                                  "input_title": title,
                                  "input_description": description,
                                  "input_fields": input_fields
                              }
                          }
                          # Don't emit completion notification for this tool
                          continue
                      except json.JSONDecodeError as e:
                          logging.warning(f"Failed to parse request_user_input content: {e}")
                          # Fall through to normal handling if parsing fails
                  elif tool_name in rag_tool_names:
                    # For RAG tools, we don't want to stream the content, as its a LOT of text
                      yield {
                            "is_task_complete": False,
                            "require_user_input": False,
                            "source_agent": tool_name,
                            "content": f"🔍 {tool_name}...",
                      }
                  # Stream other tool content normally (actual results for user)
                  elif tool_content and tool_content.strip():
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "source_agent": tool_name,
                          "content": tool_content + "\n",
                      }

                  # Then stream completion notification
                  tool_name_formatted = tool_name.title()
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "source_agent": tool_name,
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
          error_str = str(e)
          is_recursion_limit = "recursion limit" in error_str.lower()
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
          response_format_content = None
          response_format_args = None
          response_format_streaming = False

          try:
              await self._repair_orphaned_tool_calls(config)
          except Exception as repair_err:
              logging.warning(f"State repair (orphaned tools) failed: {repair_err}")

          is_context_overflow = any(
              phrase in error_str.lower()
              for phrase in ("input is too long", "prompt is too long", "too many tokens", "context length exceeded")
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
                              response_format_content = parsed.get('content', '')
                              response_format_args = {
                                  'content': parsed.get('content', ''),
                                  'is_task_complete': parsed.get('is_task_complete', True),
                                  'require_user_input': parsed.get('require_user_input', False),
                                  'metadata': parsed.get('metadata'),
                              }
                              logging.info(
                                  f"Retry stream: generate_structured_response captured "
                                  f"(content_len={len(response_format_content)})"
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
                          for tool_call in message.tool_calls:
                              tool_name = tool_call.get("name", "")
                              if tool_name.lower() in ('responseformat', 'platformengineerresponse'):
                                  tool_args = tool_call.get("args", {})
                                  structured_content = (
                                      tool_args.get("content", "")
                                      or tool_args.get("message", "")
                                      or tool_args.get("response", "")
                                  )
                                  if structured_content and USE_STRUCTURED_RESPONSE:
                                      logging.info("Retry stream: ResponseFormat tool captured")
                                      yield {
                                          "is_task_complete": tool_args.get("is_task_complete", True),
                                          "require_user_input": tool_args.get("require_user_input", False),
                                          "content": structured_content,
                                          "metadata": tool_args.get("metadata"),
                                          "from_response_format_tool": True,
                                      }
                                      response_format_args = {
                                          'content': structured_content,
                                          'is_task_complete': tool_args.get("is_task_complete", True),
                                          'require_user_input': tool_args.get("require_user_input", False),
                                          'metadata': tool_args.get("metadata"),
                                      }
                                      break
                          else:
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
                  logging.error(f"Retry after state repair also failed: {retry_err}")
                  error_str = str(retry_err)
          # ==============================================================
          # Phase 2: Wrap-up -- if retry was skipped (recursion limit) or
          # retry didn't produce a structured response, re-invoke the
          # graph's generate_structured_response node. We inject an
          # AIMessage describing the error (as_node="agent") so the
          # graph routes to structured response generation using its
          # own system prompt and the full conversation context.
          # ==============================================================
          if not response_format_args:
              logging.info(f"Phase 2 wrap-up via generate_structured_response (error: {error_str[:120]}...)")
              try:
                  await self._repair_orphaned_tool_calls(config)

                  error_summary = (
                      f"I encountered an error and need to wrap up: {error_str[:500]}\n\n"
                      "I will now summarize what was accomplished so far and provide my final response."
                  )
                  await self.graph.aupdate_state(
                      config,
                      {"messages": [AIMessage(content=error_summary)]},
                      as_node="agent",
                  )

                  async for item_type, item in self.graph.astream(
                      None, config,
                      stream_mode=['updates'],
                  ):
                      if item_type == 'updates' and isinstance(item, dict) and 'generate_structured_response' in item:
                          structured_resp = item['generate_structured_response'].get('structured_response')
                          if structured_resp is not None:
                              parsed = self.handle_structured_response(structured_resp)
                              parsed['from_response_format_tool'] = True
                              response_format_content = parsed.get('content', '')
                              response_format_args = {
                                  'content': parsed.get('content', ''),
                                  'is_task_complete': parsed.get('is_task_complete', True),
                                  'require_user_input': parsed.get('require_user_input', False),
                                  'metadata': parsed.get('metadata'),
                              }
                              logging.info(f"Phase 2 structured response captured (content_len={len(response_format_content)})")
                              yield parsed
              except Exception as wrapup_err:
                  logging.error(f"Phase 2 wrap-up failed: {wrapup_err}")

          if not response_format_args:
              fallback_msg = (
                  "I ran into an issue while processing your request. "
                  "Please ask me to continue or try your question again."
              )
              response_format_args = {
                  'content': fallback_msg,
                  'is_task_complete': True,
                  'require_user_input': False,
                  'metadata': None,
              }
              yield {
                  "is_task_complete": True,
                  "require_user_input": False,
                  "content": fallback_msg,
                  "from_response_format_tool": True,
              }

      # After EITHER primary or fallback streaming completes, parse the final response to extract is_task_complete
      logging.info(f"🔍 POST-STREAM PARSING: final_ai_message={final_ai_message is not None}, accumulated_chunks={len(accumulated_ai_content)}, response_format_args={response_format_args is not None}")

      # PRIORITY 1: If we captured ResponseFormat tool args during streaming, use them directly
      # This is the most reliable way to get structured response in structured response mode
      if USE_STRUCTURED_RESPONSE and response_format_args:
          logging.info(f"🎯 POST-STREAM: Using captured ResponseFormat tool args for completion, keys={list(response_format_args.keys())}")

          # Handle partial JSON that was accumulated from tool_call_chunks (Bedrock streaming)
          if "_partial_json" in response_format_args and response_format_args["_partial_json"]:
              partial_str = response_format_args["_partial_json"]
              logging.info(f"🎯 POST-STREAM: Parsing accumulated tool_call_chunks JSON ({len(partial_str)} chars)")
              logging.debug(f"🎯 POST-STREAM: Partial JSON preview: {partial_str[:500]}...")
              try:
                  parsed = json.loads(partial_str)
                  if isinstance(parsed, dict):
                      response_format_args.update(parsed)
                      del response_format_args["_partial_json"]  # Clean up
                      logging.info(f"🎯 POST-STREAM: Parsed partial JSON successfully! keys={list(response_format_args.keys())}")
              except json.JSONDecodeError as e:
                  logging.warning(f"🎯 POST-STREAM: Failed to parse partial JSON: {e}, content: {partial_str[:200]}...")

          structured_content = response_format_args.get("content", "") or response_format_args.get("message", "") or response_format_args.get("response", "")
          final_response = {
              'is_task_complete': response_format_args.get("is_task_complete", True),
              'require_user_input': response_format_args.get("require_user_input", False),
              'content': structured_content,
              'metadata': response_format_args.get("metadata"),
              'from_response_format_tool': True
          }
          logging.info(f"🎯 POST-STREAM: ResponseFormat response: is_task_complete={final_response['is_task_complete']}, content_len={len(structured_content) if structured_content else 0}")
      # PRIORITY 2: Try to use final_ai_message first, otherwise use accumulated content
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
      # EXCEPTION 1: If content came from ResponseFormat tool, it's the REAL structured content
      # EXCEPTION 2: If is_task_complete=True (from [FINAL ANSWER] marker), the content is the final answer
      # In both cases, should NOT be cleared (the accumulated chunks were just the LLM "thinking" text)
      if accumulated_ai_content and len(accumulated_ai_content) > 1:
          if final_response.get('from_response_format_tool'):
              logging.info(f"✅ Keeping content from ResponseFormat tool (not clearing despite {len(accumulated_ai_content)} streamed chunks)")
          elif final_response.get('is_task_complete'):
              logging.info(f"✅ Keeping content - task is complete with [FINAL ANSWER] (not clearing despite {len(accumulated_ai_content)} streamed chunks)")
          else:
              logging.info(f"⏭️ Clearing content from final response - already streamed {len(accumulated_ai_content)} chunks")
              final_response['content'] = ''

      logging.info(f"🚀 YIELDING FINAL RESPONSE: is_task_complete={final_response.get('is_task_complete')}, require_user_input={final_response.get('require_user_input')}, content_length={len(final_response.get('content', ''))}")

      # ========================================================================
      # BACKGROUND FACT EXTRACTION: Extract and persist facts after response
      # ========================================================================
      try:
          from ai_platform_engineering.utils.agent_memory.fact_extraction import (
              is_fact_extraction_enabled,
              extract_and_store_facts,
          )
          if is_fact_extraction_enabled() and graph_store and user_id:
              state = await self.graph.aget_state(config)
              thread_messages = (
                  state.values.get("messages", [])
                  if state and state.values else []
              )
              if thread_messages:
                  thread_id = config.get("configurable", {}).get("thread_id")
                  asyncio.create_task(
                      extract_and_store_facts(
                          store=graph_store,
                          messages=thread_messages,
                          user_id=user_id,
                          thread_id=thread_id,
                      )
                  )
                  logging.info(
                      f"Launched background fact extraction for user={user_id}, "
                      f"thread={thread_id}, messages={len(thread_messages)}"
                  )
      except Exception as fact_err:
          logging.debug(f"Background fact extraction skipped: {fact_err}")

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

      # CRITICAL: Check for [FINAL ANSWER] marker (used when USE_STRUCTURED_RESPONSE=false)
      # This marker indicates the task is complete and the content after it is the final answer
    #   final_answer_marker = "[FINAL ANSWER]"
    #   if final_answer_marker in content:
    #       marker_pos = content.find(final_answer_marker)
    #       final_content = content[marker_pos + len(final_answer_marker):].strip()
    #       logging.info(f"✅ Found [FINAL ANSWER] marker at position {marker_pos}, extracted {len(final_content)} chars")
    #       return {
    #           'is_task_complete': True,
    #           'require_user_input': False,
    #           'content': final_content,
    #       }

      # Strip markdown code block formatting if present
      if content.startswith('```json') and content.endswith('```'):
        content = content[7:-3].strip()  # Remove ```json at start and ``` at end
        logging.info("Stripped ```json``` formatting")
      elif content.startswith('```') and content.endswith('```'):
        content = content[3:-3].strip()  # Remove ``` at start and end
        logging.info("Stripped ``` formatting")


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
