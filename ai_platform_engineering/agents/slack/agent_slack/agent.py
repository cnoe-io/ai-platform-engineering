# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
import json
import aiohttp

from langchain_openai import AzureChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from pydantic import SecretStr
from langchain_core.runnables import RunnableConfig
from typing import Any, Dict, List

from .state import AgentState, Message, MsgType, OutputState
from pathlib import Path
import importlib.util

logger = logging.getLogger(__name__)

# Initialize the Azure OpenAI model
api_key = os.getenv("AZURE_OPENAI_API_KEY")
if not api_key:
    logger.warning("AZURE_OPENAI_API_KEY not set, LLM functionality will be limited")

azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
if not azure_endpoint:
    logger.warning("AZURE_OPENAI_ENDPOINT not set, LLM functionality will be limited")

slack_token = os.getenv("SLACK_BOT_TOKEN")
if not slack_token:
    logger.warning("SLACK_TOKEN not set, Slack integration will be limited")

# Find installed path of the slack_mcp sub-module
spec = importlib.util.find_spec("agent_slack.slack_mcp.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_slack.slack_mcp.server module")

server_path = str(Path(spec.origin).resolve())

# Get the Azure OpenAI model if credentials are available
def get_model(env: dict = None):
    key = (env or {}).get("AZURE_OPENAI_API_KEY", api_key)
    endpoint = (env or {}).get("AZURE_OPENAI_ENDPOINT", azure_endpoint)

    if key and endpoint:
        return AzureChatOpenAI(
            api_key=SecretStr(key),
            azure_endpoint=endpoint,
            model="gpt-4o",
            openai_api_type="azure_openai",
            api_version="2024-07-01-preview",
            temperature=0,
            max_retries=10,
            seed=42
        )
    else:
        logger.error("Cannot initialize Azure OpenAI model due to missing credentials")
        return None

async def discover_tools(base_url: str = "http://localhost:8000") -> List[Dict]:
    """Discover available tools from the MCP server's tools endpoint."""
    try:
        async with aiohttp.ClientSession() as session:
            # Try the standard MCP tools endpoint
            async with session.get(f"{base_url}/api/tools") as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Discovered {len(data.get('tools', []))} tools from API endpoint")
                    return data.get("tools", [])
                else:
                    logger.warning(f"Failed to get tools from API: {response.status}")
            
            # Try the older MCP format if needed
            async with session.get(f"{base_url}/tools") as response:
                if response.status == 200:
                    data = await response.json()
                    logger.info(f"Discovered {len(data.get('tools', []))} tools from legacy endpoint")
                    return data.get("tools", [])
                else:
                    logger.warning(f"Failed to get tools from legacy endpoint: {response.status}")
    except Exception as e:
        logger.error(f"Error discovering tools: {e}")
    
    logger.warning("Using default tool discovery mechanism as fallback")
    return []

# Setup the Slack MCP Client and create React Agent
async def _async_slack_agent(state: AgentState, config: RunnableConfig) -> AgentState:
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.safe_model_dump()}, config: {args}")

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

    model = get_model(state.metadata.get("env", {}))

    if not model:
        # Return error response if model not available
        error_msg = "Azure OpenAI model could not be initialized due to missing credentials"
        logger.error(error_msg)
        output_messages = [Message(type=MsgType.assistant, content=error_msg)]
        state.slack_output = OutputState(messages=messages + output_messages)
        # Assign next_action if present in LLM result (for LangGraph to decide next node
        state.next_action = None  # stop recursion
        # also reset if needed
        return state

    try:
        # Start and connect to the MCP server
        async with MultiServerMCPClient(
            {
                "slack": {
                    "command": "uv",
                    "args": ["run", server_path],
                    "env": {
                        "SLACK_TOKEN": slack_token,
                    },
                    "transport": "stdio",
                }
            }
        ) as client:
            # Attempt to discover tools via API first
            discovered_tools = await discover_tools()
            
            # Get tools via the client as fallback or additional source
            client_tools = client.get_tools()
            
            # If we found tools via API and have client tools, merge them
            if discovered_tools and client_tools:
                logger.info(f"Discovered {len(discovered_tools)} tools via API and {len(client_tools)} via client")
                # Use the discovered tool schemas but keep client tool execution capabilities
                # This ensures we have both rich descriptions and working execution
                
                # Extract tool names from client tools for matching
                client_tool_names = [tool.name for tool in client_tools]
                
                # Only include discovered tools that have a matching client implementation
                final_tools = [
                    tool for tool in discovered_tools
                    if tool["name"] in client_tool_names
                ]
                
                # Log any mismatches
                missing_tools = [
                    tool["name"] for tool in discovered_tools 
                    if tool["name"] not in client_tool_names
                ]
                if missing_tools:
                    logger.warning(f"Tools discovered but not available in client: {missing_tools}")
                
                # For debugging - check if we have tools available
                logger.info(f"Final tool count: {len(final_tools)}")
                
                # Create the agent with the enriched tool definitions
                agent = create_react_agent(model, client_tools, tool_descriptions=final_tools)
            else:
                # Fall back to client tools only
                logger.info(f"Using {len(client_tools)} client tools without API discovery")
                agent = create_react_agent(model, client_tools)
            
            # Invoke the agent with the human message
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
        
        output_messages = [Message(type=MsgType.assistant, content=ai_content)] if ai_content else []
        state.slack_output = OutputState(messages=messages + output_messages)
        state.next_action = llm_result.get("next_action", None)

    except Exception as e:
        logger.exception(f"Error in Slack agent: {e}")
        ai_content = f"An error occurred while processing your request: {str(e)}"
        output_messages = [Message(type=MsgType.assistant, content=ai_content)]
        state.slack_output = OutputState(messages=messages + output_messages)
        state.next_action = None

    return state

# Sync wrapper for workflow server
def agent_slack(state: AgentState, config: RunnableConfig) -> AgentState:
    """Process a step in the agent workflow using the Slack agent.
    
    Args:
        state: The current state of the agent.
        config: Configuration for the runnable.
        
    Returns:
        Updated state after processing.
    """
    return asyncio.run(_async_slack_agent(state, config))