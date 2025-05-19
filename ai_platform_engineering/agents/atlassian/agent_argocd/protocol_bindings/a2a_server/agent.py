# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging

from collections.abc import AsyncIterable
from typing import Any, Literal, Dict

from langchain_mcp_adapters.client import MultiServerMCPClient

from langchain_core.messages import AIMessage, ToolMessage, HumanMessage
from langchain_core.runnables.config import (
    RunnableConfig,
)
from langchain_openai import AzureChatOpenAI
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent  # type: ignore


import asyncio
import os

from agent_argocd.protocol_bindings.a2a_server.state import (
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

class ArgoCDAgent:
    """ArgoCD Agent."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for managing ArgoCD resources. '
      'Your sole purpose is to help users perform CRUD (Create, Read, Update, Delete) operations on ArgoCD applications, '
      'projects, and related resources. Always use the available ArgoCD tools to interact with the ArgoCD API and provide '
      'accurate, actionable responses. If the user asks about anything unrelated to ArgoCD or its resources, politely state '
      'that you can only assist with ArgoCD operations. Do not attempt to answer unrelated questions or use tools for other purposes.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def __init__(self):
      # Setup the math agent and load MCP tools
      self.model = AzureChatOpenAI(
          model="gpt-4o")
      self.graph = None
      async def _async_argocd_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          args = config.get("configurable", {})

          server_path = args.get("server_path", "./agent_argocd/protocol_bindings/mcp_server/mcp_argocd/server.py")
          print(f"Launching MCP server at: {server_path}")

          argocd_token = os.getenv("ARGOCD_TOKEN")
          if not argocd_token:
            raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

          argocd_api_url = os.getenv("ARGOCD_API_URL")
          if not argocd_api_url:
            raise ValueError("ARGOCD_API_URL must be set as an environment variable.")
          client = MultiServerMCPClient(
              {
                  "math": {
                      "command": "uv",
                      "args": ["run", server_path],
                      "env": {
                          "ARGOCD_TOKEN": os.getenv("ARGOCD_TOKEN"),
                          "ARGOCD_API_URL": os.getenv("ARGOCD_API_URL"),
                          "ARGOCD_VERIFY_SSL": "false"
                      },
                      "transport": "stdio",
                  }
              }
          )
          tools = await client.get_tools()
          print('*'*80)
          print("Available Tools and Parameters:")
          for tool in tools:
            print(f"Tool: {tool.name}")
            print(f"  Description: {tool.description.strip().splitlines()[0]}")
            params = tool.args_schema.get('properties', {})
            if params:
              print("  Parameters:")
              for param, meta in params.items():
                param_type = meta.get('type', 'unknown')
                param_title = meta.get('title', param)
                default = meta.get('default', None)
                print(f"    - {param} ({param_type}): {param_title}", end='')
                if default is not None:
                  print(f" [default: {default}]")
                else:
                  print()
            else:
              print("  Parameters: None")
            print()
          print('*'*80)
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
              print("Assistant generated response")
              output_messages = [Message(type=MsgType.assistant, content=ai_content)]
          else:
              logger.warning("No assistant content found in LLM result")
              output_messages = []

          # Add a banner before printing the output messages
          print("=" * 80)
          print(f"Agent MCP Capabilities: {output_messages[-1].content}")
          print("=" * 80)

      def _create_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          return asyncio.run(_async_argocd_agent(state, config))
      messages = []
      state_input = InputState(messages=messages)
      agent_input = AgentState(argocd_input=state_input).model_dump(mode="json")
      runnable_config = RunnableConfig()
      # Add a HumanMessage to the input messages if not already present
      if not any(isinstance(m, HumanMessage) for m in messages):
          messages.append(HumanMessage(content="What is 2 + 2?"))
      _create_agent(agent_input, config=runnable_config)

    async def stream(
      self, query: str, sessionId: str
    ) -> AsyncIterable[dict[str, Any]]:
      print("DEBUG: Starting stream with query:", query, "and sessionId:", sessionId)
      inputs: dict[str, Any] = {'messages': [('user', query)]}
      config: RunnableConfig = {'configurable': {'thread_id': sessionId}}

      async for item in self.graph.astream(inputs, config, stream_mode='values'):
          message = item['messages'][-1]
          print('*'*80)
          print("DEBUG: Streamed message:", message)
          print('*'*80)
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Looking up ArgoCD Resources rates...',
              }
          elif isinstance(message, ToolMessage):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Processing ArgoCD Resources rates..',
              }

      yield self.get_agent_response(config)
    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
      print("DEBUG: Fetching agent response with config:", config)
      current_state = self.graph.get_state(config)
      print('*'*80)
      print("DEBUG: Current state:", current_state)
      print('*'*80)

      structured_response = current_state.values.get('structured_response')
      print('='*80)
      print("DEBUG: Structured response:", structured_response)
      print('='*80)
      if structured_response and isinstance(
        structured_response, ResponseFormat
      ):
        print("DEBUG: Structured response is a valid ResponseFormat")
        if structured_response.status in {'input_required', 'error'}:
          print("DEBUG: Status is input_required or error")
          return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': structured_response.message,
          }
        if structured_response.status == 'completed':
          print("DEBUG: Status is completed")
          return {
            'is_task_complete': True,
            'require_user_input': False,
            'content': structured_response.message,
          }

      print("DEBUG: Unable to process request, returning fallback response")
      return {
        'is_task_complete': False,
        'require_user_input': True,
        'content': 'We are unable to process your request at the moment. Please try again.',
      }

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']
