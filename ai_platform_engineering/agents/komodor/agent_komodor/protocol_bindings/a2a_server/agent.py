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
from cnoe_agent_utils import LLMFactory
from cnoe_agent_utils.tracing import TracingManager, trace_agent_stream
from pydantic import BaseModel

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent  # type: ignore


import asyncio
import os

from agent_komodor.protocol_bindings.a2a_server.state import (
    AgentState,
    InputState,
    Message,
    MsgType,
)

logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    if os.getenv("ACP_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

memory = MemorySaver()

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

class KomodorAgent:
    """Komodor Agent."""

    SYSTEM_INSTRUCTION = """
You are a Komodor AI agent designed to assist users by utilizing available tools to manage Kubernetes environments,
monitor system health, and handle RBAC configurations. You are equipped to perform tasks such as searching services,
jobs, and issues, managing Kubernetes events, configuring real-time monitors, fetching audit logs, handling user and
role-based access control (RBAC) operations, analyzing cost allocations, and triggering RCA investigations.
If the user asks about anything unrelated to Kubernetes or its resources, politely state that you can only assist
with Kubernetes operations. Do not attempt to answer unrelated questions or use tools for other purposes.

# Tool Capabilities:

## Service and Job Management:
* Search for services or jobs based on criteria like cluster, namespace, type, status, or deployment status.
* Retrieve YAML configurations for services.
* Search for service-related issues or Kubernetes events.

## Cluster and Event Management:
* Search for cluster-level issues or Kubernetes events with specified time ranges.
* Fetch details of clusters or download kubeconfig files.

## Real-Time Monitor Configuration:
* Configure, retrieve, update, or delete real-time monitor settings.
* Fetch configurations for all monitors or specific ones by UUID.

## Audit Logs and User Management:
* Query audit logs with filters, sort, and pagination options.
* Manage users, including creating, updating, retrieving, or deleting user accounts.
* Fetch effective permissions for users.

## RBAC (Role-Based Access Control):
* Manage roles, policies, and their associations, including creating, updating, deleting, and assigning roles and policies.
* Retrieve details of roles, policies, and user-role associations.

## Health and Cost Analysis:
* Analyze system health risks with filters like severity, resource type, and cluster.
* Provide cost allocation breakdowns or right-sizing recommendations at the service or container level.

## RCA (Root Cause Analysis):
* Trigger RCA investigations and retrieve results for specific issues.

## Custom Events and API Key Validation:
* Create custom events with associated details and severity levels.
* Validate API keys for operational readiness.
"""

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def __init__(self):
      # Setup the komodor agent and load MCP tools
      self.model = LLMFactory().get_llm()
      self.tracing = TracingManager()
      self.graph = None
      async def _async_komodor_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          args = config.get("configurable", {})

          server_path = args.get("server_path", "./agent_komodor/protocol_bindings/mcp_server/mcp_komodor/server.py")
          print(f"Launching MCP server at: {server_path}")

          komodor_token = os.getenv("KOMODOR_TOKEN")
          if not komodor_token:
            raise ValueError("KOMODOR_TOKEN must be set as an environment variable.")

          komodor_api_url = os.getenv("KOMODOR_API_URL")
          if not komodor_api_url:
            raise ValueError("KOMODOR_API_URL must be set as an environment variable.")
          client = MultiServerMCPClient(
              {
                  "komodor": {
                      "command": "uv",
                      "args": ["run", "--project", os.path.dirname(server_path), server_path],
                      "env": {
                          "KOMODOR_TOKEN": os.getenv("KOMODOR_TOKEN"),
                          "KOMODOR_API_URL": os.getenv("KOMODOR_API_URL"),
                          "KOMODOR_VERIFY_SSL": "false"
                      },
                      "transport": "stdio",
                  }
              }
          )
          tools = await client.get_tools()
          print('*'*80)
          tools_docs = ["Available Tools and Parameters:"]
          for tool in tools:
            tools_docs.append(f"Tool: {tool.name}")
            tools_docs.append(f"  Description: {tool.description}")
            tools_docs.append("")
          tools_docs = "\n".join(tools_docs)
          print(tools_docs)
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
          debug_print(f"Agent MCP Capabilities: {output_messages[-1].content}")

      def _create_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          return asyncio.run(_async_komodor_agent(state, config))
      messages = []
      state_input = InputState(messages=messages)
      agent_input = AgentState(input=state_input).model_dump(mode="json")
      runnable_config = RunnableConfig()
      # Add a HumanMessage to the input messages if not already present
      if not any(isinstance(m, HumanMessage) for m in messages):
          messages.append(HumanMessage(content="What is 2 + 2?"))
      _create_agent(agent_input, config=runnable_config)

    @trace_agent_stream("komodor")
    async def stream(
      self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
      print("DEBUG: Starting stream with query:", query, "and sessionId:", sessionId)
      inputs: dict[str, Any] = {'messages': [('user', query)]}
      config: RunnableConfig = self.tracing.create_config(sessionId)

      async for item in self.graph.astream(inputs, config, stream_mode='values'):
          message = item['messages'][-1]
          debug_print(f"Streamed message: {message}")
          if (
              isinstance(message, AIMessage)
              and message.tool_calls
              and len(message.tool_calls) > 0
          ):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Looking up Komodor Resources rates...',
              }
          elif isinstance(message, ToolMessage):
              yield {
                'is_task_complete': False,
                'require_user_input': False,
                'content': 'Processing Komodor Resources rates..',
              }

      yield self.get_agent_response(config)
    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
      debug_print(f"Fetching agent response with config: {config}")
      current_state = self.graph.get_state(config)
      debug_print(f"Current state: {current_state}")

      structured_response = current_state.values.get('structured_response')
      debug_print(f"Structured response: {structured_response}")
      if structured_response and isinstance(
        structured_response, ResponseFormat
      ):
        debug_print("Structured response is a valid ResponseFormat")
        if structured_response.status in {'input_required', 'error'}:
          debug_print("Status is input_required or error")
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
