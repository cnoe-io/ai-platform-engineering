# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from claude_agent_sdk import ClaudeSDKClient, ClaudeAgentOptions
from typing import AsyncIterator, Dict, Any, Tuple, Optional
import logging
import os
import re
import uuid

from ...system_instructions import PETSTORE_SYSTEM_INSTRUCTION_WITH_FORMAT

logger = logging.getLogger(__name__)
# Ensure logger level allows INFO messages
logger.setLevel(logging.DEBUG)


class PetStoreAgent:
    """Petstore Agent using Claude Agent SDK."""

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self):
        # MCP configuration - same pattern as original template
        self.mcp_mode = os.getenv("MCP_MODE", "stdio").lower()

        # Support both PETSTORE_MCP_API_KEY and PETSTORE_API_KEY for backward compatibility
        self.mcp_api_key = (
            os.getenv("PETSTORE_MCP_API_KEY")
            or os.getenv("PETSTORE_API_KEY")
        )
        if not self.mcp_api_key and self.mcp_mode != "stdio":
            raise ValueError(
                "PETSTORE_MCP_API_KEY or PETSTORE_API_KEY must be set as an environment variable for HTTP transport."
            )

        self.mcp_api_url = os.getenv("PETSTORE_MCP_API_URL")
        # Defaults for each transport mode
        if not self.mcp_api_url:
            if self.mcp_mode == "stdio":
                self.mcp_api_url = "https://petstore.swagger.io/v2"
            else:
                self.mcp_api_url = "https://petstore.outshift.io/mcp"

        self.client = None

    async def initialize(self):
        """Initialize and connect the Claude SDK client."""
        if self.client is not None:
            return

        # Build MCP config based on transport mode
        if self.mcp_mode == "http" or self.mcp_mode == "streamable_http":
            mcp_config = {
                "petstore": {
                    "type": "http",
                    "url": self.mcp_api_url,
                    "headers": {"Authorization": f"Bearer {self.mcp_api_key}"}
                }
            }
        else:
            # STDIO transport
            server_path = "./agent_petstore/protocol_bindings/mcp_server/mcp_petstore/server.py"
            mcp_config = {
                "petstore": {
                    "type": "stdio",
                    "command": "uv",
                    "args": ["run", server_path],
                    "env": {
                        "MCP_API_KEY": self.mcp_api_key,
                        "MCP_API_URL": self.mcp_api_url
                    }
                }
            }

        # Configure Claude Agent options with preset + append pattern
        options = ClaudeAgentOptions(
            system_prompt={
                "type": "preset",
                "preset": "claude_code",
                "append": PETSTORE_SYSTEM_INSTRUCTION_WITH_FORMAT,
            },
            mcp_servers=mcp_config,
            permission_mode="bypassPermissions",
        )

        self.client = ClaudeSDKClient(options=options)
        await self.client.connect()
        return self.client

    async def close(self):
        """Clean up resources and disconnect the client."""
        if self.client:
            await self.client.disconnect()
            self.client = None

    def _parse_response_format(self, content: str) -> Tuple[bool, bool, str]:
        """
        Parse XML tags from Claude's response to extract task status flags.

        Args:
            content: The full response content from Claude

        Returns:
            Tuple of (task_complete, require_user_input, cleaned_content)
            - task_complete: Whether the task is complete
            - require_user_input: Whether user input is required
            - cleaned_content: Response with XML tags removed
        """
        if not content:
            return False, False, ""

        # Extract task_complete flag (allow whitespace around values)
        task_complete = False
        match = re.search(r'<task_complete>\s*(true|false)\s*</task_complete>', content, re.IGNORECASE)
        if match:
            task_complete = match.group(1).lower() == 'true'

        # Extract require_user_input flag (allow whitespace around values)
        require_user_input = False
        match = re.search(r'<require_user_input>\s*(true|false)\s*</require_user_input>', content, re.IGNORECASE)
        if match:
            require_user_input = match.group(1).lower() == 'true'

        # Remove XML tags from content to get clean response (only match valid boolean values)
        cleaned_content = re.sub(r'<task_complete>\s*(?:true|false)\s*</task_complete>\s*', '', content, flags=re.IGNORECASE)
        cleaned_content = re.sub(r'<require_user_input>\s*(?:true|false)\s*</require_user_input>\s*', '', cleaned_content, flags=re.IGNORECASE)
        cleaned_content = cleaned_content.strip()

        return task_complete, require_user_input, cleaned_content

    async def _retry_format_correction(self, session_id: str, original_content: str) -> Optional[str]:
        """
        Ask Claude to reformat its response if XML tags are missing or malformed.

        This method sends a follow-up query asking Claude to add the required XML tags
        to its previous response. This helps maintain consistency when Claude occasionally
        forgets to include the format tags.

        Args:
            session_id: The session ID to maintain conversation context
            original_content: The original response that needs reformatting (max 500 chars used)

        Returns:
            Reformatted response with XML tags, or None if retry fails
        """

        # Use a truncated preview to provide context while minimizing token cost and injection risk
        # Truncate to first 500 chars to keep under reasonable token limits
        content_preview = original_content[:500]
        if len(original_content) > 500:
            content_preview += "... [truncated]"

        retry_prompt = f"""CRITICAL: Your previous response was missing the required XML format tags for multi-agent coordination.

Return ONLY the following two XML lines analyzing the response below. Do not include any other text.

<task_complete>true|false</task_complete>
<require_user_input>true|false</require_user_input>

**When to set the flags:**
- **task_complete=true, require_user_input=false**: You fully answered the request, no clarification needed
- **task_complete=false, require_user_input=true**: You need clarification or information from the user

**Your previous response (for analysis only - do not repeat):**
<response_preview>
{content_preview}
</response_preview>

Return ONLY the two XML tag lines with appropriate flag values. Do not repeat the response content."""

        try:
            logger.info("Starting retry query...")
            await self.client.query(retry_prompt, session_id=session_id)
            logger.info("Retry query sent, waiting for response...")

            retry_messages = []
            async for message in self.client.receive_response():
                retry_messages.append(message)

            logger.info(f"Retry received {len(retry_messages)} message(s)")

            # Log all message types for debugging
            for idx, msg in enumerate(retry_messages):
                msg_type = type(msg).__name__
                has_content = hasattr(msg, "content")
                has_stop_reason = hasattr(msg, "stop_reason")
                logger.debug(f"Retry message {idx}: type={msg_type}, has_content={has_content}, has_stop_reason={has_stop_reason}")
                if has_stop_reason:
                    stop_reason_val = getattr(msg, 'stop_reason', None)
                    logger.debug(f"  stop_reason: {stop_reason_val}")

            # Extract content from ALL messages (not just last) - aggregate ALL text blocks
            all_texts = []
            if retry_messages:
                for msg_idx, msg in enumerate(retry_messages):
                    if hasattr(msg, "content"):
                        # Log block types for debugging
                        block_types = [type(b).__name__ for b in msg.content]
                        logger.debug(f"Message {msg_idx} contains {len(msg.content)} block(s): {block_types}")

                        # Aggregate all TextBlock content from this message
                        for block in msg.content:
                            if type(block).__name__ == "TextBlock" and hasattr(block, "text"):
                                all_texts.append(block.text)

                if all_texts:
                    retry_text = "".join(all_texts)
                    logger.info(f"Retry response received from {len(retry_messages)} message(s), {len(all_texts)} text block(s), total length: {len(retry_text)}")
                    logger.debug(f"Retry response preview: {retry_text[:200]}")
                    return retry_text
                else:
                    logger.warning(f"No TextBlock with text found across {len(retry_messages)} message(s)")
            else:
                logger.warning("No retry messages received")

            logger.warning("No text content found in retry messages")
            return None

        except Exception as e:
            logger.error(f"Retry format correction failed with exception: {e}", exc_info=True)
            return None

    async def stream(self, query: str, context_id: str = None) -> AsyncIterator[Dict[str, Any]]:
        """Stream agent responses compatible with A2A protocol."""
        await self.initialize()

        # Map A2A context_id to Claude SDK session_id (use uuid for uniqueness)
        session_id = context_id or f"session-{uuid.uuid4()}"

        try:
            # Send query with session ID
            await self.client.query(query, session_id=session_id)

            # Collect ALL messages before yielding (important for completion detection!)
            messages = []
            async for message in self.client.receive_response():
                messages.append(message)

            # Find the last message with actual content
            last_text_idx = -1
            last_content = ""
            for i, msg in enumerate(messages):
                transformed = self._transform_to_a2a(msg)
                if transformed.get("content"):
                    last_text_idx = i
                    last_content = transformed["content"]

            # Parse XML tags from the last message to extract task status
            task_complete, require_user_input, cleaned_content = self._parse_response_format(last_content)

            # Check if parsing found valid XML tags at start of content (strict check)
            # Both tags must be present with valid boolean values to skip retry
            task_tag_present = re.search(
                r'^\s*<task_complete>\s*(?:true|false)\s*</task_complete>',
                last_content,
                re.IGNORECASE | re.MULTILINE
            ) is not None
            user_tag_present = re.search(
                r'^\s*<require_user_input>\s*(?:true|false)\s*</require_user_input>',
                last_content,
                re.IGNORECASE | re.MULTILINE
            ) is not None
            has_xml_tags = task_tag_present and user_tag_present

            if not has_xml_tags:
                # Tags missing - attempt to get Claude to reformat
                logger.warning(f"Response missing XML format tags. Content preview: {last_content[:200]}...")
                logger.warning("Attempting retry correction")
                reformatted = await self._retry_format_correction(session_id, last_content)
                logger.info(f"Retry correction returned: {reformatted is not None}, length={len(reformatted) if reformatted else 0}")

                if reformatted and reformatted.strip():
                    # Parse flags from tags-only retry response
                    task_complete, require_user_input, _ = self._parse_response_format(reformatted)

                    # Use strict tag check on retry response
                    retry_task_tag = re.search(
                        r'^\s*<task_complete>\s*(?:true|false)\s*</task_complete>',
                        reformatted,
                        re.IGNORECASE | re.MULTILINE
                    ) is not None
                    retry_user_tag = re.search(
                        r'^\s*<require_user_input>\s*(?:true|false)\s*</require_user_input>',
                        reformatted,
                        re.IGNORECASE | re.MULTILINE
                    ) is not None
                    has_xml_tags = retry_task_tag and retry_user_tag

                    if has_xml_tags:
                        # Keep the original content (not the retry response)
                        cleaned_content = last_content
                        logger.info(f"Retry correction succeeded: task_complete={task_complete}, require_user_input={require_user_input}")
                    else:
                        logger.warning(f"Retry returned content but still missing valid XML tags. Reformatted preview: {reformatted[:200]}...")
                else:
                    logger.warning("Retry returned no content or empty response")

                if not has_xml_tags:
                    # Retry failed - use safe defaults for MAS coordination
                    logger.error("Retry failed, using safe defaults for MAS (task_complete=False, require_user_input=True)")
                    task_complete = False  # Don't mark complete if unsure
                    require_user_input = True  # Assume needs input to be safe
                    cleaned_content = last_content  # Use original content

            # Yield all messages with proper flags
            for i, msg in enumerate(messages):
                transformed = self._transform_to_a2a(msg)
                if i == last_text_idx and last_text_idx >= 0:
                    # Last message - use parsed flags and cleaned content
                    transformed["content"] = cleaned_content
                    transformed["is_task_complete"] = task_complete
                    transformed["require_user_input"] = require_user_input
                else:
                    # Intermediate message - still working
                    transformed["is_task_complete"] = False
                    transformed["require_user_input"] = False
                yield transformed

        except Exception as e:
            logger.error(f"Error in agent stream: {e}", exc_info=True)
            yield {
                "content": f"Error: {str(e)}",
                "is_task_complete": False,  # Don't mark as complete on error
                "require_user_input": True,  # Ask user what to do
                "error": True,
            }

    def _transform_to_a2a(self, claude_message) -> Dict[str, Any]:
        """Transform Claude SDK message to A2A protocol format."""
        content = ""
        is_complete = False
        tool_calls = []

        # Extract content from message blocks
        if hasattr(claude_message, "content"):
            for block in claude_message.content:
                block_type_name = type(block).__name__

                if block_type_name == "TextBlock":
                    # Regular text response
                    if hasattr(block, "text"):
                        content += block.text

                elif block_type_name == "ThinkingBlock":
                    # Extended thinking (Claude Sonnet 4) - skip for now
                    pass

                elif block_type_name == "ToolUseBlock":
                    # Track tool calls for observability
                    tool_call_info = {
                        "name": getattr(block, "name", "unknown"),
                        "arguments": getattr(block, "input", {}),
                        "tool_id": getattr(block, "id", "unknown"),
                        "type": "function",
                    }
                    tool_calls.append(tool_call_info)

                elif block_type_name == "ToolResultBlock":
                    # Tool result - skip (internal)
                    pass

        # Check if this is the final message
        if hasattr(claude_message, "stop_reason"):
            is_complete = claude_message.stop_reason is not None

        result = {
            "content": content,
            "is_task_complete": is_complete,  # Will be overridden by streaming logic
            "require_user_input": False,
        }

        if tool_calls:
            result["tool_calls"] = tool_calls

        return result