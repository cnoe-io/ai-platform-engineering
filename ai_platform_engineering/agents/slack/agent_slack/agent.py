# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

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

from agent_slack.state import AgentState, Message, MsgType, OutputState
from cnoe_agent_utils import LLMFactory

logger = logging.getLogger(__name__)

# Find installed path of the slack_mcp sub-module
spec = importlib.util.find_spec("agent_slack.protocol_bindings.mcp_server.mcp_slack.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_slack.protocol_bindings.mcp_server.mcp_slack.server module")

server_path = str(Path(spec.origin).resolve())

async def create_agent(prompt=None, response_format=None):
  memory = MemorySaver()

  logger.info(f"Launching Slack LangGraph Agent with MCP server adapter at: {server_path}")

  slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
  if not slack_bot_token:
    raise ValueError("SLACK_BOT_TOKEN must be set as an environment variable.")

  slack_app_token = os.getenv("SLACK_APP_TOKEN")
  if not slack_app_token:
    raise ValueError("SLACK_APP_TOKEN must be set as an environment variable.")
    
  slack_signing_secret = os.getenv("SLACK_SIGNING_SECRET")
  if not slack_signing_secret:
    raise ValueError("SLACK_SIGNING_SECRET must be set as an environment variable.")

  async with MultiServerMCPClient(
    {
      "slack": {
        "command": "uv",
        "args": ["run", server_path],
        "env": {
          "SLACK_BOT_TOKEN": slack_bot_token,
          "SLACK_APP_TOKEN": slack_app_token,
          "SLACK_SIGNING_SECRET": slack_signing_secret,
          "SLACK_CLIENT_SECRET": os.getenv("SLACK_CLIENT_SECRET", ""),
          "SLACK_TEAM_ID": os.getenv("SLACK_TEAM_ID", "")
        },
        "transport": "stdio",
      }
    }
  ) as client:
    if prompt is None and response_format is None:
      agent = create_react_agent(
        LLMFactory().get_llm(),
        tools=await client.get_tools(),
        checkpointer=memory
      )
    else:
      agent = create_react_agent(
        LLMFactory().get_llm(),
        tools=await client.get_tools(),
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
  memory = MemorySaver()
  slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
  if not slack_bot_token:
      raise ValueError("SLACK_BOT_TOKEN must be set as an environment variable.")

  slack_app_token = os.getenv("SLACK_APP_TOKEN")
  if not slack_app_token:
      raise ValueError("SLACK_APP_TOKEN must be set as an environment variable.")

  slack_signing_secret = os.getenv("SLACK_SIGNING_SECRET")
  if not slack_signing_secret:
      raise ValueError("SLACK_SIGNING_SECRET must be set as an environment variable.")

  client = MultiServerMCPClient(
      {
          "slack": {
              "command": "uv",
              "args": ["run", server_path],
              "env": {
                  "SLACK_BOT_TOKEN": slack_bot_token,
                  "SLACK_APP_TOKEN": slack_app_token,
                  "SLACK_SIGNING_SECRET": slack_signing_secret,
                  "SLACK_CLIENT_SECRET": os.getenv("SLACK_CLIENT_SECRET", ""),
                  "SLACK_TEAM_ID": os.getenv("SLACK_TEAM_ID", "")
              },
              "transport": "stdio",
          }
      }
  )
  tools = asyncio.run(client.get_tools())

  model = LLMFactory().get_llm()
  return create_react_agent(
    model,
    tools=tools,
    checkpointer=memory,
    prompt=prompt,
    response_format=(response_format, ResponseFormat),
  )

# Setup the Slack MCP Client and create React Agent
async def _async_slack_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    slack_bot_token = os.getenv("SLACK_BOT_TOKEN")
    if not slack_bot_token:
      raise ValueError("SLACK_BOT_TOKEN must be set as an environment variable.")

    slack_app_token = os.getenv("SLACK_APP_TOKEN")
    if not slack_app_token:
      raise ValueError("SLACK_APP_TOKEN must be set as an environment variable.")

    slack_signing_secret = os.getenv("SLACK_SIGNING_SECRET")
    if not slack_signing_secret:
      raise ValueError("SLACK_SIGNING_SECRET must be set as an environment variable.")
      
    model = LLMFactory().get_llm()

    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    if hasattr(state.slack_input, "messages"):
        messages = getattr(state.slack_input, "messages")
    elif "messages" in state.slack_input:
        messages = [Message.model_validate(m) for m in state.slack_input["messages"]]
    else:
        messages = []

    if messages is not None:
        # Get last human message
        human_message = next(
            filter(lambda m: m.type == MsgType.human, reversed(messages)),
            None,
        )
        if human_message is not None:
            human_message = human_message.content

    logger.info(f"Launching MCP server at: {server_path}")

    async with MultiServerMCPClient(
        {
            "slack": {
                "command": "uv",
                "args": ["run", server_path],
                "env": {
                    "SLACK_BOT_TOKEN": slack_bot_token,
                    "SLACK_APP_TOKEN": slack_app_token,
                    "SLACK_SIGNING_SECRET": slack_signing_secret,
                    "SLACK_CLIENT_SECRET": os.getenv("SLACK_CLIENT_SECRET", ""),
                    "SLACK_TEAM_ID": os.getenv("SLACK_TEAM_ID", "")
                },
                "transport": "stdio",
            }
        }
    ) as client:
        tools = await client.get_tools()
        memory = MemorySaver()
        agent = create_react_agent(
            model,
            tools,
            checkpointer=memory,
            prompt=(
                "You are a helpful assistant that can interact with Slack. "
                "You can use the Slack API to send messages, get channel information, list users, "
                "and help manage conversations in the workspace. "
                "When responding, be concise, accurate, and actionable. "
                "If you need more information, ask clarifying questions. "
                "Always format your responses clearly and include relevant details from the Slack API when possible. "
                "Do not answer questions unrelated to Slack. "
                "For any create, update, or delete operation, always confirm with the user before proceeding."
            )
        )
        human_message = "Hello"
        if state.slack_input and state.slack_input.messages:
            last_msg = next((m for m in reversed(state.slack_input.messages) if m.type == MsgType.human), None)
            if last_msg:
                human_message = last_msg.content

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

        return {"slack_output": OutputState(messages=(messages or []) + output_messages)}

# Sync wrapper for workflow server
def agent_slack(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_slack_agent(state, config))