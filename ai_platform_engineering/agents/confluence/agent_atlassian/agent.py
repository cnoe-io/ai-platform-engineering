# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import asyncio
import importlib.util
import logging
import os
from pathlib import Path
from typing import Any, Dict

from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from typing import Literal
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel


from agent_atlassian.state import AgentState, Message, MsgType, OutputState
from agent_atlassian.llm_factory import LLMFactory

logger = logging.getLogger(__name__)

# Find installed path of the atlassian_mcp sub-module
spec = importlib.util.find_spec("agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.server module")

server_path = str(Path(spec.origin).resolve())

async def create_agent(prompt=None, response_format=None):
  memory = MemorySaver()

  # Find installed path of the atlassian_mcp sub-module
  spec = importlib.util.find_spec("agent_atlassian.protocol_bindings.mcp_server.server")
  if not spec or not spec.origin:
      raise ImportError("Cannot find agent_atlassian.protocol_bindings.mcp_server.server module")

  server_path = str(Path(spec.origin).resolve())


  logger.info(f"Launching Atlassian LangGraph Agent with MCP server adapter at: {server_path}")

  atlassian_token = os.getenv("ATLASSIAN_TOKEN")
  if not atlassian_token:
    raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

  atlassian_api_url = os.getenv("ATLASSIAN_API_URL")
  if not atlassian_api_url:
    raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

  agent = None
  async with MultiServerMCPClient(
    {
      "atlassian": {
        "command": "uv",
        "args": ["run", server_path],
        "env": {
          "ATLASSIAN_TOKEN": atlassian_token,
          "ATLASSIAN_API_URL": atlassian_api_url,
          "ATLASSIAN_VERIFY_SSL": "false"
        },
        "transport": "stdio",
      }
    }
  ) as client:
    if prompt is None and response_format is None:
      agent = create_react_agent(
      LLMFactory().get_llm(),
      tools=client.get_tools(),
      checkpointer=memory
      )
    else:
      agent = create_react_agent(
      LLMFactory().get_llm(),
      tools=client.get_tools(),
      checkpointer=memory,
      prompt=prompt,
      response_format=response_format
      )
  return agent

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

def create_agent_sync(prompt, response_format):
  # return asyncio.run(create_agent(prompt, response_format))
  memory = MemorySaver()
  atlassian_token = os.getenv("ATLASSIAN_TOKEN")
  if not atlassian_token:
      raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

  atlassian_api_url = os.getenv("ATLASSIAN_API_URL")
  if not atlassian_api_url:
      raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

  client = MultiServerMCPClient(
      {
          "atlassian": {
              "command": "uv",
              "args": ["run", server_path],
              "env": {
                  "ATLASSIAN_TOKEN": atlassian_token,
                  "ATLASSIAN_API_URL": atlassian_api_url,
                  "ATLASSIAN_VERIFY_SSL": "false"
              },
              "transport": "stdio",
          }
      }
  )
  tools = client.get_tools()

  model = LLMFactory().get_llm()
  # model = ChatGoogleGenerativeAI(model='gemini-2.0-flash')
  return create_react_agent(
    model,
    tools=tools,
    checkpointer=memory,
    prompt=prompt,
    response_format=(response_format, ResponseFormat),
  )


# Setup the Atlassian MCP Client and create React Agent
async def _async_atlassian_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    atlassian_token = os.getenv("ATLASSIAN_TOKEN")
    if not atlassian_token:
      raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

    atlassian_api_url = os.getenv("ATLASSIAN_API_URL")
    model = LLMFactory().get_llm()

    if not atlassian_api_url:
      raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    if hasattr(state.atlassian_input, "messages"):
        messages = getattr(state.atlassian_input, "messages")
    elif "messages" in state.atlassian_input:
        messages = [Message.model_validate(m) for m in state.atlassian_input["messages"]]
    else:
        messages = []

    human_message = None
    if messages is not None:
        # Get last human message
        last_human_message = next(
            filter(lambda m: m.type == MsgType.human, reversed(messages)),
            None,
        )
        if last_human_message is not None:
            human_message = last_human_message.content
    
    # Default message if no user input was found
    if not human_message:
        human_message = "Hello, I need help with Atlassian"
        logger.warning("No user input found, using default message")

    logger.info(f"Launching MCP server at: {server_path}")

    client = MultiServerMCPClient(
        {
            "atlassian": {
                "command": "uv",
                "args": ["run", server_path],
                "env": {
                    "ATLASSIAN_TOKEN": atlassian_token,
                    "ATLASSIAN_API_URL": atlassian_api_url,
                    "ATLASSIAN_VERIFY_SSL": "false"
                },
                "transport": "stdio",
            }
        }
    )
    tools = await client.get_tools()
    memory = MemorySaver()
    agent = create_react_agent(
        model,
        tools,
        checkpointer=memory,
        prompt=(
            "You are a helpful assistant that can interact with Atlassian. "
            "You can use the Atlassian API to get information about applications, clusters, and projects. "
            "You can also perform actions like syncing applications or rolling back to previous versions."
        )
    )
    
    # Use the actual user message instead of a hardcoded one
    logger.info(f"Invoking agent with user message: {human_message}")
    llm_result = await agent.ainvoke({"messages": human_message})
    logger.info("LLM response received")
    logger.debug(f"LLM result: {llm_result}")

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

    logger.debug(f"Final output messages: {output_messages}")

    return {"atlassian_output": OutputState(messages=(messages or []) + output_messages)}

# Sync wrapper for workflow server
def agent_atlassian(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_atlassian_agent(state, config))
