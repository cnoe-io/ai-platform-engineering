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


from agent_confluence.state import AgentState, Message, MsgType, OutputState
from cnoe_agent_utils import LLMFactory

logger = logging.getLogger(__name__)

# Find installed path of the confluence_mcp sub-module
spec = importlib.util.find_spec("agent_confluence.protocol_bindings.mcp_server.mcp_confluence.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_confluence.protocol_bindings.mcp_server.mcp_confluence.server module")

server_path = str(Path(spec.origin).resolve())

async def create_agent(prompt=None, response_format=None):
  memory = MemorySaver()

  # Find installed path of the confluence_mcp sub-module
  spec = importlib.util.find_spec("agent_confluence.protocol_bindings.mcp_server.server")
  if not spec or not spec.origin:
      raise ImportError("Cannot find agent_confluence.protocol_bindings.mcp_server.server module")

  server_path = str(Path(spec.origin).resolve())


  logger.info(f"Launching Confluence LangGraph Agent with MCP server adapter at: {server_path}")

  confluence_token = os.getenv("ATLASSIAN_TOKEN")
  if not confluence_token:
    raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

  confluence_api_url = os.getenv("ATLASSIAN_API_URL")
  if not confluence_api_url:
    raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

  confluence_email = os.getenv("ATLASSIAN_EMAIL")
  if not confluence_email:
    raise ValueError("ATLASSIAN_EMAIl must be set as an environment variable.")

  agent = None
  async with MultiServerMCPClient(
    {
      "confluence": {
        "command": "uv",
        "args": ["run", server_path],
        "env": {
          "ATLASSIAN_TOKEN": confluence_token,
          "ATLASSIAN_API_URL": confluence_api_url,
          "ATLASSIAN_EMAIL": confluence_email,
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
  confluence_token = os.getenv("ATLASSIAN_TOKEN")
  if not confluence_token:
      raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

  confluence_api_url = os.getenv("ATLASSIAN_API_URL")
  if not confluence_api_url:
      raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")

  confluence_email = os.getenv("ATLASSIAN_EMAIL")
  if not confluence_email:
    raise ValueError("ATLASSIAN_EMAIl must be set as an environment variable.")

  client = MultiServerMCPClient(
      {
          "confluence": {
              "command": "uv",
              "args": ["run", server_path],
              "env": {
                  "ATLASSIAN_TOKEN": confluence_token,
                  "ATLASSIAN_API_URL": confluence_api_url,
                  "ATLASSIAN_EMAIL": confluence_email,
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


# Setup the Confluence MCP Client and create React Agent
async def _async_confluence_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    confluence_token = os.getenv("ATLASSIAN_TOKEN")
    if not confluence_token:
      raise ValueError("ATLASSIAN_TOKEN must be set as an environment variable.")

    confluence_api_url = os.getenv("ATLASSIAN_API_URL")
    model = LLMFactory().get_llm()

    if not confluence_api_url:
      raise ValueError("ATLASSIAN_API_URL must be set as an environment variable.")
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")  # Removed raw data output

    confluence_email = os.getenv("ATLASSIAN_EMAIL")
    if not confluence_email:
        raise ValueError("ATLASSIAN_EMAIl must be set as an environment variable.")

    # Parse input from the client format
    if state.confluence_input is None:
        # Check if input comes in the standard format from the client
        if hasattr(state, 'input') and state.input:
            input_data = state.input
        else:
            # Fallback: try to find input in the state directly
            input_data = getattr(state, 'input', {})

        if isinstance(input_data, dict) and "messages" in input_data:
            messages = [Message.model_validate(m) for m in input_data["messages"]]
        else:
            messages = []
    elif hasattr(state.confluence_input, "messages"):
        messages = getattr(state.confluence_input, "messages")
    elif isinstance(state.confluence_input, dict) and "messages" in state.confluence_input:
        messages = [Message.model_validate(m) for m in state.confluence_input["messages"]]
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
        human_message = "Hello, I need help with Confluence"
        logger.warning("No user input found, using default message")

    logger.info(f"Launching MCP server at: {server_path}")

    client = MultiServerMCPClient(
        {
            "confluence": {
                "command": "uv",
                "args": ["run", server_path],
                "env": {
                    "ATLASSIAN_TOKEN": confluence_token,
                    "ATLASSIAN_API_URL": confluence_api_url,
                    "ATLASSIAN_EMAIL": confluence_email,
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
            "You are a Confluence AI Assistant specialized in Atlassian Confluence operations. "
            "You can help users with comprehensive Confluence management including:\n\n"
            "**Content Management:**\n"
            "- Create, read, update, and delete pages and blog posts\n"
            "- Manage page content, formatting, and structure\n"
            "- Handle page versions and revision history\n"
            "- Work with page properties and metadata\n\n"
            "**Space Operations:**\n"
            "- List, create, and manage Confluence spaces\n"
            "- Handle space permissions and access control\n"
            "- Manage space properties and settings\n"
            "- Organize content within spaces\n\n"
            "**Collaboration Features:**\n"
            "- Manage comments (footer and inline comments)\n"
            "- Handle labels for content organization\n"
            "- Manage attachments and file operations\n"
            "- Support content likes and user interactions\n\n"
            "**Search and Discovery:**\n"
            "- Search across pages, spaces, and content\n"
            "- Filter content by various criteria (status, type, labels, etc.)\n"
            "- Retrieve content relationships and links\n\n"
            "Always respect Confluence permissions and RBAC. Provide clear, actionable responses "
            "with status indicators (completed/input_required/error) and suggest relevant next steps. "
            "Ask clarifying questions when user intent is ambiguous and validate all operations."
        )
    )

    # Use the actual user message instead of a hardcoded one
    logger.info(f"Invoking agent with user message: {human_message}")
    llm_result = await agent.ainvoke({"messages": human_message})
    logger.info("LLM response received")
    # logger.debug(f"LLM result: {llm_result}")  # Removed raw LLM result output

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

    # logger.debug(f"Final output messages: {output_messages}")  # Removed raw output messages logging

    return {"confluence_output": OutputState(messages=(messages or []) + output_messages)}

# Sync wrapper for workflow server
def agent_confluence(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_confluence_agent(state, config))
