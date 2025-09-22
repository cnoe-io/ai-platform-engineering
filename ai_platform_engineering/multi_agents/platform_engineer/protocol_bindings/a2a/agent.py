# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging

from collections.abc import AsyncIterable
from typing import Any

# A2A tracing is disabled via cnoe-agent-utils disable_a2a_tracing() in main.py

from langchain_core.messages import AIMessage, ToolMessage
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
import json

logger = logging.getLogger(__name__)

from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
  system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.supervisor_agent import (
  AIPlatformEngineerMAS,
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse

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
          async for item in self.graph.astream(inputs, config, stream_mode='values'):
              logging.debug(f"Received item from graph stream: {item}")
              message = item['messages'][-1]
              if (
                  isinstance(message, AIMessage)
                  and message.tool_calls
                  and len(message.tool_calls) > 0
              ):
                  logging.info("Detected AIMessage with tool calls, yielding 'Looking up...' response")
                  yield {
                      'is_task_complete': True,  # Always True for now
                      'require_user_input': False,
                      'content': 'Looking up...',
                  }
              elif isinstance(message, ToolMessage):
                  logging.info("Detected ToolMessage, yielding 'Processing..' response")
                  yield {
                      'is_task_complete': True,  # Always True for now
                      'require_user_input': False,
                      'content': 'Processing..',
                  }

          logging.debug("Stream processing complete, fetching final agent response")
          logging.debug(f"Finalizing response with config: {config}")
          result = self.get_agent_response(config)
          logging.info(f"Final agent response: {result}")

          yield result
      except Exception as e:
          logging.error(f"Error during agent stream processing: {e}")
          # Yield an error response instead of letting the exception propagate
          yield {
              'is_task_complete': True,
              'require_user_input': False,
              'content': f'Agent processing failed: {str(e)}',
          }

  def get_agent_response(self, config):
      logging.debug("Fetching current state from graph with provided config")
      current_state = self.graph.get_state(config)
      logging.debug(f"Current state retrieved: {current_state}")

      # Extract the AIMessage from the current state
      messages = current_state.values.get('messages', [])
      ai_message = next(
        (msg for msg in reversed(messages) if isinstance(msg, AIMessage)), None
      )

      if isinstance(ai_message, AIMessage):
        logging.info(f"AIMessage retrieved: {ai_message.content}")

        # Handle structured output from PlatformEngineerResponse model
        if isinstance(ai_message.content, PlatformEngineerResponse):
          logging.info("Found structured PlatformEngineerResponse object")
          response = ai_message.content
          if not response.is_task_complete:
            logging.info("PlatformEngineerResponse is not complete, but for now we will return it as complete")
            response.is_task_complete = True
          result = {
            'is_task_complete': response.is_task_complete,
            'require_user_input': response.require_user_input,
            'content': response.content,
          }

          # Add metadata if present
          if response.metadata:
            result['metadata'] = {
              'user_input': response.metadata.user_input,
              'input_fields': [
                {
                  'field_name': field.field_name,
                  'field_description': field.field_description,
                  'field_values': field.field_values
                }
                for field in response.metadata.input_fields
              ] if response.metadata.input_fields else None
            }

          logging.info(f"Returning structured response: {result}")
          return result

        # Fallback: try to parse as JSON string (backward compatibility)
        try:
          content = ai_message.content if isinstance(ai_message.content, str) else str(ai_message.content)

          # Log the raw content for debugging
          logging.info(f"Raw LLM content (fallback JSON parsing): {repr(content)}")

          # Strip markdown code block formatting if present
          if content.startswith('```json') and content.endswith('```'):
            content = content[7:-3].strip()  # Remove ```json at start and ``` at end
            logging.info("Stripped ```json``` formatting")
          elif content.startswith('```') and content.endswith('```'):
            content = content[3:-3].strip()  # Remove ``` at start and end
            logging.info("Stripped ``` formatting")

          logging.info(f"Content after stripping: {repr(content)}")

          response_dict = json.loads(content)
          if isinstance(response_dict, dict):
            logging.info("Successfully parsed JSON response (fallback)")
            return response_dict
          else:
            logging.warning("AIMessage content is not a valid dictionary, returning default structured response")
            return self._get_default_error_response("AIMessage content is not a valid dictionary")

        except json.JSONDecodeError as e:
          logging.error(f"Error decoding AIMessage content to dictionary: {e}")
          logging.error(f"Content that failed to parse: {repr(content)}")
          return self._get_default_error_response(f"Error decoding AIMessage content: {e}")

      else:
        logging.warning("AIMessage is missing or invalid, proceeding with default structured response")
        return self._get_default_error_response("AIMessage is missing or invalid")

  def _get_default_error_response(self, error_message: str) -> dict:
    """Return a default error response in the expected format"""
    return {
      'is_task_complete': True,  # Always True for now
      'require_user_input': True,
      'content': f"{error_message}. Please try again.",
    }
  SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']