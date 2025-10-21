# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import re
import httpx
import asyncio
import os
from typing import Optional, Tuple, List, Dict
from typing_extensions import override
from enum import Enum
from dataclasses import dataclass

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.client import A2AClient, A2ACardResolver
from a2a.types import (
    Message as A2AMessage,
    Task as A2ATask,
    TaskArtifactUpdateEvent,
    TaskArtifactUpdateEvent as A2ATaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    TaskStatusUpdateEvent as A2ATaskStatusUpdateEvent,
    SendStreamingMessageRequest,
    MessageSendParams,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding
)
from ai_platform_engineering.multi_agents.platform_engineer import platform_registry
from cnoe_agent_utils.tracing import extract_trace_id_from_context

logger = logging.getLogger(__name__)


class RoutingType(Enum):
    """Types of routing strategies for query execution"""
    DIRECT = "direct"          # Single sub-agent, direct streaming
    PARALLEL = "parallel"      # Multiple sub-agents, parallel streaming
    COMPLEX = "complex"        # Requires Deep Agent orchestration


@dataclass
class RoutingDecision:
    """Routing decision for query execution"""
    type: RoutingType
    agents: List[Tuple[str, str]]  # List of (agent_name, agent_url)
    reason: str = ""


class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor with streaming support for A2A sub-agents."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

        # Feature flag: Enhanced streaming with routing and parallel execution
        # When enabled, queries are analyzed and routed to:
        # - DIRECT: Single sub-agent streaming (fast path)
        # - PARALLEL: Multiple sub-agents streaming in parallel
        # - COMPLEX: Deep Agent for intelligent orchestration
        # When disabled, all queries go through Deep Agent (original behavior)
        self.enhanced_streaming_enabled = os.getenv('ENABLE_ENHANCED_STREAMING', 'true').lower() == 'true'
        logger.info(f"🎛️  Enhanced streaming: {'ENABLED' if self.enhanced_streaming_enabled else 'DISABLED'}")

    def _detect_sub_agent_query(self, query: str) -> Optional[Tuple[str, str]]:
        """
        Detect if a query is targeting a specific A2A sub-agent.

        Returns: (agent_name, agent_url) if detected, None otherwise

        Patterns detected:
        - "show me komodor clusters" -> komodor
        - "list github repos" -> github
        - "using komodor agent" -> komodor
        """
        query_lower = query.lower()
        logger.info(f"🔍 Detecting sub-agent in query: '{query_lower}'")

        # Get all available agents from registry
        available_agents = platform_registry.AGENT_ADDRESS_MAPPING
        logger.info(f"🔍 Available agents: {list(available_agents.keys())}")

        # Check for explicit "using X agent" pattern
        using_pattern = r'using\s+(\w+)\s+agent'
        match = re.search(using_pattern, query_lower)
        if match:
            agent_name = match.group(1)
            logger.info(f"🔍 Found 'using X agent' pattern: {agent_name}")
            if agent_name in available_agents:
                return (agent_name, available_agents[agent_name])

        # Check for agent name mentions in the query
        for agent_name, agent_url in available_agents.items():
            agent_name_lower = agent_name.lower()
            logger.info(f"🔍 Checking if '{agent_name_lower}' is in query...")
            if agent_name_lower in query_lower:
                logger.info(f"🎯 Detected direct sub-agent query for: {agent_name}")
                return (agent_name, agent_url)

        logger.info(f"🔍 No sub-agent detected in query")
        return None

    def _route_query(self, query: str) -> RoutingDecision:
        """
        Enhanced routing logic to determine query execution strategy.

        Returns:
            RoutingDecision with type (DIRECT/PARALLEL/COMPLEX) and target agents

        Examples:
            - "show me komodor clusters" → DIRECT (komodor)
            - "list github repos and komodor clusters" → PARALLEL (github, komodor)
            - "analyze clusters and create jira tickets" → COMPLEX (needs Deep Agent)
        """
        query_lower = query.lower()
        available_agents = platform_registry.AGENT_ADDRESS_MAPPING

        # Detect all mentioned agents in the query
        mentioned_agents = []
        for agent_name, agent_url in available_agents.items():
            agent_name_lower = agent_name.lower()
            if agent_name_lower in query_lower:
                mentioned_agents.append((agent_name, agent_url))

        logger.info(f"🎯 Routing analysis: found {len(mentioned_agents)} agents in query")

        # Routing logic
        if len(mentioned_agents) == 0:
            # No specific agents mentioned, needs Deep Agent for intelligent routing
            return RoutingDecision(
                type=RoutingType.COMPLEX,
                agents=[],
                reason="No specific agents detected, using Deep Agent for intelligent routing"
            )

        elif len(mentioned_agents) == 1:
            # Single agent, use direct streaming (fast path)
            agent_name, agent_url = mentioned_agents[0]
            return RoutingDecision(
                type=RoutingType.DIRECT,
                agents=mentioned_agents,
                reason=f"Direct streaming from {agent_name}"
            )

        else:
            # Multiple agents mentioned
            # Check if query requires orchestration (keywords like "analyze", "compare", "if", "then")
            orchestration_keywords = ['analyze', 'compare', 'if', 'then', 'create', 'update',
                                     'based on', 'depending on', 'which', 'that have']

            needs_orchestration = any(keyword in query_lower for keyword in orchestration_keywords)

            if needs_orchestration:
                # Needs Deep Agent for intelligent orchestration
                return RoutingDecision(
                    type=RoutingType.COMPLEX,
                    agents=mentioned_agents,
                    reason=f"Query requires orchestration across {len(mentioned_agents)} agents"
                )
            else:
                # Simple multi-agent query, can stream in parallel
                # E.g., "show me github repos and komodor clusters"
                agent_names = [name for name, _ in mentioned_agents]
                return RoutingDecision(
                    type=RoutingType.PARALLEL,
                    agents=mentioned_agents,
                    reason=f"Parallel streaming from {', '.join(agent_names)}"
                )

    async def _stream_from_sub_agent(
        self,
        agent_url: str,
        query: str,
        task: A2ATask,
        event_queue: EventQueue,
        trace_id: Optional[str] = None
    ) -> None:
        """
        Stream directly from an A2A sub-agent, bypassing Deep Agent.
        This enables token-by-token streaming from the sub-agent to the client.
        """
        logger.info(f"🌊 Streaming directly from sub-agent at {agent_url}")

        httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))
        try:
            # Fetch agent card
            resolver = A2ACardResolver(httpx_client=httpx_client, base_url=agent_url)
            agent_card = await resolver.get_agent_card()

            # Override the agent card's URL with the correct external URL
            # (agent cards often contain internal URLs like http://0.0.0.0:8000)
            agent_card.url = agent_url
            logger.debug(f"Overriding agent card URL to: {agent_url}")

            # Create A2A client
            client = A2AClient(httpx_client=httpx_client, agent_card=agent_card)

            # Prepare message payload
            message_payload = {
                "message": {
                    "role": "user",
                    "parts": [{"kind": "text", "text": query}],
                    "messageId": str(uuid.uuid4()),
                }
            }

            # Add trace_id to metadata if available
            if trace_id:
                message_payload["message"]["metadata"] = {"trace_id": trace_id}

            # Create streaming request
            streaming_request = SendStreamingMessageRequest(
                id=str(uuid.uuid4()),
                params=MessageSendParams(**message_payload),
            )

            # Send initial working status
            await self._safe_enqueue_event(
                event_queue,
                TaskStatusUpdateEvent(
                    status=TaskStatus(
                        state=TaskState.working,
                        message=new_agent_text_message(
                            "Processing query...",
                            task.context_id,
                            task.id,
                        ),
                    ),
                    final=False,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )

            # Stream chunks from sub-agent
            accumulated_text = []
            chunk_count = 0
            async for response_wrapper in client.send_message_streaming(streaming_request):
                chunk_count += 1
                wrapper_type = type(response_wrapper).__name__
                logger.info(f"📦 Received stream response #{chunk_count}: {wrapper_type}")

                # Extract event data from Pydantic response model
                try:
                    response_dict = response_wrapper.model_dump()
                    result_data = response_dict.get('result', {})
                    event_kind = result_data.get('kind', '')
                    logger.info(f"   └─ Event kind: {event_kind}")

                    # Handle artifact-update events (these contain the streaming content!)
                    if event_kind == 'artifact-update':
                        artifact_data = result_data.get('artifact', {})
                        parts_data = artifact_data.get('parts', [])

                        # Extract text from parts
                        texts = []
                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content:
                                    texts.append(text_content)

                        combined_text = ''.join(texts)
                        if combined_text:
                            logger.info(f"📝 Extracted {len(combined_text)} chars from artifact")
                            accumulated_text.append(combined_text)

                            # Forward chunk immediately to client (streaming!)
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=True,  # ← Key: append mode for streaming
                                    context_id=task.context_id,
                                    task_id=task.id,
                                    lastChunk=False,
                                    artifact=new_text_artifact(
                                        name='streaming_result',
                                        description='Streaming result from sub-agent',
                                        text=combined_text,
                                    ),
                                )
                            )
                            logger.info(f"✅ Streamed chunk to client: {combined_text[:50]}...")

                    # Handle status-update events (task completion and content)
                    elif event_kind == 'status-update':
                        status_data = result_data.get('status', {})
                        state = status_data.get('state', '')
                        logger.info(f"📊 Status update: {state}")

                        # Extract content from status message (if any)
                        # Note: message can be None when status is "completed"
                        message_data = status_data.get('message')
                        parts_data = message_data.get('parts', []) if message_data else []

                        texts = []
                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content:
                                    texts.append(text_content)

                        combined_text = ''.join(texts)
                        if combined_text:
                            logger.info(f"📝 Extracted {len(combined_text)} chars from status message")
                            accumulated_text.append(combined_text)

                            # Forward status message content to client
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=True,
                                    context_id=task.context_id,
                                    task_id=task.id,
                                    lastChunk=False,
                                    artifact=new_text_artifact(
                                        name='streaming_result',
                                        description='Streaming result from sub-agent',
                                        text=combined_text,
                                    ),
                                )
                            )
                            logger.info(f"✅ Streamed status content to client: {combined_text[:50]}...")

                        if state == 'completed':
                            logger.info(f"🎉 Sub-agent completed! Total chunks: {chunk_count}")
                            # Send final completion marker (content already streamed, don't duplicate)
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=False,
                                    context_id=task.context_id,
                                    task_id=task.id,
                                    lastChunk=True,
                                    artifact=new_text_artifact(
                                        name='final_result',
                                        description='Complete result from sub-agent',
                                        text='',  # Empty - content already streamed above
                                    ),
                                )
                            )
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskStatusUpdateEvent(
                                    status=TaskStatus(state=TaskState.completed),
                                    final=True,
                                    context_id=task.context_id,
                                    task_id=task.id,
                                )
                            )
                            return

                except Exception as e:
                    logger.error(f"   └─ Error processing stream chunk: {e}")
                    import traceback
                    logger.error(traceback.format_exc())

            # If we exit the loop without receiving 'completed' status, stream ended prematurely
            # Send any accumulated text as final result
            if accumulated_text:
                logger.warning(f"⚠️  Stream ended without completion status, sending {len(accumulated_text)} partial chunks")
                await self._safe_enqueue_event(
                    event_queue,
                    TaskArtifactUpdateEvent(
                        append=False,
                        context_id=task.context_id,
                        task_id=task.id,
                        lastChunk=True,
                        artifact=new_text_artifact(
                            name='partial_result',
                            description='Partial result from sub-agent (stream ended prematurely)',
                            text=" ".join(accumulated_text),
                        ),
                    )
                )
                await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                        status=TaskStatus(state=TaskState.completed),
                        final=True,
                        context_id=task.context_id,
                        task_id=task.id,
                    )
                )
                logger.info("🏁 Sub-agent streaming completed (with partial results)")
            else:
                logger.warning("⚠️  Stream ended without any results")
                raise Exception("Stream ended without receiving any results")

        except httpx.HTTPStatusError as e:
            # HTTP errors (503, 500, etc.) - these are recoverable, let caller handle fallback
            logger.error(f"❌ HTTP error streaming from sub-agent: {e.response.status_code} - {str(e)}")
            # Don't send failed status - let the caller decide whether to fall back to Deep Agent
            # Just re-raise so the caller can catch and fall back
            raise
        except httpx.RemoteProtocolError as e:
            # Connection closed prematurely (incomplete chunked read, etc.)
            logger.error(f"❌ Connection error streaming from sub-agent: {str(e)}")
            # If we got partial results, send them before re-raising
            if accumulated_text:
                logger.warning(f"⚠️  Sending {len(accumulated_text)} partial chunks before failing over")
                await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                        status=TaskStatus(
                            state=TaskState.working,
                            message=new_agent_text_message(
                                f"Connection lost, falling back to alternative method...",
                                task.context_id,
                                task.id,
                            ),
                        ),
                        final=False,
                        context_id=task.context_id,
                        task_id=task.id,
                    )
                )
            raise
        except Exception as e:
            # Other unexpected errors
            logger.error(f"❌ Unexpected error streaming from sub-agent: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            raise
        finally:
            await httpx_client.aclose()

    def _extract_text_from_artifact(self, artifact) -> str:
        """Extract text content from an A2A artifact."""
        texts = []
        parts = getattr(artifact, "parts", None)
        if parts:
            for part in parts:
                root = getattr(part, "root", None)
                text = getattr(root, "text", None) if root is not None else None
                if text:
                    texts.append(text)
        return " ".join(texts)

    async def _stream_from_multiple_agents(
        self,
        agents: List[Tuple[str, str]],
        query: str,
        task: A2ATask,
        event_queue: EventQueue,
        trace_id: Optional[str] = None
    ) -> None:
        """
        Stream from multiple sub-agents in parallel.
        Results are aggregated and streamed to the client with source annotations.

        Args:
            agents: List of (agent_name, agent_url) tuples
            query: The user query
            task: The A2A task
            event_queue: Queue for sending events to client
            trace_id: Optional trace ID for debugging
        """
        logger.info(f"🌊🌊 Parallel streaming from {len(agents)} sub-agents")

        # Send initial status
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(
                    state=TaskState.working,
                    message=new_agent_text_message(
                        f"Fetching data from {', '.join([name for name, _ in agents])}...",
                        task.context_id,
                        task.id,
                    ),
                ),
                final=False,
                context_id=task.context_id,
                task_id=task.id,
            )
        )

        # Create tasks for parallel execution
        async def stream_single_agent(agent_name: str, agent_url: str) -> Dict[str, any]:
            """Stream from a single agent and collect results"""
            logger.info(f"🔄 Starting stream from {agent_name}")
            httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))
            accumulated_text = []

            try:
                # Fetch agent card
                resolver = A2ACardResolver(httpx_client=httpx_client, base_url=agent_url)
                agent_card = await resolver.get_agent_card()

                # Override agent card URL
                agent_card.url = agent_url

                # Create A2A client
                client = A2AClient(httpx_client=httpx_client, agent_card=agent_card)

                # Prepare message
                message_payload = {
                    "message": {
                        "role": "user",
                        "parts": [{"kind": "text", "text": query}],
                        "messageId": str(uuid.uuid4()),
                    }
                }

                if trace_id:
                    message_payload["message"]["metadata"] = {"trace_id": trace_id}

                streaming_request = SendStreamingMessageRequest(
                    id=str(uuid.uuid4()),
                    params=MessageSendParams(**message_payload),
                )

                # Stream and collect results
                async for response_wrapper in client.send_message_streaming(streaming_request):
                    response_dict = response_wrapper.model_dump()
                    result_data = response_dict.get('result', {})
                    event_kind = result_data.get('kind', '')

                    # Handle artifact-update events (incremental chunks)
                    if event_kind == 'artifact-update':
                        artifact_data = result_data.get('artifact', {})
                        parts_data = artifact_data.get('parts', [])

                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content:
                                    accumulated_text.append(text_content)
                                    logger.debug(f"  {agent_name}: collected {len(text_content)} chars")

                    # Handle status-update with completed state (final artifact might be here)
                    elif event_kind == 'status-update':
                        status_data = result_data.get('status', {})
                        state = status_data.get('state', '')

                        if state == 'completed':
                            # Some agents send final artifact in status-update
                            # Try to extract any remaining content
                            logger.debug(f"  {agent_name}: received completed status")

                result_text = ''.join(accumulated_text)
                logger.info(f"✅ {agent_name} completed: {len(result_text)} chars (from {len(accumulated_text)} chunks)")

                return {
                    "agent_name": agent_name,
                    "status": "success",
                    "content": result_text,
                    "error": None
                }

            except Exception as e:
                logger.error(f"❌ Error streaming from {agent_name}: {e}")
                return {
                    "agent_name": agent_name,
                    "status": "error",
                    "content": "",
                    "error": str(e)
                }
            finally:
                await httpx_client.aclose()

        # Execute all streams in parallel
        tasks_list = [stream_single_agent(name, url) for name, url in agents]
        results = await asyncio.gather(*tasks_list, return_exceptions=True)

        # Aggregate and send results
        combined_output = []
        successful_agents = []
        failed_agents = []

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                agent_name = agents[i][0]
                failed_agents.append(agent_name)
                combined_output.append(f"\n## ❌ {agent_name.upper()} Error\n\n{str(result)}\n")
                logger.warning(f"Agent {agent_name} failed with exception: {result}")
            elif result.get("status") == "success":
                agent_name = result["agent_name"]
                content = result.get("content", "")

                if content and content.strip():
                    # Add source annotation with content
                    combined_output.append(f"\n## 📊 {agent_name.upper()} Results\n\n{content}\n")
                    successful_agents.append(agent_name)
                    logger.info(f"Agent {agent_name} returned {len(content)} chars")
                else:
                    # Agent succeeded but returned empty content
                    combined_output.append(f"\n## 📊 {agent_name.upper()} Results\n\n_No results returned_\n")
                    successful_agents.append(f"{agent_name} (empty)")
                    logger.warning(f"Agent {agent_name} completed but returned no content")
            else:
                agent_name = result.get("agent_name", "Unknown")
                error = result.get("error", "Unknown error")
                failed_agents.append(agent_name)
                combined_output.append(f"\n## ❌ {agent_name.upper()} Error\n\n{error}\n")
                logger.warning(f"Agent {agent_name} failed: {error}")

        final_text = "".join(combined_output)

        logger.info(f"📊 Aggregation complete: {len(successful_agents)} successful, {len(failed_agents)} failed")
        logger.info(f"   Success: {', '.join(successful_agents)}")
        if failed_agents:
            logger.info(f"   Failed: {', '.join(failed_agents)}")

        # Generate descriptive title for the artifact
        agent_names = [name for name, _ in agents]
        artifact_name = f"Multi-Agent Results: {', '.join(agent_names)}"
        artifact_description = f"Parallel execution results from {len(agents)} agents: {', '.join(agent_names)}"

        logger.info(f"📦 Sending aggregated results ({len(final_text)} chars total)")

        # Send final aggregated result
        await self._safe_enqueue_event(
            event_queue,
            TaskArtifactUpdateEvent(
                append=False,
                context_id=task.context_id,
                task_id=task.id,
                lastChunk=True,
                artifact=new_text_artifact(
                    name=artifact_name,
                    description=artifact_description,
                    text=final_text,
                ),
            )
        )

        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(state=TaskState.completed),
                final=True,
                context_id=task.context_id,
                task_id=task.id,
            )
        )

        logger.info(f"🎉 Parallel streaming completed from {len(agents)} agents")

    async def _safe_enqueue_event(self, event_queue: EventQueue, event) -> None:
        """Safely enqueue an event, handling closed queue gracefully."""
        try:
            await event_queue.enqueue_event(event)
        except Exception as e:
            # Check if the error is related to queue being closed
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                logger.warning(f"Queue is closed, cannot enqueue event: {type(event).__name__}")
                # Don't re-raise the exception for closed queue - this is expected during shutdown
            else:
                logger.error(f"Failed to enqueue event {type(event).__name__}: {e}")
                raise

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = context.get_user_input()
        task = context.current_task
        context_id = context.message.context_id if context.message else None

        if not context.message:
          raise Exception('No message provided')

        if not task:
            task = new_task(context.message)
            if not task:
                raise Exception("Failed to create a new task from the provided message.")
            await self._safe_enqueue_event(event_queue, task)

        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)

        # Enhanced trace_id extraction - check multiple locations
        if not trace_id and context and context.message:
            # Try additional extraction methods for evaluation requests
            logger.info("🔍 Platform Engineer Executor: No trace_id from extract_trace_id_from_context, checking alternatives")

            # Check if there's metadata in the message
            if hasattr(context.message, 'metadata') and context.message.metadata:
                if isinstance(context.message.metadata, dict):
                    trace_id = context.message.metadata.get('trace_id')
                    if trace_id:
                        logger.info(f"🔍 Platform Engineer Executor: Found trace_id in message.metadata: {trace_id}")

            # Check if there's a params object with metadata
            if not trace_id and hasattr(context, 'params') and context.params:
                if hasattr(context.params, 'metadata') and context.params.metadata:
                    if isinstance(context.params.metadata, dict):
                        trace_id = context.params.metadata.get('trace_id')
                        if trace_id:
                            logger.info(f"🔍 Platform Engineer Executor: Found trace_id in params.metadata: {trace_id}")
        if not trace_id:
            # Platform engineer is the ROOT supervisor - generate trace_id
            # Langfuse requires 32 lowercase hex chars (no dashes)
            trace_id = str(uuid.uuid4()).replace('-', '').lower()
            logger.info(f"🔍 Platform Engineer Executor: Generated ROOT trace_id: {trace_id}")
        else:
            logger.info(f"🔍 Platform Engineer Executor: Using trace_id from context: {trace_id}")

        # ENHANCED ROUTING: Determine optimal execution strategy (FEATURE FLAG CONTROLLED)
        # When ENABLE_ENHANCED_STREAMING=true:
        #   - DIRECT: Single sub-agent → direct streaming (fast path)
        #   - PARALLEL: Multiple sub-agents → parallel streaming (efficient aggregation)
        #   - COMPLEX: Needs orchestration → Deep Agent (intelligent reasoning)
        # When ENABLE_ENHANCED_STREAMING=false:
        #   - All queries go through Deep Agent (original behavior)
        if self.enhanced_streaming_enabled:
            routing = self._route_query(query)
            logger.info(f"🎯 Routing decision: {routing.type.value} - {routing.reason}")

            # Handle DIRECT streaming (single sub-agent, fast path)
            if routing.type == RoutingType.DIRECT:
                agent_name, agent_url = routing.agents[0]
                logger.info(f"🚀 DIRECT MODE: Streaming from {agent_name} at {agent_url}")
                try:
                    await self._stream_from_sub_agent(agent_url, query, task, event_queue, trace_id)
                    return
                except Exception as e:
                    logger.warning(f"⚠️  Direct streaming failed: {str(e)[:100]}")
                    logger.info("🔄 Falling back to Deep Agent for intelligent orchestration")
                    # Fall through to Deep Agent (no need to notify user, just continue)

            # Handle PARALLEL streaming (multiple sub-agents)
            elif routing.type == RoutingType.PARALLEL:
                agent_names = [name for name, _ in routing.agents]
                logger.info(f"🌊 PARALLEL MODE: Streaming from {', '.join(agent_names)}")
                try:
                    await self._stream_from_multiple_agents(routing.agents, query, task, event_queue, trace_id)
                    return
                except Exception as e:
                    logger.warning(f"⚠️  Parallel streaming failed: {str(e)[:100]}")
                    logger.info("🔄 Falling back to Deep Agent for intelligent orchestration")
                    # Fall through to Deep Agent (no need to notify user, just continue)

            # COMPLEX mode falls through to Deep Agent naturally
        else:
            logger.info("🎛️  Enhanced streaming disabled, using Deep Agent for all queries")

        try:
            # invoke the underlying agent, using streaming results
            async for event in self.agent.stream(query, context_id, trace_id):
                # Handle typed A2A events directly
                if isinstance(event, (A2ATaskArtifactUpdateEvent, A2ATaskStatusUpdateEvent)):
                    logger.debug(f"Executor: Enqueuing streamed A2A event: {type(event).__name__}")
                    await self._safe_enqueue_event(event_queue, event)
                    continue
                elif isinstance(event, A2AMessage):
                    logger.debug("Executor: Converting A2A Message to TaskStatusUpdateEvent (working)")
                    text_content = ""
                    parts = getattr(event, "parts", None)
                    if parts:
                        texts = []
                        for part in parts:
                            root = getattr(part, "root", None)
                            txt = getattr(root, "text", None) if root is not None else None
                            if txt:
                                texts.append(txt)
                        text_content = " ".join(texts)
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.working,
                                message=new_agent_text_message(
                                    text_content or "(streamed message)",
                                    task.context_id,
                                    task.id,
                                ),
                            ),
                            final=False,
                            context_id=task.context_id,
                            task_id=task.id,
                        )
                    )
                    continue
                elif isinstance(event, A2ATask):
                    logger.debug("Executor: Received A2A Task event; enqueuing.")
                    await self._safe_enqueue_event(event_queue, event)
                    continue
                # Normalize content to string (handle cases where AWS Bedrock returns list)
                # This is due to AWS Bedrock having a different format for the content for streaming compared to Azure OpenAI.
                content = event.get('content', '')
                if isinstance(content, list):
                    # If content is a list (AWS Bedrock), extract text from content blocks
                    text_parts = []
                    for item in content:
                        if isinstance(item, dict):
                            # Extract text from Bedrock content block: {"type": "text", "text": "..."}
                            text_parts.append(item.get('text', ''))
                        elif isinstance(item, str):
                            text_parts.append(item)
                        else:
                            text_parts.append(str(item))
                    content = ''.join(text_parts)
                elif not isinstance(content, str):
                    content = str(content) if content else ''

                if event['is_task_complete']:
                  logger.info("Task complete event received. Enqueuing TaskArtifactUpdateEvent and TaskStatusUpdateEvent.")
                  await self._safe_enqueue_event(
                    event_queue,
                    TaskArtifactUpdateEvent(
                      append=False,
                      context_id=task.context_id,
                      task_id=task.id,
                      lastChunk=True,
                      artifact=new_text_artifact(
                        name='current_result',
                        description='Result of request to agent.',
                        text=content,
                      ),
                    )
                  )
                  await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                      status=TaskStatus(state=TaskState.completed),
                      final=True,
                      context_id=task.context_id,
                      task_id=task.id,
                    )
                  )
                  logger.info(f"Task {task.id} marked as completed.")
                elif event['require_user_input']:
                  logger.info("User input required event received. Enqueuing TaskStatusUpdateEvent with input_required state.")
                  await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                      status=TaskStatus(
                        state=TaskState.input_required,
                        message=new_agent_text_message(
                          content,
                          task.context_id,
                          task.id,
                        ),
                      ),
                      final=True,
                      context_id=task.context_id,
                      task_id=task.id,
                    )
                  )
                  logger.info(f"Task {task.id} requires user input.")
                else:
                  logger.debug("Working event received. Enqueuing TaskStatusUpdateEvent with working state.")
                  await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                      status=TaskStatus(
                        state=TaskState.working,
                        message=new_agent_text_message(
                          content,
                          task.context_id,
                          task.id,
                        ),
                      ),
                      final=False,
                      context_id=task.context_id,
                      task_id=task.id,
                    )
                  )
                  logger.debug(f"Task {task.id} is in progress.")
        except Exception as e:
            logger.error(f"Error during agent execution: {e}")
            # Try to enqueue a failure status if the queue is still open
            try:
                await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                        status=TaskStatus(
                            state=TaskState.failed,
                            message=new_agent_text_message(
                                f"Agent execution failed: {str(e)}",
                                task.context_id,
                                task.id,
                            ),
                        ),
                        final=True,
                        context_id=task.context_id,
                        task_id=task.id,
                    )
                )
            except Exception as enqueue_error:
                logger.error(f"Failed to enqueue error status: {enqueue_error}")
            raise

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')