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
      inputs = {'messages': [('user', query)]}
      config = self.tracing.create_config(context_id)

      async for item in self.graph.astream(inputs, config, stream_mode='values'):
          message = item['messages'][-1]
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              yield {
                  'is_task_complete': False,
                  'require_user_input': False,
                  'content': 'Looking up...',
              }
          elif isinstance(message, ToolMessage):
              yield {
                  'is_task_complete': False,
                  'require_user_input': False,
                  'content': 'Processing..',
              }

      result = self.get_agent_response(config)

      yield result

  def get_agent_response(self, config):
      current_state = self.graph.get_state(config)
      structured_response = current_state.values.get('structured_response')
      logger.debug(f"Current state: {current_state}, structured_response: {structured_response}")
      if structured_response and isinstance(
          structured_response, ResponseFormat
      ):
          if structured_response.status == 'input_required':
              return {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': structured_response.message,
              }
          if structured_response.status == 'error':
              return {
                  'is_task_complete': False,
                  'require_user_input': True,
                  'content': structured_response.message,
              }
          if structured_response.status == 'completed':
              return {
                  'is_task_complete': True,
                  'require_user_input': False,
                  'content': structured_response.message,
              }

      return {
          'is_task_complete': False,
          'require_user_input': True,
          'content': (
              'We are unable to process your request at the moment. '
              'Please try again.'
          ),
      }

  SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']