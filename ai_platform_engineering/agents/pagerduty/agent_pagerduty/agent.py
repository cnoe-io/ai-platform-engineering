# Copyright 2025 Cisco
# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os
from pathlib import Path
import importlib.util
from typing import Optional

from langchain_openai import AzureChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from pydantic import SecretStr
from langchain_core.runnables import RunnableConfig
from typing import Any, Dict

from .state import AgentState, Message, MsgType, OutputState

logger = logging.getLogger(__name__)

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

# Initialize MCP client
mcp_client = MultiServerMCPClient(
    server_paths=[server_path],
    server_names=["pagerduty-mcp"]
)

# Create the agent
agent = create_react_agent(
    llm=model,
    tools=mcp_client.tools,
    system_message="""You are a helpful AI assistant that helps users manage their PagerDuty incidents, services, users, and schedules.
You can help with:
1. Creating, updating, and resolving incidents
2. Managing services and their configurations
3. Viewing and managing user information
4. Handling on-call schedules and rotations

Always be professional and concise in your responses."""
)

async def _async_pagerduty_agent(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> OutputState:
    """Run the PagerDuty agent asynchronously."""
    try:
        # Process messages
        messages = []
        for msg in state.messages:
            if msg.type == MsgType.HUMAN:
                messages.append({"role": "user", "content": msg.content})
            elif msg.type == MsgType.ASSISTANT:
                messages.append({"role": "assistant", "content": msg.content})
        
        # Run the agent
        result = await agent.ainvoke(
            {"messages": messages},
            config=config
        )
        
        # Extract the response
        response = result.get("output", "")
        
        return OutputState(
            messages=[
                Message(
                    type=MsgType.ASSISTANT,
                    content=response
                )
            ]
        )
    except Exception as e:
        logger.error(f"Error in PagerDuty agent: {str(e)}")
        raise

def agent_pagerduty(
    state: AgentState,
    config: Optional[RunnableConfig] = None,
) -> OutputState:
    """Run the PagerDuty agent."""
    return asyncio.run(_async_pagerduty_agent(state, config)) 