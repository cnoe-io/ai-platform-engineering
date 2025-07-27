# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging

from collections.abc import AsyncIterable
from typing import Any

# A2A tracing is disabled via cnoe-agent-utils disable_a2a_tracing() in main.py

from langchain_core.messages import AIMessage, ToolMessage
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

logger = logging.getLogger(__name__)

from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
  system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.supervisor_agent import (
  AIPlatformEngineerMAS,
)
from ai_platform_engineering.utils.models.generic_agent import (
  ResponseFormat
)

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

  @trace_agent_stream("platform_engineer")
  async def stream(self, query, context_id, trace_id=None) -> AsyncIterable[dict[str, Any]]:
      logging.info(f"Starting stream with query: {query}, context_id: {context_id}, trace_id: {trace_id}")
      inputs = {'messages': [('user', query)]}
      config = self.tracing.create_config(context_id)
      logging.info(f"Created tracing config: {config}")

      async for item in self.graph.astream(inputs, config, stream_mode='values'):
          logging.info(f"Received item from graph stream: {item}")
          message = item['messages'][-1]
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              logging.info("Detected AIMessage with tool calls, yielding 'Looking up...' response")
              yield {
                  'is_task_complete': False,
                  'require_user_input': False,
                  'content': 'Looking up...',
              }
          elif isinstance(message, ToolMessage):
              logging.info("Detected ToolMessage, yielding 'Processing..' response")
              yield {
                  'is_task_complete': False,
                  'require_user_input': False,
                  'content': 'Processing..',
              }

      logging.info("Stream processing complete, fetching final agent response")
      logging.info(f"Finalizing response with config: {config}")
      result = self.get_agent_response(config)
      logging.info(f"Final agent response: {result}")

      yield result

  def get_agent_response(self, config):
      logging.info("Fetching current state from graph with provided config")
      current_state = self.graph.get_state(config)
      logging.info(f"Current state retrieved: {current_state}")

      # Extract the AIMessage from the current state
      messages = current_state.values.get('messages', [])
      ai_message = next(
          (msg for msg in messages if isinstance(msg, AIMessage)), None
      )

      structured_response = None
      if isinstance(ai_message, AIMessage):
          logging.info(f"AIMessage retrieved: {ai_message}")
          status = 'input_required' if 'input_required' in ai_message.content else 'completed'
          structured_response = ResponseFormat(
            status=status,
            message=ai_message.content
          )
      else:
          logging.warning("AIMessage is missing or invalid, proceeding with default structured response")
          structured_response = None
      structured_response = current_state.values.get('structured_response')
      logger.info(f"Structured response extracted: {structured_response}")

      if structured_response and isinstance(
          structured_response, ResponseFormat
      ):
          logging.info(f"Structured response is valid and of type ResponseFormat: {structured_response}")
          if structured_response.status == 'input_required':
              logging.info("Response status is 'input_required', returning appropriate response")
              return {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': structured_response.message,
              }
          if structured_response.status == 'error':
              logging.info("Response status is 'error', returning appropriate response")
              return {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': structured_response.message,
              }
          if structured_response.status == 'completed':
              logging.info("Response status is 'completed', returning appropriate response")
              return {
                  'is_task_complete': True,
                  'require_user_input': False,
                  'content': structured_response.message,
              }

      logging.info("Structured response is invalid or missing, returning default error response")
      return {
          'is_task_complete': False,
          'require_user_input': True,
          'content': (
              'We are unable to process your request at the moment. '
              'Please try again.'
          ),
      }

  SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']