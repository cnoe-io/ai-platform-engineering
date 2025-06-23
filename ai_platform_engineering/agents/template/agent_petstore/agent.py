# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import sys
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


import asyncio
import os
import pathlib
from dotenv import load_dotenv, find_dotenv, dotenv_values

from agent_petstore.state import (
    AgentState,
    InputState,
    Message,
    MsgType,
)
from cnoe_agent_utils import LLMFactory

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
# First try to find .env in the current directory
dotenv_path = find_dotenv(usecwd=True)
if dotenv_path:
    logger.info(f"Loading environment variables from: {dotenv_path}")
    load_dotenv(dotenv_path)
else:
    # If not found, try one directory up (project root)
    parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dotenv_path = os.path.join(parent_dir, '.env')
    if os.path.isfile(dotenv_path):
        logger.info(f"Loading environment variables from project root: {dotenv_path}")
        load_dotenv(dotenv_path)
    else:
        logger.warning("No .env file found. Using environment variables if set or defaults.")

# Note: The following needs to be removed later after logic testing is successful
# Hard coding the environment variables for the Pet Store API
# Hard coding the environment variables for the LLM
  


# Debug print function using environment variables
def debug_print(message: str, banner: bool = True):
    # Will change this to use an environment variable later
    # For now, we will hard code it to true for debugging purposes
    debug_enabled = "true"
    
    if debug_enabled:
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

class PetstoreAgent:
    """Petstore Agent."""

    SYSTEM_INSTRUCTION = (
      'You are an expert assistant for managing Pet Store resources. '
      'Your purpose is to help users perform operations on the Pet Store API, including finding pets by status or tags, '
      'adding new pets to the store, updating pet information, placing orders, and managing users. '
      'You have access to the following Pet Store API endpoints:\n\n'
      '- Pet operations: Add, update, delete pets; find pets by status or tags; upload pet images\n'
      '- Store operations: Get inventory, place orders, find orders by ID, delete orders\n'
      '- User operations: Create users, create users with arrays/lists, login/logout, and manage user accounts\n\n'
      'Always use the available Pet Store tools to interact with the Pet Store API and provide accurate, actionable responses. '
      'If the user asks about anything unrelated to the Pet Store API, politely state that you can only assist with Pet Store operations.'
    )

    RESPONSE_FORMAT_INSTRUCTION: str = (
        'Select status as completed if the request is complete'
        'Select status as input_required if the input is a question to the user'
        'Set response status to error if the input indicates an error'
    )

    def __init__(self):
      # Setup the agent and load MCP tools
      self.model = LLMFactory().get_llm()
      self.graph = None
      
      # Log Python environment for debugging
      debug_print(f"Python version: {sys.version}")
      debug_print(f"Python executable: {sys.executable}")
      
      async def _async_petstore_agent(state: AgentState, config: RunnableConfig): #-> Dict[str, Any]
          """Set up the Pet Store agent with MCP tools."""
          args = config.get("configurable", {})

          # Determine the server path, allowing for flexibility in location
          default_server_path = "./agent_petstore/protocol_bindings/mcp_server/mcp_petstore/server.py"
          server_path = args.get("server_path", default_server_path)
          
          # Try to locate the server file relative to this file if default path doesn't exist
          # if not os.path.isfile(server_path):
          #     current_dir = pathlib.Path(__file__).parent.resolve()
          #     relative_path = "protocol_bindings/mcp_server/mcp_petstore/server.py"
          #     alt_server_path = os.path.join(current_dir, relative_path)
          #     if os.path.isfile(alt_server_path):
          #         server_path = alt_server_path
          #         debug_print(f"Found server.py at alternate path: {server_path}")
          
          debug_print(f"Launching MCP server at: {server_path}")

          # Get Pet Store API configuration from environment variables
          # Fall back to default values if not provided
          petstore_api_key = os.getenv("PETSTORE_API_KEY", "special-key")
          petstore_api_url = os.getenv("PETSTORE_API_URL", "https://petstore.swagger.io/v2")
          
          debug_print(f"Using Pet Store API URL: {petstore_api_url}")
          
          # Additional environment variables for MCP server
          mcp_env = {
              "MCP_API_KEY": petstore_api_key,
              "MCP_API_URL": petstore_api_url,
              "MCP_MODE": "STDIO",  # Ensure we're using STDIO mode for communication
              "PETSTORE_DEBUG": False,#os.getenv("PETSTORE_DEBUG", "false"),
              "PETSTORE_LOG_LEVEL": "INFO",#os.getenv("PETSTORE_LOG_LEVEL", "INFO"),
          }
          
          debug_print(f"MCP Environment Variables: {mcp_env}")
          
          # Set up the MCP client to connect to the Pet Store server
          try:
              client = MultiServerMCPClient(
                  {
                      "petstore": {
                          "command": sys.executable,  # Use the same Python interpreter
                          "args": ["-m", "uv", "run", server_path],  # Use module approach if possible
                          "env": mcp_env,
                          "transport": "stdio",
                          "timeout": 30,  # Add timeout to prevent hanging
                      }
                  }
              )
              debug_print("Successfully created MultiServerMCPClient")
          except Exception as e:
              error_msg = f"Failed to create MultiServerMCPClient: {str(e)}"
              debug_print(error_msg)
              logger.error(error_msg)
              # Try fallback approach
              try:
                  client = MultiServerMCPClient(
                      {
                          "petstore": {
                              "command": "python",
                              "args": [server_path],
                              "env": mcp_env,
                              "transport": "stdio",
                          }
                      }
                  )
                  debug_print("Successfully created MultiServerMCPClient using fallback approach")
              except Exception as e2:
                  error_msg = f"Failed to create MultiServerMCPClient with fallback: {str(e2)}"
                  debug_print(error_msg)
                  logger.error(error_msg)
                  raise
          
          tools = await client.get_tools()
          debug_print("Successfully retrieved tools from MCP server")
          
          print('*'*80)
          print("Available Pet Store Tools and Parameters:")
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
          debug_print("Invoking model for initial prompt...")
          try:
              llm_result = await self.graph.ainvoke({"messages": HumanMessage(content="Summarize what you can do?")}, config=runnable_config)
              debug_print("Successfully received response from model")
          except Exception as e:
              error_msg = f"Error invoking LLM: {str(e)}"
              debug_print(error_msg)
              logger.error(error_msg)
              raise

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
              debug_print("Assistant generated response")
              output_messages = [Message(type=MsgType.assistant, content=ai_content)]
          else:
              logger.warning("No assistant content found in LLM result")
              output_messages = []

          # Add a banner before printing the output messages
          if output_messages:
              debug_print(f"Agent MCP Capabilities: {output_messages[-1].content}")
          else:
              debug_print("No output messages generated")

      def _create_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
          debug_print("Creating agent...")
          try:
              result = asyncio.run(_async_petstore_agent(state, config))
              debug_print("Agent created successfully")
              return result
          except Exception as e:
              error_msg = f"Error creating agent: {str(e)}"
              debug_print(error_msg)
              logger.error(error_msg)
              raise
              
      messages = []
      state_input = InputState(messages=messages)
      agent_input = AgentState(input=state_input).model_dump(mode="json")
      runnable_config = RunnableConfig()
      # Add a HumanMessage to the input messages if not already present
      if not any(isinstance(m, HumanMessage) for m in messages):
          messages.append(HumanMessage(content="What is 2 + 2?"))
      _create_agent(agent_input, config=runnable_config)

    async def stream(
      self, query: str, context_id: str
    ) -> AsyncIterable[dict[str, Any]]:
      debug_print("Starting stream with query:", query, "and context_id:", context_id)
      inputs: dict[str, Any] = {'messages': [('user', query)]}
      config: RunnableConfig = {'configurable': {'thread_id': context_id}}

      try:
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
                    'content': 'Accessing Pet Store API...',
                  }
              elif isinstance(message, ToolMessage):
                  yield {
                    'is_task_complete': False,
                    'require_user_input': False,
                    'content': 'Processing Pet Store data...',
                  }
      except Exception as e:
          error_msg = f"Error in stream processing: {str(e)}"
          debug_print(error_msg)
          logger.error(error_msg)
          yield {
            'is_task_complete': False,
            'require_user_input': True,
            'content': f'An error occurred while processing your request: {str(e)}',
          }
          return

      yield self.get_agent_response(config)
      
    def get_agent_response(self, config: RunnableConfig) -> dict[str, Any]:
      debug_print(f"Fetching agent response with config: {config}")
      try:
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
              debug_print("Status is completed")
              return {
                'is_task_complete': True,
                'require_user_input': False,
                'content': structured_response.message,
              }
      except Exception as e:
          error_msg = f"Error getting agent response: {str(e)}"
          debug_print(error_msg)
          logger.error(error_msg)
          return {
            'is_task_complete': False,
            'require_user_input': True,
            'content': f'An error occurred while processing your response: {str(e)}',
          }

      debug_print("Unable to process request, returning fallback response")
      return {
        'is_task_complete': False,
        'require_user_input': True,
        'content': 'We are unable to process your request at the moment. Please try again.',
      }

    SUPPORTED_CONTENT_TYPES = ['text', 'text/plain']