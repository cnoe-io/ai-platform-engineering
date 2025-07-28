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
        (msg for msg in reversed(messages) if isinstance(msg, AIMessage)), None
      )

      if isinstance(ai_message, AIMessage):
        logging.info(f"AIMessage retrieved: {ai_message.content}")
        try:
          response_dict = json.loads(ai_message.content) if isinstance(ai_message.content, str) else ai_message.content
          if isinstance(response_dict, dict):
            return response_dict
          else:
            logging.warning("AIMessage content is not a valid dictionary, returning default structured response")
            return {
              'is_task_complete': False,
              'require_user_input': True,
              'content': (
                'AIMessage content is not a valid dictionary, returning default structured response.'
                'Please try again.'
              ),
            }
        except json.JSONDecodeError as e:
          logging.error(f"Error decoding AIMessage content to dictionary: {e}")
          return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': (
              'Error decoding AIMessage content to dictionary: {e}'
              'Please try again later.'
            ),
          }
      else:
        logging.warning("AIMessage is missing or invalid, proceeding with default structured response")
        return {
          'is_task_complete': False,
          'require_user_input': True,
          'content': (
            'AIMessage is missing or invalid, proceeding with default structured response'
            'Please try again.'
          ),
        }
  SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']