# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
from pathlib import Path
import importlib.util
from typing import Any, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

from agent_github.state import AgentState, Message, MsgType, OutputState
from cnoe_agent_utils import LLMFactory

logger = logging.getLogger(__name__)

# Find installed path of the github_mcp sub-module
spec = importlib.util.find_spec("agent_github.protocol_bindings.mcp_server.mcp_github.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_github.protocol_bindings.mcp_server.mcp_github.server module")

server_path = str(Path(spec.origin).resolve())

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

# Initialize memory
memory = Memory()

# Available GitHub toolsets
GITHUB_TOOLSETS = {
    "repos": "Repository-related tools (file operations, branches, commits)",
    "issues": "Issue-related tools (create, read, update, comment)",
    "users": "Anything relating to GitHub Users",
    "pull_requests": "Pull request operations (create, merge, review)",
    "code_security": "Code scanning alerts and security features",
}

async def create_agent(prompt=None, response_format=None, toolsets: Optional[List[str]] = None):
    """
    Create a GitHub agent with MCP tools
    """
    memory_saver = MemorySaver()

    github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")

    github_host = os.getenv("GITHUB_HOST")
    env_vars = {
        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
    }

    if github_host:
        env_vars["GITHUB_HOST"] = github_host

    if toolsets:
        if "all" in toolsets:
            env_vars["GITHUB_TOOLSETS"] = "all"
        else:
            valid_toolsets = [t for t in toolsets if t in GITHUB_TOOLSETS]
            if valid_toolsets:
                env_vars["GITHUB_TOOLSETS"] = ",".join(valid_toolsets)
            else:
                logger.warning("No valid toolsets provided, using default toolsets")

    if server_path is None:
        logger.error("MCP server path not found, cannot create agent")
        raise ImportError("MCP server path not found")

    logger.info(f"Launching MCP server at: {server_path}")

    async with MultiServerMCPClient(
        {
            "github": {
                "command": "uv",
                "args": ["run", server_path],
                "env": env_vars,
                "transport": "stdio",
            }
        }
    ) as client:
        tools = await client.get_tools()
        if prompt is None and response_format is None:
            agent = create_react_agent(
                LLMFactory().get_llm(),
                tools=tools,
                checkpointer=memory_saver
            )
        else:
            agent = create_react_agent(
                LLMFactory().get_llm(),
                tools=tools,
                checkpointer=memory_saver,
                prompt=prompt,
                response_format=response_format
            )
    return agent

async def _async_github_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")

    if server_path is None:
        logger.error("MCP server path not found, cannot create agent")
        raise ImportError("MCP server path not found")

    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    if hasattr(state.github_input, "messages"):
        messages = getattr(state.github_input, "messages")
    elif "messages" in state.github_input:
        messages = [Message.model_validate(m) for m in state.github_input["messages"]]
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
        _ = f"{memory_content}\nCurrent: {human_message}" if memory_content else human_message

    logger.info(f"Launching MCP server at: {server_path}")

    model = LLMFactory().get_llm()

    env_vars = {
        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
    }

    github_host = os.getenv("GITHUB_HOST")
    if github_host:
        env_vars["GITHUB_HOST"] = github_host

    client = MultiServerMCPClient(
        {
            "github": {
                "command": "uv",
                "args": ["run", server_path],
                "env": env_vars,
                "transport": "stdio",
            }
        }
    )

    tools = await client.get_tools()
    memory_saver = MemorySaver()
    agent = create_react_agent(
        model,
        tools,
        checkpointer=memory_saver,
        prompt=(
            "You are a helpful assistant that can interact with GitHub. "
            "You can use the GitHub API to manage repositories, issues, pull requests, and more. "
            "You can perform operations like creating issues, managing branches, and reviewing code."
        )
    )

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

    if ai_content:
        # Add the interaction to memory
        memory.add_interaction(human_message, ai_content)

        # Return the agent's response
        return OutputState(
            github_output={"messages": [Message(type=MsgType.ai, content=ai_content)]}
        ).model_dump()
    else:
        logger.warning("No AI content found in LLM result")
        return OutputState(
            github_output={"messages": [Message(type=MsgType.ai, content="I apologize, but I was unable to generate a response.")]}
        ).model_dump()

def agent_github(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    """
    Synchronous wrapper for the async GitHub agent.
    """
    return asyncio.run(_async_github_agent(state, config))