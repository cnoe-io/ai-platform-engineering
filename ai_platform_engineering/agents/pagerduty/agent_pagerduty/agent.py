# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
from pathlib import Path
import importlib.util
from typing import Any, Dict

from langchain_openai import AzureChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain.chains.summarize import load_summarize_chain
from langgraph.prebuilt import create_react_agent
from pydantic import SecretStr
from langchain_core.runnables import RunnableConfig

from .state import AgentState, Message, MsgType, OutputState

logger = logging.getLogger(__name__)

class Memory:
    """
    A class to manage short-term memory for the agent.
    """
    def __init__(self, max_size=5):
        self.max_size = max_size
        self.memory = []

    def add_interaction(self, user_input, agent_response):
        """
        Add a new interaction to memory.
        
        :param user_input: The user's input.
        :param agent_response: The agent's response.
        """
        self.memory.append({"user_input": user_input, "agent_response": agent_response})
        # Ensure memory does not exceed max size
        if len(self.memory) > self.max_size:
            self.memory.pop(0)

    def get_memory(self):
        """
        Retrieve the current memory.
        
        :return: A list of recent interactions.
        """
        return self.memory

    def clear_memory(self):
        """
        Clear all stored memory.
        """
        self.memory = []

# Initialize the Azure OpenAI model
api_key = os.getenv("AZURE_OPENAI_API_KEY")
if not api_key:
    raise ValueError("AZURE_OPENAI_API_KEY must be set as an environment variable.")

azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
if not azure_endpoint:
    raise ValueError("AZURE_OPENAI_ENDPOINT must be set as an environment variable.")

pagerduty_token = os.getenv("PAGERDUTY_TOKEN")
if not pagerduty_token:
    raise ValueError("PAGERDUTY_TOKEN must be set as an environment variable.")

pagerduty_api_url = os.getenv("PAGERDUTY_API_URL")
if not pagerduty_api_url:
    raise ValueError("PAGERDUTY_API_URL must be set as an environment variable.")

model = AzureChatOpenAI(
    api_key=SecretStr(api_key),
    azure_endpoint=azure_endpoint,
    model="gpt-4o",
    openai_api_type="azure_openai",
    api_version="2024-07-01-preview",
    temperature=0,
    max_retries=10,
    seed=42
)

# Find installed path of the pagerduty_mcp sub-module
spec = importlib.util.find_spec("agent_pagerduty.pagerduty_mcp.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_pagerduty.pagerduty_mcp.server module")

server_path = str(Path(spec.origin).resolve())

# Initialize memory
memory = Memory()

# Setup the PagerDuty MCP Client and create React Agent
async def _async_pagerduty_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    if hasattr(state.pagerduty_input, "messages"):
        messages = getattr(state.pagerduty_input, "messages")
    elif "messages" in state.pagerduty_input:
        messages = [Message.model_validate(m) for m in state.pagerduty_input["messages"]]
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

        # Retrieve memory and include it in the context
        recent_memory = memory.get_memory()
        logger.debug(f"Recent memory: {recent_memory}")

        # Format memory and current message to match expected structure
        memory_content = "\n".join(
            [f"User: {interaction['user_input']}\nAgent: {interaction['agent_response']}" for interaction in recent_memory]
        )
        combined_message = f"{memory_content}\nCurrent: {human_message}" if memory_content else human_message

        # Construct the message with required keys
        human_message_with_memory = {
            "role": "user",
            "content": combined_message
        }

    logger.info(f"Launching MCP server at: {server_path}")

    async with MultiServerMCPClient(
        {
            "pagerduty": {
                "command": "uv",
                "args": ["run", server_path],
                "env": {
                    "PAGERDUTY_TOKEN": pagerduty_token,
                    "PAGERDUTY_API_URL": pagerduty_api_url
                },
                "transport": "stdio",
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())
        llm_result = await agent.ainvoke({"messages": human_message_with_memory})
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

    # Store the interaction in memory
    memory.add_interaction(user_input=human_message, agent_response=ai_content)

    return {"pagerduty_output": OutputState(messages=messages + output_messages)}

# Sync wrapper for workflow server
def agent_pagerduty(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_pagerduty_agent(state, config))