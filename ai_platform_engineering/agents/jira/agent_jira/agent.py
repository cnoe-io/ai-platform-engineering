# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import asyncio
import importlib.util
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel
from typing import Literal

from agent_jira.state import AgentState, Message, MsgType, OutputState
from cnoe_agent_utils import LLMFactory

logger = logging.getLogger(__name__)


def get_server_path(module: str) -> str:
    """Finds the installed path of a sub-module."""
    spec = importlib.util.find_spec(module)
    if not spec or not spec.origin:
        raise ImportError(f"Cannot find module: {module}")
    return str(Path(spec.origin).resolve())


def get_env_var(var: str, required: bool = True) -> Optional[str]:
    """Get an environment variable, raising error if missing."""
    value = os.getenv(var)
    if required and not value:
        raise ValueError(f"{var} must be set as an environment variable.")
    return value


def build_jira_env() -> Dict[str, str]:
    """Construct environment for Jira MCP server."""
    return {
        "ATLASSIAN_TOKEN": get_env_var("ATLASSIAN_TOKEN"),
        "ATLASSIAN_API_URL": get_env_var("ATLASSIAN_API_URL"),
        "ATLASSIAN_EMAIL": get_env_var("ATLASSIAN_EMAIL"),
        "ATLASSIAN_VERIFY_SSL": str(os.getenv("ATLASSIAN_VERIFY_SSL", "false")).lower()
    }


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""
    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


async def create_agent(prompt=None, response_format=None):
    memory = MemorySaver()
    server_path = get_server_path("agent_jira.protocol_bindings.mcp_server.server")
    jira_env = build_jira_env()

    if jira_env["ATLASSIAN_VERIFY_SSL"] != "true":
        logger.warning("ATLASSIAN_VERIFY_SSL is set to false; this may expose sensitive data over insecure connections.")

    logger.info(f"Launching Jira LangGraph Agent with MCP server adapter at: {server_path}")

    async with MultiServerMCPClient({
        "jira": {
            "command": "uv",
            "args": ["run", server_path],
            "env": jira_env,
            "transport": "stdio",
        }
    }) as client:
        agent = create_react_agent(
            LLMFactory().get_llm(),
            tools=await client.get_tools() if asyncio.iscoroutinefunction(client.get_tools) else client.get_tools(),
            checkpointer=memory,
            prompt=prompt,
            response_format=response_format
        )
    return agent


def create_agent_sync(prompt, response_format):
    """Sync wrapper for agent creation."""
    memory = MemorySaver()
    server_path = get_server_path("agent_jira.protocol_bindings.mcp_server.server")
    jira_env = build_jira_env()

    if jira_env["ATLASSIAN_VERIFY_SSL"] != "true":
        logger.warning("ATLASSIAN_VERIFY_SSL is set to false; this may expose sensitive data over insecure connections.")

    client = MultiServerMCPClient({
        "jira": {
            "command": "uv",
            "args": ["run", server_path],
            "env": jira_env,
            "transport": "stdio",
        }
    })
    tools = client.get_tools()
    model = LLMFactory().get_llm()
    return create_react_agent(
        model,
        tools=tools,
        checkpointer=memory,
        prompt=prompt,
        response_format=(response_format, ResponseFormat),
    )


async def _async_jira_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    server_path = get_server_path("agent_jira.protocol_bindings.mcp_server.server")
    jira_env = build_jira_env()

    if jira_env["ATLASSIAN_VERIFY_SSL"] != "true":
        logger.warning("ATLASSIAN_VERIFY_SSL is set to false; this may expose sensitive data over insecure connections.")

    model = LLMFactory().get_llm()
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    # Extract messages from state
    def extract_messages(state: AgentState):
        if state.jira_input is None:
            input_data = getattr(state, 'input', {}) if hasattr(state, 'input') and state.input else {}
            if isinstance(input_data, dict) and "messages" in input_data:
                return [Message.model_validate(m) for m in input_data["messages"]]
            return []
        if hasattr(state.jira_input, "messages"):
            return getattr(state.jira_input, "messages")
        if isinstance(state.jira_input, dict) and "messages" in state.jira_input:
            return [Message.model_validate(m) for m in state.jira_input["messages"]]
        return []

    messages = extract_messages(state)

    # Get the last human message
    human_message = next((m.content for m in reversed(messages) if m.type == MsgType.human), None)
    if not human_message:
        human_message = "Hello, I need help with Jira"
        logger.warning("No user input found, using default message")

    logger.info(f"Launching MCP server at: {server_path}")

    async with MultiServerMCPClient({
        "jira": {
            "command": "uv",
            "args": ["run", server_path],
            "env": jira_env,
            "transport": "stdio",
        }
    }) as client:
        tools = await client.get_tools()
        memory = MemorySaver()
        agent = create_react_agent(
            model,
            tools,
            checkpointer=memory,
            prompt=(
                "You are a helpful assistant that can interact with Jira. "
                "You can use the Jira API to get information about applications, clusters, and projects. "
                "You can also perform actions like syncing applications or rolling back to previous versions."
            )
        )
        logger.info(f"Invoking agent with user message: {human_message}")
        llm_result = await agent.ainvoke({"messages": human_message})
        logger.info("LLM response received")
        logger.debug(f"LLM result: {llm_result}")

    # Extract meaningful content from the LLM result
    ai_content = None
    for msg in reversed(llm_result.get("messages", [])):
        msg_type = getattr(msg, "type", None) or (msg.get("type") if isinstance(msg, dict) else None)
        msg_content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else None)
        if msg_type in ("ai", "assistant") and msg_content:
            ai_content = msg_content
            break

    if not ai_content and "tool_call_results" in llm_result:
        ai_content = "\n".join(
            str(r.get("content", r)) for r in llm_result["tool_call_results"]
        )

    if ai_content:
        logger.info("Assistant generated response")
        output_messages = [Message(type=MsgType.assistant, content=ai_content)]
    else:
        logger.warning("No assistant content found in LLM result")
        output_messages = []

    logger.debug(f"Final output messages: {output_messages}")

    return {"jira_output": OutputState(messages=(messages or []) + output_messages)}


def agent_jira(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    """Sync wrapper for _async_jira_agent."""
    return asyncio.run(_async_jira_agent(state, config))