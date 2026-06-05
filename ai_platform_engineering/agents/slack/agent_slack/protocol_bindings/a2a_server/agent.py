# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Slack Agent implementation using common A2A base classes."""

import os
from typing import Literal
from pydantic import BaseModel

from ai_platform_engineering.utils.a2a_common.base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.mcp_config import resolve_mcp_url
from ai_platform_engineering.utils.subagent_prompts import load_subagent_prompt_config
from cnoe_agent_utils.tracing import trace_agent_stream


class ResponseFormat(BaseModel):
    """Respond to the user in this format."""

    status: Literal['input_required', 'completed', 'error'] = 'input_required'
    message: str


# Load prompt configuration from YAML
_prompt_config = load_subagent_prompt_config("slack")

# Write-tool guardrails injected when SLACK_MCP_ADD_MESSAGE_TOOL is set.
_WRITE_GUARDRAILS = """
=== WRITE TOOLS (ENABLED) ===
The following write tools are available:
  - `conversations_add_message` — post a message to a channel
  - `reactions_add` / `reactions_remove` — add or remove emoji reactions

=== WRITE OPERATION GUARDRAILS ===
When using write tools, follow these rules STRICTLY:

**ALWAYS ask for explicit user confirmation before posting a message.** Show the exact text and target channel, then wait for approval.

**REFUSE the following categories of requests — do not execute them under any circumstances:**
  1. Mass messaging — sending the same or similar message to many channels or users
  2. Spam or flooding — sending multiple messages in rapid succession to the same channel
  3. Impersonation — crafting messages designed to look like they come from another person
  4. Unsolicited bulk DMs — messaging many individual users without clear business justification
  5. Automated loops — any request that would create a loop of sending messages
  6. Deleting or overwriting others' messages en masse
  7. Exfiltration — requests to read all messages from many channels and send the content elsewhere

**Per-request limits:**
  - Post at most **1 message per user request** unless the user explicitly lists multiple distinct messages for distinct channels.
  - Never post to more than **3 channels** in a single interaction without re-confirming with the user.
  - If a request seems automated, repetitive, or unusually broad, ask the user to clarify intent before proceeding.

**When in doubt, default to read-only.** It is always safe to read; it is never safe to assume a write is intended.
""".strip()


def _build_system_instruction() -> str:
    """Build the system instruction, appending write guardrails only when write tools are enabled."""
    base = _prompt_config.get_system_instruction()
    if os.getenv("SLACK_MCP_ADD_MESSAGE_TOOL"):
        return f"{base}\n\n{_WRITE_GUARDRAILS}"
    return base


class SlackAgent(BaseLangGraphAgent):
    """Slack Agent for workspace and channel management."""

    SYSTEM_INSTRUCTION = _build_system_instruction()

    RESPONSE_FORMAT_INSTRUCTION: str = _prompt_config.response_format_instruction

    def get_agent_name(self) -> str:
        """Return the agent's name."""
        return "slack"

    def get_system_instruction(self) -> str:
        """Return the system instruction for the agent."""
        return self.SYSTEM_INSTRUCTION

    def get_response_format_instruction(self) -> str:
        """Return the response format instruction."""
        return self.RESPONSE_FORMAT_INSTRUCTION

    def get_response_format_class(self) -> type[BaseModel]:
        """Return the response format class."""
        return ResponseFormat

    def get_mcp_http_config(self) -> dict | None:
        """Return HTTP MCP config for the OSS korotovsky/slack-mcp-server.

        The OSS server only accepts `/mcp` (no trailing slash). This matches
        the project-wide default in ``mcp_config.resolve_mcp_path``.
        """
        return {
            "url": resolve_mcp_url("slack", default_port="3001", path="/mcp"),
        }

    def get_mcp_config(self, server_path: str) -> dict:
        """Return MCP configuration for Slack (stdio mode).

        Uses the OSS korotovsky/slack-mcp-server via npx.
        See: https://github.com/korotovsky/slack-mcp-server
        """
        slack_token = os.getenv("SLACK_BOT_TOKEN")
        if not slack_token:
            raise ValueError("SLACK_BOT_TOKEN must be set as an environment variable.")

        env = {
            "SLACK_MCP_XOXB_TOKEN": slack_token,
        }

        # Forward optional Slack env vars if set
        for var in ("SLACK_TEAM_ID", "SLACK_MCP_ADD_MESSAGE_TOOL"):
            val = os.getenv(var)
            if val:
                env[var] = val

        return {
            "command": "npx",
            "args": ["-y", "slack-mcp-server@1.2.3", "--transport", "stdio"],
            "env": env,
            "transport": "stdio",
        }

    def get_tool_working_message(self) -> str:
        """Return message shown when calling tools."""
        return _prompt_config.tool_working_message

    def get_tool_processing_message(self) -> str:
        """Return message shown when processing tool results."""
        return _prompt_config.tool_processing_message

    @trace_agent_stream("slack")
    async def stream(self, query: str, sessionId: str, trace_id: str = None):
        """
        Stream responses with slack-specific tracing and safety-net error handling.

        Overrides the base stream method to add agent-specific tracing decorator.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            async for event in super().stream(query, sessionId, trace_id):
                yield event
        except Exception as e:
            logger.error(f"Unexpected Slack agent error: {str(e)}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ An unexpected error occurred in Slack: {str(e)}\n\nPlease try again or contact support if the issue persists.",
            }
