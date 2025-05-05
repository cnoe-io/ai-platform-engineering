# SPDX-License-Identifier: Apache-2.0

import logging
import asyncio
import os

from langchain_openai import AzureChatOpenAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from pydantic import SecretStr
from langchain_core.runnables import RunnableConfig
from typing import Any,  Dict


from .state import AgentState, Message, MsgType, OutputState
from pathlib import Path
import importlib.util

logger = logging.getLogger(__name__)

# Initialize the Azure OpenAI model
api_key = os.getenv("AZURE_OPENAI_API_KEY")
if not api_key:
    raise ValueError("AZURE_OPENAI_API_KEY must be set as an environment variable.")

azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
if not azure_endpoint:
    raise ValueError("AZURE_OPENAI_ENDPOINT must be set as an environment variable.")

argocd_token = os.getenv("ARGOCD_TOKEN")
if not azure_endpoint:
    raise ValueError("ARGOCD_TOKEN must be set as an environment variable.")

argocd_api_url = os.getenv("ARGOCD_API_URL")
if not azure_endpoint:
    raise ValueError("ARGOCD_API_URL must be set as an environment variable.")


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


# Find installed path of the argocd_mcp sub-module
spec = importlib.util.find_spec("agent_argocd.argocd_mcp.server")
if not spec or not spec.origin:
    raise ImportError("Cannot find agent_argocd.argocd_mcp.server module")

server_path = str(Path(spec.origin).resolve())


# Setup the ArgoCD MCP Client and create React Agent
async def _async_argocd_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    if hasattr(state.argocd_input, "messages"):
        messages = getattr(state.argocd_input, "messages")
    elif "messages" in state.argocd_input:
        messages = [Message.model_validate(m) for m in state.argocd_input["messages"]]
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
            "argocd": {
                "command": "uv",
                "args": ["run", server_path],
                "env": {
                    "ARGOCD_TOKEN": argocd_token,
                    "ARGOCD_API_URL": argocd_api_url,
                    "ARGOCD_VERIFY_SSL": "false"
                },
                "transport": "stdio",
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())
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

    return {"argocd_output": OutputState(messages=messages + output_messages)}

# Sync wrapper for workflow server
def agent_argocd(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_argocd_agent(state, config))
