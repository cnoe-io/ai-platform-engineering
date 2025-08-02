# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid

from collections.abc import AsyncIterable
from typing import Any, Literal, Dict

from langchain_mcp_adapters.client import MultiServerMCPClient

from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import (
    RunnableConfig,
)
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent  # type: ignore
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream

import os

from agent_confluence.protocol_bindings.a2a_server.state import (
    AgentState,
    InputState,
    Message,
    MsgType,
)

logger = logging.getLogger(__name__)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class ConfluenceAgent:
    """Confluence Agent."""

    SYSTEM_INSTRUCTION = """You are a helpful assistant that can interact with Confluence.
    You can use the Confluence API to get information about pages, spaces, and blog posts.
    You can also perform actions like creating, reading, updating, or deleting Confluence content.
    If the user asks about anything unrelated to Confluence, politely state that you can only assist with Confluence operations."""

    RESPONSE_FORMAT_INSTRUCTION = """Select status as completed if the request is complete.
    Select status as input_required if the input is a question to the user.
    Set response status to error if the input indicates an error."""

    def __init__(self):
      # Setup the math agent and load MCP tools
      self.model = LLMFactory().get_llm()
      self.tracing = TracingManager()
      self.graph = None
      self._initialized = False

      async def _async_confluence_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          args = config.get("configurable", {})

          server_path = args.get("server_path", "./agent_confluence/protocol_bindings/mcp_server/mcp_confluence/server.py")
          logger.info(f"Launching MCP server at: {server_path}")

          confluence_token = os.getenv("ATLASSIAN_TOKEN")
          if not confluence_token:
            raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

          confluence_api_url = os.getenv("CONFLUENCE_API_URL")
          if not confluence_api_url:
            raise ValueError("CONFLUENCE_API_URL must be set as an environment variable.")
          client = MultiServerMCPClient(
              {
                  "math": {
                      "command": "uv",
                      "args": ["run", server_path],
                      "env": {
                          "ATLASSIAN_TOKEN": os.getenv("ATLASSIAN_TOKEN"),
                          "CONFLUENCE_API_URL": os.getenv("CONFLUENCE_API_URL"),
                          "ATLASSIAN_VERIFY_SSL": "false"
                      },
                      "transport": "stdio",
                  }
              }
          )
          tools = await client.get_tools()
          logger.debug('*'*80)
          logger.debug("Available Tools and Parameters:")
          for tool in tools:
            logger.debug(f"Tool: {tool.name}")
            logger.debug(f"  Description: {tool.description.strip().splitlines()[0]}")
            params = tool.args_schema.get('properties', {})
            if params:
              logger.debug("  Parameters:")
              for param, meta in params.items():
                param_type = meta.get('type', 'unknown')
                param_title = meta.get('title', param)
                default = meta.get('default', None)
                if default is not None:
                  logger.debug(f"    - {param} ({param_type}): {param_title} [default: {default}]")
                else:
                  logger.debug(f"    - {param} ({param_type}): {param_title}")
            else:
              logger.debug("  Parameters: None")
          logger.debug('*'*80)
          self.graph = create_react_agent(
            self.model,
            tools,
            checkpointer=memory,
            prompt=self.SYSTEM_INSTRUCTION,
            response_format=(self.RESPONSE_FORMAT_INSTRUCTION, ResponseFormat),
          )


          # Provide a 'configurable' key such as 'thread_id' for the checkpointer
          runnable_config = RunnableConfig(configurable={"thread_id": "test-thread"})
          llm_result = await self.graph.ainvoke({"messages": HumanMessage(content="Summarize what you can do?")}, config=runnable_config)

          # Try to extract meaningful content from the LLM result
          ai_content = None

          # Look through messages for final assistant content
          for msg in reversed(llm_result.get("messages", [])):
              if hasattr(msg, "type") and msg.type in ("ai", "assistant") and getattr(msg, "content", None):
                  ai_content = msg.content
                  break
              elif isinstance(msg, dict) and msg.get("type") in ("ai", "assistant") and msg.get("content"):
                  ai_content = msg["content"]
                  break

          # Fallback: if no content was found but tool_call_results exists
          if not ai_content and "tool_call_results" in llm_result:
              ai_content = "\n".join(
                  str(r.get("content", r)) for r in llm_result["tool_call_results"]
              )


          # Return response
          if ai_content:
              logger.info("Assistant generated response")
              output_messages = [Message(type=MsgType.assistant, content=ai_content)]
          else:
              logger.warning("No assistant content found in LLM result")
              output_messages = []

          # Log the capabilities (reduced verbosity)
          if output_messages:
              logger.info("Agent MCP Capabilities response generated")
              logger.debug(f"Agent MCP Capabilities: {output_messages[-1].content}")  # Only in debug mode

      # Store the async function for later use
      self._async_confluence_agent = _async_confluence_agent

    async def _initialize_agent(self) -> None:
      """Initialize the agent asynchronously when first needed."""
      if self._initialized:
          return

      messages = []
      state_input = InputState(messages=messages)
      agent_input = AgentState(confluence_input=state_input).model_dump(mode="json")
      runnable_config = RunnableConfig()
      # Add a HumanMessage to the input messages if not already present
      if not any(isinstance(m, HumanMessage) for m in messages):
          messages.append(HumanMessage(content="Show available Confluence tools"))

      await self._async_confluence_agent(agent_input, config=runnable_config)
      self._initialized = True

    @trace_agent_stream("confluence")
    async def stream(
      self, query: str, context_id: str | None = None, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
      logger.debug(f"Starting stream with query: {query} and context_id: {context_id}")

      # Initialize the agent if not already done
      await self._initialize_agent()

      # Use the context_id as the thread_id, or generate a new one if none provided
      thread_id = context_id or uuid.uuid4().hex
      inputs: dict[str, Any] = {'messages': [('user', query)]}
      config: RunnableConfig = self.tracing.create_config(thread_id)

      async for item in self.graph.astream(inputs, config, stream_mode='values'):
          message = item['messages'][-1]
          logger.debug('*'*80)
          logger.debug(f"Streamed message: {message}")
          logger.debug('*'*80)
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Looking up Confluence Resources rates...',
              }
          elif isinstance(message, ToolMessage):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Processing Confluence Resources rates..',
              }

      yield self.get_agent_response(config)
    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
      logger.debug(f"Fetching agent response with config: {config}")
      current_state = self.graph.get_state(config)
      logger.debug('*'*80)
      logger.debug(f"Current state: {current_state}")
      logger.debug('*'*80)

      structured_response = current_state.values.get('structured_response')
      logger.debug('='*80)
      logger.debug(f"Structured response: {structured_response}")
      logger.debug('='*80)
      if structured_response and isinstance(
        structured_response, ResponseFormat
      ):
        logger.debug("Structured response is a valid ResponseFormat")
        if structured_response.status in {'input_required', 'error'}:
          logger.debug("Status is input_required or error")
          return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': structured_response.message,
          }
        if structured_response.status == 'completed':
          logger.debug("Status is completed")
          return {
            'is_task_complete': True,
            'require_user_input': False,
            'content': structured_response.message,
          }

      logger.debug("Unable to process request, returning fallback response")
      return {
        'is_task_complete': False,
        'require_user_input': True,
        'content': 'We are unable to process your request at the moment. Please try again.',
      }
