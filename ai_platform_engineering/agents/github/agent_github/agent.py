# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from typing import Literal
from langgraph.checkpoint.memory import MemorySaver
from pydantic import BaseModel

from agent_github.state import AgentState, Message, MsgType, OutputState
from agent_github.llm_factory import LLMFactory

logger = logging.getLogger(__name__)

# Available GitHub toolsets
GITHUB_TOOLSETS = {
    "repos": "Repository-related tools (file operations, branches, commits)",
    "issues": "Issue-related tools (create, read, update, comment)",
    "users": "Anything relating to GitHub Users",
    "pull_requests": "Pull request operations (create, merge, review)",
    "code_security": "Code scanning alerts and security features",
    "experiments": "Experimental features (not considered stable)"
}

async def create_agent(prompt=None, response_format=None, toolsets: Optional[List[str]] = None):
    """
    Create a GitHub agent with optional prompt and response format.
    
    Args:
        prompt: Custom prompt for the agent
        response_format: Response format specification
        toolsets: List of GitHub toolsets to enable. Available options:
            - repos: Repository-related tools
            - issues: Issue-related tools
            - users: User-related tools
            - pull_requests: Pull request operations
            - code_security: Code scanning and security
            - experiments: Experimental features
            - all: Enable all toolsets
    """
    memory = MemorySaver()

    logger.info("Launching GitHub LangGraph Agent with MCP server adapter")

    github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")

    # Preparing environment variables for GitHub MCP server
    env_vars = {
        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
    }
    
    # Add optional GitHub Enterprise Server host if provided
    github_host = os.getenv("GITHUB_HOST")
    if github_host:
        env_vars["GITHUB_HOST"] = github_host
    
    # Add toolsets configuration if provided
    if toolsets:
        # Handle 'all' toolset specially
        if "all" in toolsets:
            env_vars["GITHUB_TOOLSETS"] = "all"
        else:
            # Validate toolsets
            valid_toolsets = []
            for toolset in toolsets:
                if toolset in GITHUB_TOOLSETS or toolset == "all":
                    valid_toolsets.append(toolset)
                else:
                    logger.warning(f"Unknown toolset: {toolset}")
            env_vars["GITHUB_TOOLSETS"] = ",".join(valid_toolsets)
    
    # Enable dynamic toolsets if configured
    if os.getenv("GITHUB_DYNAMIC_TOOLSETS"):
        env_vars["GITHUB_DYNAMIC_TOOLSETS"] = os.getenv("GITHUB_DYNAMIC_TOOLSETS")

    # Configure Docker command for GitHub MCP server
    docker_args = [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
    ]

    # Add optional environment variables
    if github_host:
        docker_args.extend(["-e", "GITHUB_HOST"])
    if toolsets:
        docker_args.extend(["-e", "GITHUB_TOOLSETS"])
    if os.getenv("GITHUB_DYNAMIC_TOOLSETS"):
        docker_args.extend(["-e", "GITHUB_DYNAMIC_TOOLSETS"])

    # Add the GitHub MCP server image
    docker_args.append("ghcr.io/github/github-mcp-server")

    client = MultiServerMCPClient(
        {
            "github": {
                "command": "docker",
                "args": docker_args,
                "env": env_vars,
                "transport": "stdio",
            }
        }
    )

    tools = await client.get_tools()

    if prompt is None and response_format is None:
        agent = create_react_agent(
            LLMFactory().get_llm(),
            tools=tools,
            checkpointer=memory
        )
    else:
        agent = create_react_agent(
            LLMFactory().get_llm(),
            tools=tools,
            checkpointer=memory,
            prompt=prompt,
            response_format=response_format
        )
    return agent

class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str

def create_agent_sync(prompt, response_format, toolsets: Optional[List[str]] = None):
    """
    Synchronous version of create_agent for use in sync contexts.
    """
    memory = MemorySaver()
    
    github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")

    # Preparing environment variables for GitHub MCP server
    env_vars = {
        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
    }
    
    # Add optional GitHub Enterprise Server host if provided
    github_host = os.getenv("GITHUB_HOST")
    if github_host:
        env_vars["GITHUB_HOST"] = github_host
    
    # Add toolsets configuration if provided
    if toolsets:
        env_vars["GITHUB_TOOLSETS"] = ",".join(toolsets)
    
    # Enable dynamic toolsets if configured
    if os.getenv("GITHUB_DYNAMIC_TOOLSETS"):
        env_vars["GITHUB_DYNAMIC_TOOLSETS"] = os.getenv("GITHUB_DYNAMIC_TOOLSETS")

    client = MultiServerMCPClient(
        {
            "github": {
                "command": "docker",
                "args": [
                    "run",
                    "-i",
                    "--rm",
                    "-e",
                    "GITHUB_PERSONAL_ACCESS_TOKEN",
                ] + (["-e", "GITHUB_HOST"] if github_host else []) +
                (["-e", "GITHUB_TOOLSETS"] if toolsets else []) +
                (["-e", "GITHUB_DYNAMIC_TOOLSETS"] if os.getenv("GITHUB_DYNAMIC_TOOLSETS") else []) +
                ["ghcr.io/github/github-mcp-server"],
                "env": env_vars,
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


# Setup the GitHub MCP Client and create React Agent
async def _async_github_agent(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not github_token:
        raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")
      
    model = LLMFactory().get_llm()

    args = config.get("configurable", {})
    logger.debug(f"enter --- state: {state.model_dump_json()}, config: {args}")

    # Handle different input structures
    if hasattr(state.github_input, "messages"):
        messages = getattr(state.github_input, "messages")
    elif "messages" in state.github_input:
        messages = [Message.model_validate(m) for m in state.github_input["messages"]]
    else:
        messages = []

    human_message = "Hello"
    if messages is not None:
        # Get last human message
        human_message_obj = next(
            filter(lambda m: m.type == MsgType.human, reversed(messages)),
            None,
        )
        if human_message_obj is not None:
            human_message = human_message_obj.content

    logger.info("Launching GitHub MCP server")

    # Prepare environment variables for GitHub MCP server
    env_vars = {
        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
    }
    
    # Add optional GitHub Enterprise Server host if provided
    github_host = os.getenv("GITHUB_HOST")
    if github_host:
        env_vars["GITHUB_HOST"] = github_host
    
    # Add toolsets configuration from config if provided
    toolsets = args.get("toolsets")
    if toolsets:
        env_vars["GITHUB_TOOLSETS"] = ",".join(toolsets)
    
    # Enable dynamic toolsets if configured
    if os.getenv("GITHUB_DYNAMIC_TOOLSETS"):
        env_vars["GITHUB_DYNAMIC_TOOLSETS"] = os.getenv("GITHUB_DYNAMIC_TOOLSETS")

    client = MultiServerMCPClient(
        {
            "github": {
                "command": "docker",
                "args": [
                    "run",
                    "-i",
                    "--rm",
                    "-e",
                    "GITHUB_PERSONAL_ACCESS_TOKEN",
                ] + (["-e", "GITHUB_HOST"] if github_host else []) +
                (["-e", "GITHUB_TOOLSETS"] if toolsets else []) +
                (["-e", "GITHUB_DYNAMIC_TOOLSETS"] if os.getenv("GITHUB_DYNAMIC_TOOLSETS") else []) +
                ["ghcr.io/github/github-mcp-server"],
                "env": env_vars,
                "transport": "stdio",
            }
        }
    )
    
    tools = await client.get_tools()
    memory = MemorySaver()
    
    # Create agent with GitHub-specific prompt
    agent = create_react_agent(
        model,
        tools,
        checkpointer=memory,
        prompt=(
            "You are a helpful assistant that can interact with GitHub repositories and APIs. "
            "You can help with repository management, issue tracking, pull requests, code analysis, "
            "user management, and other GitHub-related tasks. You have access to comprehensive "
            "GitHub API capabilities through the available tools. Always be helpful and provide "
            "clear explanations of any actions you take."
        )
    )

    # Get the user's request from the most recent human message
    if state.github_input and state.github_input.messages:
        last_msg = next((m for m in reversed(state.github_input.messages) if m.type == MsgType.human), None)
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

    return {"github_output": OutputState(messages=(messages or []) + output_messages)}

# Sync wrapper for workflow server
def agent_github(state: AgentState, config: RunnableConfig) -> Dict[str, Any]:
    return asyncio.run(_async_github_agent(state, config))