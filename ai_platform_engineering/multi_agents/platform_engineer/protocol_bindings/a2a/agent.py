# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import json
import logging
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
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

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
      inputs = {'messages': [('user', query)]}
      config = self.tracing.create_config(context_id)

      # Ensure trace_id is always in config metadata for tools to access
      if 'metadata' not in config:
          config['metadata'] = {}

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

      try:
          # Track accumulated AI message content for final parsing
          accumulated_ai_content = []
          final_ai_message = None

          # Use astream with multiple stream modes to get both token-level streaming AND custom events
          # stream_mode=['messages', 'custom'] enables:
          # - 'messages': Token-level streaming via AIMessageChunk
          # - 'custom': Custom events from sub-agents via get_stream_writer()
          async for item_type, item in self.graph.astream(inputs, config, stream_mode=['messages', 'custom']):

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
                      # Skip tool calls with empty names
                      if not tool_name or not tool_name.strip():
                          logging.debug("Skipping tool call with empty name")
                          continue

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
                  logging.debug(f"Tool call completed: {tool_name} (content: {len(tool_content)} chars)")

                  # List of utility tools whose output should NOT be shown to users
                  utility_tools = [
                      "write_todos", "clear_workspace", "write_workspace_file",
                      "get_current_date", "format_markdown", "reflect_on_output",
                      "list_workspace_files", "read_workspace_file"
                  ]

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
                  # Stream other tool content normally (actual results for user)
                  # Skip utility tools AND sub-agent tools (their output will be synthesized by LLM)
                  # Only stream content from tools that need immediate display (none currently)
                  # Sub-agent tool results go to LLM for synthesis, not directly to client
                  elif False:  # Disabled - let LLM synthesize all tool outputs
                      pass

                  # Then stream completion notification (but not for utility tools)
                  tool_name_formatted = tool_name.title()
                  if tool_name in utility_tools:
                      # Skip completion notification for utility tools
                      logging.debug(f"Skipping completion notification for utility tool: {tool_name}")
                      continue
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
                  # BUT don't accumulate content if we already streamed it as chunks
                  logging.info(f"🎯 CAPTURED final AIMessage from primary stream: type={type(message).__name__}, has_content={hasattr(message, 'content')}")
                  final_ai_message = message
                  # Don't add to accumulated_ai_content - it was already accumulated as chunks

      except asyncio.CancelledError:
          logging.warning("⚠️ Primary stream cancelled by client disconnection - parsing final response before exit")
          # Don't return immediately - let post-stream parsing run below
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
                  # Stream ToolMessage content (skip only utility tools)
                  tool_content = message.content if hasattr(message, 'content') else ""
                  tool_name = message.name if hasattr(message, 'name') else "unknown"
                  logging.debug(f"Detected ToolMessage with {len(tool_content)} chars, yielding")

                  # List of utility tools whose output should NOT be shown
                  utility_tools = [
                      "write_todos", "clear_workspace", "write_workspace_file",
                      "get_current_date", "format_markdown", "reflect_on_output",
                      "list_workspace_files", "read_workspace_file"
                  ]

                  # Skip utility tools but stream sub-agent results
                  if tool_name not in utility_tools and tool_content:
                      yield {
                          "is_task_complete": False,
                          "require_user_input": False,
                          "content": tool_content if tool_content else "",
                          "kind": "tool_output",  # Mark so executor doesn't accumulate (LLM will synthesize)
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
                  # BUT don't accumulate content if we already streamed it as chunks
                  logging.info(f"🎯 CAPTURED final AIMessage from fallback stream: type={type(message).__name__}, has_content={hasattr(message, 'content')}")
                  final_ai_message = message
                  # Don't add to accumulated_ai_content - it was already accumulated as chunks

      # After EITHER primary or fallback streaming completes, parse the final response to extract is_task_complete
      logging.info(f"🔍 POST-STREAM PARSING: final_ai_message={final_ai_message is not None}, accumulated_chunks={len(accumulated_ai_content)}")

      # Parse final message to extract is_task_complete, but DON'T re-send content (it was already streamed)
      is_task_complete = False
      require_user_input = False

      if final_ai_message:
          logging.info("✅ Parsing final AIMessage for task completion status")
          # Extract content from AIMessage for parsing
          final_content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
          logging.info(f"📝 Content length: {len(str(final_content))}")
          parsed_response = self.handle_structured_response(final_content)
          is_task_complete = parsed_response.get('is_task_complete', False)
          require_user_input = parsed_response.get('require_user_input', False)
          logging.info(f"✅ Parsed from final AIMessage: is_task_complete={is_task_complete}, require_user_input={require_user_input}")
      elif accumulated_ai_content:
          accumulated_text = ''.join(accumulated_ai_content)
          logging.info(f"⚠️ Parsing accumulated content ({len(accumulated_text)} chars) for task completion status")
          parsed_response = self.handle_structured_response(accumulated_text)
          is_task_complete = parsed_response.get('is_task_complete', False)
          require_user_input = parsed_response.get('require_user_input', False)
          logging.info(f"✅ Parsed from accumulated content: is_task_complete={is_task_complete}, require_user_input={require_user_input}")
      else:
          logging.warning("❌ No final message or accumulated content to parse - defaulting to complete")
          is_task_complete = True

      # Yield ONLY the completion status (content was already streamed as chunks)
      final_response = {
          'is_task_complete': is_task_complete,
          'require_user_input': require_user_input,
          'content': '',  # Empty - content was already streamed
      }
      logging.info(f"🚀 YIELDING FINAL COMPLETION SIGNAL: is_task_complete={is_task_complete}, require_user_input={require_user_input}")
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
                'field_values': getattr(f, 'field_values', None)
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
