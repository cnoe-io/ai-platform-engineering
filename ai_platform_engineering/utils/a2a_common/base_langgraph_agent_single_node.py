# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

import logging
import os
import asyncio
from typing import Any, AsyncIterable, Dict
from datetime import datetime
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, AIMessageChunk
from langchain_core.runnables.config import RunnableConfig

from .base_langgraph_agent import BaseLangGraphAgent
from ai_platform_engineering.utils.metrics import MetricsCallbackHandler
from cnoe_agent_utils.tracing import trace_agent_stream

logger = logging.getLogger(__name__)

def debug_print(message: str, banner: bool = True):
    """Print debug messages if ACP_SERVER_DEBUG is enabled."""
    if os.getenv("ACP_SERVER_DEBUG", "false").lower() == "true":
        if banner:
            print("=" * 80)
        print(f"DEBUG: {message}")
        if banner:
            print("=" * 80)

class BaseLangGraphAgentSingleNode(BaseLangGraphAgent):
    """
    Experimental base class for single-node A2A streaming.
    Leverages astream_events(version="v2") for better event bubbling and unified streaming.
    """

    @trace_agent_stream("base_single_node")
    async def stream(
        self, query: str, sessionId: str, trace_id: str = None
    ) -> AsyncIterable[dict[str, Any]]:
        """
        Stream responses from the agent using astream_events(version="v2").
        """
        agent_name = self.get_agent_name()

        # Auto-inject current date into every query
        current_date = datetime.now().strftime("%Y-%m-%d")
        current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        enhanced_query = f"{query}\n\n[Current date: {current_date}, Current date/time: {current_datetime}]"

        debug_print(f"Starting single-node stream for {agent_name} with query: {enhanced_query}", banner=True)

        inputs: dict[str, Any] = {'messages': [('user', enhanced_query)]}
        config: RunnableConfig = self.tracing.create_config(sessionId)

        configurable = dict(config.get("configurable", {})) if isinstance(config.get("configurable", {}), dict) else {}
        if sessionId and "thread_id" not in configurable:
            configurable["thread_id"] = sessionId

        if "recursion_limit" not in configurable:
            configurable["recursion_limit"] = 100

        # Add metrics callback handler
        callbacks = list(config.get("callbacks") or [])
        callbacks.append(MetricsCallbackHandler(agent_name=agent_name))

        config = RunnableConfig(
            callbacks=callbacks,
            tags=config.get("tags"),
            metadata=config.get("metadata"),
            configurable=configurable,
        )

        # Ensure graph is initialized
        if self.graph is None:
            await self._setup_mcp_and_graph(config)

        # CRITICAL: Repair orphaned tool calls BEFORE any LLM invocation
        await self._repair_orphaned_tool_calls(config)

        # Pre-flight check: Estimate context usage
        await self._preflight_context_check(config, enhanced_query)

        # Auto-trim old messages
        await self._trim_messages_if_needed(config)

        # Track seen tool calls to avoids duplicates
        seen_tool_calls = set()
        
        # Track if any content was yielded to ensure we yield a completion marker
        content_yielded = False

        try:
            # Use astream_events for natural event bubbling
            async for event in self.graph.astream_events(inputs, config, version="v2"):
                kind = event.get("event")
                
                # 1. Handle Token Streaming
                if kind == "on_chat_model_stream":
                    chunk = event["data"]["chunk"]
                    if not chunk or not chunk.content:
                        continue
                        
                    content = chunk.content
                    # Normalize Bedrock/List format
                    if isinstance(content, list):
                        text_parts = []
                        for item in content:
                            if isinstance(item, dict):
                                text_parts.append(item.get('text', ''))
                            else:
                                text_parts.append(str(item))
                        content = ''.join(text_parts)
                    elif not isinstance(content, str):
                        content = str(content)
                        
                    if content:
                        content_yielded = True
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'kind': 'text_chunk',
                            'content': content,
                        }

                # 2. Handle Tool Calls
                elif kind == "on_tool_start":
                    tool_name = event.get("name", "unknown")
                    tool_id = event.get("run_id", "")
                    
                    if tool_id in seen_tool_calls:
                        continue
                    seen_tool_calls.add(tool_id)
                    
                    agent_name_formatted = agent_name.title()
                    tool_name_formatted = tool_name.title()
                    
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'kind': 'tool_call',
                        'tool_call': {
                            'id': tool_id,
                            'name': tool_name,
                        },
                        'content': f"🔧 {agent_name_formatted}: Calling tool: {tool_name_formatted}\n",
                    }

                # 3. Handle Tool Results
                elif kind == "on_tool_end":
                    tool_name = event.get("name", "unknown")
                    output = event["data"].get("output")
                    
                    # Tool end doesn't always have a successful status field in event data, 
                    # we check common error patterns in output
                    output_str = str(output) if output else ""
                    is_error = "error" in output_str.lower()[:200]
                    
                    icon = "❌" if is_error else "✅"
                    status = "failed" if is_error else "completed"
                    
                    agent_name_formatted = agent_name.title()
                    tool_name_formatted = tool_name.title()
                    
                    yield {
                        'is_task_complete': False,
                        'require_user_input': False,
                        'kind': 'tool_result',
                        'tool_result': {
                            'name': tool_name,
                            'status': status,
                            'is_error': is_error,
                        },
                        'content': f"{icon} {agent_name_formatted}: Tool {tool_name_formatted} {status}\n",
                    }
                    
                    # Optional: Stream tool output
                    stream_tool_output = os.getenv("STREAM_TOOL_OUTPUT", "false").lower() == "true"
                    if stream_tool_output and output_str:
                        max_len = int(os.getenv("MAX_TOOL_OUTPUT_LENGTH", "2000"))
                        preview = output_str[:max_len] + ("..." if len(output_str) > max_len else "")
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'kind': 'tool_output',
                            'content': f"📄 {agent_name_formatted}: Tool output:\n{preview}\n\n",
                        }

                # 4. Handle Custom Events (for multi-node compatibility via writer())
                elif kind == "on_custom_event":
                    # Directly yield custom events (e.g., from remote sub-agents)
                    yield event.get("data", {})

        except asyncio.CancelledError:
            logger.warning(f"{agent_name}: Stream cancelled by client")
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'cancelled',
                'content': f"⚠️ {agent_name.title()} operation was cancelled.",
            }
            return
        except Exception as e:
            logger.error(f"{agent_name}: Error during streaming: {e}", exc_info=True)
            yield {
                'is_task_complete': True,
                'require_user_input': False,
                'kind': 'error',
                'content': f"❌ Error: {str(e)}",
            }
            return

        # Final completion marker
        yield {
            'is_task_complete': True,
            'require_user_input': False,
            'content': '',
        }
