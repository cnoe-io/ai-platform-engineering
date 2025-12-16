# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterable
from typing import Any

# A2A tracing is disabled via cnoe-agent-utils disable_a2a_tracing() in main.py
from a2a.types import Message as A2AMessage
from a2a.types import Task as A2ATask
from a2a.types import TaskArtifactUpdateEvent as A2ATaskArtifactUpdateEvent
from a2a.types import TaskStatusUpdateEvent as A2ATaskStatusUpdateEvent
from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    AIPlatformEngineerMAS,
)
from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from ai_platform_engineering.utils.a2a_common.langmem_utils import (
    summarize_messages,
    get_langmem_status,
    preflight_context_check,
)
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage, SystemMessage

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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

          orphaned_names = [info[1] for info in orphaned.values()]
          logging.warning(
              f"⚠️ Supervisor: Found {len(orphaned)} orphaned tool calls. "
              f"IDs: {list(orphaned.keys())}, Names: {orphaned_names}"
          )

          # CRITICAL FIX FOR BEDROCK:
          # Bedrock requires tool_result to be IMMEDIATELY after tool_use.
          # Simply appending ToolMessages won't work - they go at the end.
          #
          # SOLUTION: Reconstruct the message history with synthetic ToolMessages
          # inserted at the correct positions (immediately after AIMessages with tool_use).
          # This preserves conversation context while satisfying Bedrock's strict ordering.

          # Build a map of msg_index -> list of orphaned tool_call_ids for that AIMessage
          orphaned_by_msg_idx = {}
          for tool_call_id, (msg_idx, tool_name, ai_msg_id) in orphaned.items():
              if msg_idx not in orphaned_by_msg_idx:
                  orphaned_by_msg_idx[msg_idx] = []
              orphaned_by_msg_idx[msg_idx].append((tool_call_id, tool_name))

          # Reconstruct message list with synthetic ToolMessages inserted at correct positions
          reconstructed_messages = []
          for idx, msg in enumerate(messages):
              reconstructed_messages.append(msg)

              # If this AIMessage has orphaned tool calls, insert synthetic ToolMessages right after
              if idx in orphaned_by_msg_idx:
                  for tool_call_id, tool_name in orphaned_by_msg_idx[idx]:
                      synthetic_msg = ToolMessage(
                          content=(
                              f"⚠️ Tool call to '{tool_name}' was interrupted or timed out. "
                              f"The sub-agent failed to complete. You may retry if needed."
                          ),
                          tool_call_id=tool_call_id,
                          name=tool_name,
                      )
                      reconstructed_messages.append(synthetic_msg)
                      logging.info(
                          f"🔧 Inserted synthetic ToolMessage after AIMessage at index {idx} "
                          f"for tool_call_id={tool_call_id[:20]}..., name={tool_name}"
                      )

          # Now replace the entire message history:
          # 1. Remove all existing messages
          # 2. Add the reconstructed messages

          all_msg_ids = [getattr(msg, 'id', None) for msg in messages if getattr(msg, 'id', None)]
          if all_msg_ids:
              remove_messages = [RemoveMessage(id=msg_id) for msg_id in all_msg_ids]
              await self.graph.aupdate_state(config, {"messages": remove_messages})
              logging.debug(f"Removed {len(all_msg_ids)} old messages")

          # Add reconstructed messages (they'll be appended in order)
          await self.graph.aupdate_state(config, {"messages": reconstructed_messages})

          logging.info(
              f"✅ Supervisor: Reconstructed message history with {len(orphaned)} synthetic ToolMessages. "
              f"Total messages: {len(reconstructed_messages)} (was {len(messages)}). "
              f"Conversation context preserved."
          )

      except Exception as e:
          logging.error(f"Supervisor: Error repairing orphaned tool calls: {e}", exc_info=True)
          # Don't fail - this is a recovery mechanism, not critical path

  def _deserialize_a2a_event(self, data: Any):
      """Try to deserialize a dict payload into known A2A models."""
      if not isinstance(data, dict):
          return None
      for model in (A2ATaskStatusUpdateEvent, A2ATaskArtifactUpdateEvent, A2ATask, A2AMessage):
          try:
              return model.model_validate(data)  # type: ignore[attr-defined]
          except Exception:
              continue
      return None

  @trace_agent_stream("platform_engineer", update_input=True)
  async def stream(self, query, context_id, trace_id=None) -> AsyncIterable[dict[str, Any]]:
      logging.debug(f"Starting stream with query: {query}, context_id: {context_id}, trace_id: {trace_id}")
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
          logging.debug(f"Added context_id to config metadata: {context_id}")

      # Add trace_id to metadata for distributed tracing
      if trace_id:
          config['metadata']['trace_id'] = trace_id
          logging.debug(f"Added trace_id to config metadata: {trace_id}")
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
          final_ai_message = None

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

              # Stream LLM tokens (includes execution plans and responses)
              if isinstance(message, AIMessageChunk):
                  # Check if this chunk has tool_calls (tool invocation)
                  if hasattr(message, "tool_calls") and message.tool_calls:
                      # This is a tool call chunk - emit tool start notifications
                      for tool_call in message.tool_calls:
                          tool_name = tool_call.get("name", "")
                          # Skip tool calls with empty names (they're partial chunks being streamed)
                          if not tool_name or not tool_name.strip():
                              logging.debug("Skipping tool call with empty name (streaming chunk)")
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

              # Handle ToolMessage (tool completion indicators + content)
              elif isinstance(message, ToolMessage):
                  tool_name = message.name if hasattr(message, 'name') else "unknown"
                  tool_content = message.content if hasattr(message, 'content') else ""

                  # Mark tool call as completed (remove from pending)
                  tool_call_id = message.tool_call_id if hasattr(message, 'tool_call_id') else None
                  if tool_call_id and tool_call_id in pending_tool_calls:
                      pending_tool_calls.pop(tool_call_id)
                      logging.debug(f"Resolved tool call: {tool_call_id} -> {tool_name}")

                  logging.debug(f"Tool call completed: {tool_name} (content: {len(tool_content)} chars)")

                  # This is a hard-coded list for now
                  # TODO: Fetch the rag tool names from when the deep agent is initialised
                  rag_tool_names = {
                      'search', 'fetch_document', 'fetch_datasources_and_entity_types',
                      'graph_explore_ontology_entity', 'graph_explore_data_entity',
                      'graph_fetch_data_entity_details', 'graph_shortest_path_between_entity_types',
                      'graph_raw_query_data', 'graph_raw_query_ontology'
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

                  # Then stream completion notification
                  tool_name_formatted = tool_name.title()
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
                  logging.info(f"🎯 CAPTURED final AIMessage from primary stream: type={type(message).__name__}, has_content={hasattr(message, 'content')}")
                  if hasattr(message, 'content'):
                      content_preview = str(message.content)[:200]
                      logging.info(f"🎯 AIMessage content preview: {content_preview}...")
                      accumulated_ai_content.append(str(message.content))
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
                          content=f"Tool call interrupted or failed to complete.",
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
                      "content": f"❌ Recovery retry failed. Please ask your question again."
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
                      "content": f"❌ Tool ordering error occurred. Please start a new conversation."
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

                          langmem_status = get_langmem_status()
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
      # Fallback to old method if astream doesn't work
      except Exception as e:
          logging.warning(f"Token-level streaming failed, falling back to message-level: {e}")
          async for item_type, item in self.graph.astream(inputs, config, stream_mode=['messages', 'custom', 'updates']):

              # Handle custom A2A event payloads emitted via get_stream_writer()
              if isinstance(item, dict):
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
              elif item_type == 'messages':
                message = item[0]
              elif 'generate_structured_response' in item:
                yield self.handle_structured_response(item['generate_structured_response']['structured_response'])

              if (
                  isinstance(message, AIMessage)
                  and getattr(message, "tool_calls", None)
                  and len(message.tool_calls) > 0
              ):
                  logging.debug("Detected AIMessage with tool calls, yielding")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "",
                  }
              elif isinstance(message, ToolMessage):
                  # Stream ToolMessage content (includes formatted TODO lists)
                  tool_content = message.content if hasattr(message, 'content') else ""
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

      # After EITHER primary or fallback streaming completes, parse the final response to extract is_task_complete
      logging.info(f"🔍 POST-STREAM PARSING: final_ai_message={final_ai_message is not None}, accumulated_chunks={len(accumulated_ai_content)}")

      # Try to use final_ai_message first, otherwise use accumulated content
      if final_ai_message:
          logging.info("✅ Using final AIMessage for structured response parsing")
          # Extract content from AIMessage
          final_content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
          logging.info(f"📝 Extracted content from AIMessage: type={type(final_content)}, length={len(str(final_content))}")
          logging.info(f"📝 Content preview: {str(final_content)[:300]}...")
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
        logging.info("Content appears to be plain text; returning working structured response.")
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
        logging.warning("Parsed JSON is not a dictionary; returning working structured response with text content.")
        return {
          'is_task_complete': False,
          'require_user_input': False,
          'content': content,
        }
    except json.JSONDecodeError as e:
      logging.warning(f"Failed to decode content as JSON, returning working structured response: {e}")
      logging.warning(f"Content that failed to parse: {repr(content)}")
      return {
        'is_task_complete': False,
        'require_user_input': False,
        'content': content,
      }
