# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import uuid
from contextvars import ContextVar

from collections.abc import AsyncIterable
from typing import Any

# A2A tracing is disabled via monkey patching in main.py

from langchain_core.messages import AIMessage, ToolMessage

# Conditional langfuse import based on ENABLE_TRACING
if os.getenv("ENABLE_TRACING", "false").lower() == "true":
    from langfuse import get_client
    from langfuse.langchain import CallbackHandler

from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
  system_prompt
)
from ai_platform_engineering.multi_agents.platform_engineer.supervisor_agent import (
  AIPlatformEngineerMAS,
)
from ai_platform_engineering.utils.models.generic_agent import (
  ResponseFormat
)

# Import the context variable and helper from utils
from ai_platform_engineering.utils.a2a.a2a_remote_agent_connect import current_trace_id, generate_trace_id

def _setup_trace_id(context_id: str) -> str:
    """Setup trace ID for supervisor agent."""
    trace_id = generate_trace_id()
    logger.info(f"🔍 Supervisor A2A - initialized trace_id: {trace_id} for context_id: {context_id}")
    current_trace_id.set(trace_id)
    return trace_id

async def _process_graph_stream(graph, inputs, config):
    """Process graph stream and yield appropriate events."""
    async for item in graph.astream(inputs, config, stream_mode='values'):
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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class AIPlatformEngineerA2ABinding:
  """
  AI Platform Engineer Multi-Agent System (MAS) for currency conversion.
  """

  SYSTEM_INSTRUCTION = system_prompt

  def __init__(self):
      self.graph = AIPlatformEngineerMAS().get_graph()

  async def stream(self, query, context_id) -> AsyncIterable[dict[str, Any]]:
      # Debug logging
      tracing_status = "enabled" if os.getenv("ENABLE_TRACING", "false").lower() == "true" else "disabled"
      logger.info(f"🚀 A2A BINDING: Processing query with LangGraph tracing {tracing_status} (a2a traces disabled)")

      inputs = {'messages': [('user', query)]}
      config = {'configurable': {'thread_id': context_id}}

      # Setup trace ID for both tracing and non-tracing paths
      trace_id = _setup_trace_id(context_id)
      
      # Only add langfuse tracing if ENABLE_TRACING is true
      if os.getenv("ENABLE_TRACING", "false").lower() == "true":
          # Initialize Langfuse client and handler for shared trace context
          langfuse = get_client()
          langfuse_handler = CallbackHandler()
          config['callbacks'] = [langfuse_handler]  # Captures LangGraph execution details
          logger.info(f"🔍 Supervisor A2A - trace_id (context_id): {context_id}")

          # Tracing execution path
          with langfuse.start_as_current_span(
              name="🤖-supervisor-agent",
              trace_context={"trace_id": trace_id}
          ) as span:
              span.update_trace(input=query)
              
              async for event in _process_graph_stream(self.graph, inputs, config):
                  yield event

              result = self.get_agent_response(config)
              span.update_trace(output=result['content'])
              yield result
      else:
          # Non-tracing execution path
          async for event in _process_graph_stream(self.graph, inputs, config):
              yield event

          result = self.get_agent_response(config)
          yield result
      
      logger.info(f"🎯 LangGraph execution completed (tracing {tracing_status}, clean traces without a2a noise)")

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