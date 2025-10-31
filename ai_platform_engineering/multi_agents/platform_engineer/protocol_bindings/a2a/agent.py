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
      logging.info(f"Starting stream with query: {query}, context_id: {context_id}, trace_id: {trace_id}")
      inputs = {'messages': [('user', query)]}
      config = self.tracing.create_config(context_id)

      # Ensure trace_id is always in config metadata for tools to access
      if 'metadata' not in config:
          config['metadata'] = {}

      if trace_id:
          config['metadata']['trace_id'] = trace_id
          logging.info(f"Added trace_id to config metadata: {trace_id}")
      else:
          # Try to get trace_id from TracingManager context if not provided
          current_trace_id = self.tracing.get_trace_id()
          if current_trace_id:
              config['metadata']['trace_id'] = current_trace_id
              logging.info(f"Added trace_id from context to config metadata: {current_trace_id}")
          else:
              logging.warning("No trace_id available from parameter or context")

      logging.info(f"Created tracing config: {config}")

      try:
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
                          logging.info(f"Processing custom a2a_event from sub-agent: {len(custom_text)} chars")
                          yield {
                              "is_task_complete": False,
                              "require_user_input": False,
                              "content": custom_text,
                          }
                      continue
                  elif item.get("type") == "artifact-update":
                      # New artifact-update format from sub-agents (full A2A event)
                      # Yield the entire event dict for the executor to handle
                      logging.info("Received artifact-update custom event from sub-agent, forwarding to executor")
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
                              
                          logging.info(f"Tool call started (from AIMessageChunk): {tool_name}")
                          
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

                  if content:  # Only yield if there's actual content
                      # Check for querying announcements and emit as tool_update events
                      import re
                      querying_pattern = r'🔍\s+Querying\s+(\w+)\s+for\s+([^.]+?)\.\.\.'
                      match = re.search(querying_pattern, content)
                      
                      if match:
                          agent_name = match.group(1)
                          purpose = match.group(2)
                          logging.info(f"Tool update detected: {agent_name} - {purpose}")
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

              # Handle ToolMessage (tool completion indicators)
              elif isinstance(message, ToolMessage):
                  tool_name = message.name if hasattr(message, 'name') else "unknown"
                  logging.info(f"Tool call completed: {tool_name}")
                  # Stream tool completion notification to client with metadata
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

      except asyncio.CancelledError:
          logging.info("Primary stream cancelled by client disconnection")
          return
      # Fallback to old method if astream doesn't work
      except Exception as e:
          logging.warning(f"Token-level streaming failed, falling back to message-level: {e}")
          async for item_type, item in self.graph.astream(inputs, config, stream_mode=['messages', 'custom', 'updates']):

              # Handle custom A2A event payloads emitted via get_stream_writer()
              if isinstance(item, dict) and item.get("type") == "a2a_event":
                  event_obj = self._deserialize_a2a_event(item.get("data"))
                  if event_obj is not None:
                      yield event_obj
                      continue
                  else:
                      logging.warning("Supervisor: Received a2a_event but failed to deserialize; ignoring.")
              elif item_type == 'messages':
                message = item[0]
              elif 'generate_structured_response' in item:
                yield self.handle_structured_response(item['generate_structured_response']['structured_response'])

              if (
                  isinstance(message, AIMessage)
                  and getattr(message, "tool_calls", None)
                  and len(message.tool_calls) > 0
              ):
                  logging.info("Detected AIMessage with tool calls, yielding")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "",
                  }
              elif isinstance(message, ToolMessage):
                  logging.info("Detected ToolMessage, yielding")
                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": "",
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

                  yield {
                      "is_task_complete": False,
                      "require_user_input": False,
                      "content": content,
                  }

      except Exception as e:
          logging.error(f"Error during agent stream processing: {e}")
          # Yield an error response instead of letting the exception propagate
          yield {
              'is_task_complete': True,
              'require_user_input': False,
              'content': f'Agent processing failed: {str(e)}',
          }

  def handle_structured_response(self, ai_message):
    try:
      response_obj = None
      if isinstance(ai_message, PlatformEngineerResponse):
          response_obj = ai_message
      elif isinstance(ai_message, dict):
          response_obj = PlatformEngineerResponse.model_validate(ai_message)
      elif isinstance(ai_message, str):
          raw_content = ai_message.strip()
          # Strip Markdown code fences if present
          if raw_content.startswith('```') and raw_content.endswith('```'):
              if raw_content.startswith('```json'):
                  raw_content = raw_content[7:-3].strip()
              else:
                  raw_content = raw_content[3:-3].strip()
          try:
              response_obj = PlatformEngineerResponse.model_validate_json(raw_content)
          except Exception:
              try:
                  # Last resort: json.loads then validate
                  response_obj = PlatformEngineerResponse.model_validate(json.loads(raw_content))
              except Exception:
                  response_obj = None
    except Exception as e:
      logging.warning(f"Failed to deserialize PlatformEngineerResponse: {e}")

    if response_obj is not None:
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
                'field_values': f.field_values
              }
              for f in (md.input_fields or [])
            ] if getattr(md, 'input_fields', None) else None
          }
      logging.info(f"Returning structured response (deserialized): {result}")
      return result

    # Fallback: handle plain text or attempt JSON parsing for backward compatibility
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
