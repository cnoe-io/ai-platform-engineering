# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import re
import httpx
import asyncio
import os
import ast
import json
from typing import Optional, Tuple, List, Dict, Any
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
    Artifact,
    Part,
    DataPart,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding
)
from ai_platform_engineering.multi_agents.platform_engineer import platform_registry
from cnoe_agent_utils.tracing import extract_trace_id_from_context

logger = logging.getLogger(__name__)


def new_data_artifact(name: str, description: str, data: dict, artifact_id: str = None) -> Artifact:
    """
    Create a new A2A Artifact with structured JSON data using DataPart.

    This is used for responses that follow a schema (like PlatformEngineerResponse)
    where the client should receive native structured data instead of text.

    Args:
        name: Artifact name (e.g., 'final_result')
        description: Human-readable description
        data: Structured JSON data (dict)
        artifact_id: Optional artifact ID (generated if not provided)

    Returns:
        Artifact with DataPart
    """
    return Artifact(
        artifact_id=artifact_id or str(uuid.uuid4()),
        name=name,
        description=description,
        parts=[Part(root=DataPart(data=data))]
    )


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

        # TODO-based execution plan state
        self._execution_plan_emitted = False
        self._execution_plan_artifact_id = None
        self._latest_execution_plan: list[dict[str, str]] = []

        # Feature flags for different routing approaches
        # Default to DEEP_AGENT_PARALLEL_ORCHESTRATION mode (best performance: 4.94s avg, 29% faster than ENHANCED_STREAMING)
        self.enhanced_streaming_enabled = os.getenv('ENABLE_ENHANCED_STREAMING', 'false').lower() == 'true'
        self.force_deep_agent_orchestration = os.getenv('FORCE_DEEP_AGENT_ORCHESTRATION', 'true').lower() == 'true'
        self.enhanced_orchestration_enabled = os.getenv('ENABLE_ENHANCED_ORCHESTRATION', 'false').lower() == 'true'

        # Determine routing mode based on flags (priority order)
        if self.enhanced_orchestration_enabled:
            self.routing_mode = "DEEP_AGENT_ENHANCED_ORCHESTRATION"
            logger.info("🎛️  Routing Mode: DEEP_AGENT_ENHANCED_ORCHESTRATION - Smart routing + orchestration hints (EXPERIMENTAL)")
        elif self.force_deep_agent_orchestration:
            self.routing_mode = "DEEP_AGENT_PARALLEL_ORCHESTRATION"
            logger.debug("🎛️  Routing Mode: DEEP_AGENT_PARALLEL_ORCHESTRATION - All queries via Deep Agent with parallel orchestration (DEFAULT - best performance)")
        elif self.enhanced_streaming_enabled:
            self.routing_mode = "DEEP_AGENT_INTELLIGENT_ROUTING"
            logger.info("🎛️  Routing Mode: DEEP_AGENT_INTELLIGENT_ROUTING - Intelligent routing (DIRECT/PARALLEL/COMPLEX)")
        else:
            self.routing_mode = "DEEP_AGENT_SEQUENTIAL_ORCHESTRATION"
            logger.info("🎛️  Routing Mode: DEEP_AGENT_SEQUENTIAL_ORCHESTRATION - All queries via Deep Agent (original behavior)")

        # Configurable routing keywords via environment variables
        self.knowledge_base_keywords = self._parse_env_keywords(
            'KNOWLEDGE_BASE_KEYWORDS',
            'docs:,@docs'  # Default: docs: or @docs prefix
        )
        self.orchestration_keywords = self._parse_env_keywords(
            'ORCHESTRATION_KEYWORDS',
            'analyze,compare,if,then,create,update,based on,depending on,which,that have'
        )

        logger.debug(f"📚 Knowledge base keywords: {self.knowledge_base_keywords}")
        logger.debug(f"🔧 Orchestration keywords: {self.orchestration_keywords}")

    def _parse_env_keywords(self, env_var: str, default: str) -> List[str]:
        """Parse comma-separated keywords from environment variable."""
        keywords_str = os.getenv(env_var, default)
        keywords = [kw.strip() for kw in keywords_str.split(',') if kw.strip()]
        return keywords

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

        logger.info("🔍 No sub-agent detected in query")
        return None

    def _route_query(self, query: str) -> RoutingDecision:
        """
        Enhanced routing logic to determine query execution strategy.

        Returns:
            RoutingDecision with type (DIRECT/PARALLEL/COMPLEX) and target agents

        Examples:
            - "show me komodor clusters" → DIRECT (komodor - explicit mention)
            - "list github repos and komodor clusters" → PARALLEL (github + komodor - explicit mentions)
            - "analyze clusters and create jira tickets" → COMPLEX (needs Deep Agent orchestration)
            - "who is on call for SRE" → COMPLEX (no explicit agent - Deep Agent will route to PagerDuty + RAG)
        """
        query_lower = query.lower()
        available_agents = platform_registry.AGENT_ADDRESS_MAPPING

        # Check for explicit knowledge base queries (direct to RAG)
        # Use configurable keywords for knowledge base requests
        is_knowledge_base_query = any(
            query_lower.startswith(keyword.lower()) for keyword in self.knowledge_base_keywords
        )

        if is_knowledge_base_query:
            # Direct route to RAG agent for knowledge base queries
            rag_agent_url = available_agents.get('RAG')
            if rag_agent_url:
                logger.info("🎯 Knowledge base query detected, routing directly to RAG")
                return RoutingDecision(
                    type=RoutingType.DIRECT,
                    agents=[('RAG', rag_agent_url)],
                    reason=f"Knowledge base query (matched: {[k for k in self.knowledge_base_keywords if query_lower.startswith(k.lower())][0]}) - direct to RAG"
                )

        # Detect explicitly mentioned agents (by name only)
        # Let Deep Agent handle semantic routing for all other cases
        mentioned_agents = []

        # Check direct agent name mentions
        for agent_name, agent_url in available_agents.items():
            agent_name_lower = agent_name.lower()
            if agent_name_lower in query_lower:
                if (agent_name, agent_url) not in mentioned_agents:
                    mentioned_agents.append((agent_name, agent_url))
                    logger.info(f"🔍 Explicit agent mention: '{agent_name_lower}' → {agent_name}")

        logger.info(f"🎯 Routing analysis: found {len(mentioned_agents)} explicit agent mentions")

        # Routing logic
        # - Knowledge base keywords → Direct to RAG (fast path)
        # - No explicit agents → Deep Agent (handles semantic routing + RAG)
        # - One explicit agent → Direct streaming (fast path)
        # - Multiple explicit agents → Parallel or Deep Agent (depends on complexity)

        if len(mentioned_agents) == 0:
            # No explicit agents mentioned - use Deep Agent for intelligent routing
            # Deep Agent will decide which agents/RAG to query based on the improved prompt
            return RoutingDecision(
                type=RoutingType.COMPLEX,
                agents=[],
                reason="No explicit agents mentioned, using Deep Agent for intelligent routing"
            )

        elif len(mentioned_agents) == 1:
            # Single explicit agent mention, use direct streaming (fast path)
            agent_name, agent_url = mentioned_agents[0]
            return RoutingDecision(
                type=RoutingType.DIRECT,
                agents=mentioned_agents,
                reason=f"Direct streaming from {agent_name}"
            )

        else:
            # Multiple explicit agents mentioned
            # Check if query requires orchestration using configurable keywords
            needs_orchestration = any(keyword.lower() in query_lower for keyword in self.orchestration_keywords)

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
                "message_id": str(uuid.uuid4()),
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
            first_artifact_sent = False  # Track if we've sent the initial artifact
            sub_agent_streaming_artifact_id = None  # Shared artifact ID for sub-agent streaming chunks
            sub_agent_sent_complete_result = False  # Track if sub-agent sent complete_result (task is complete)
            sub_agent_accumulated_content = []  # Track content from sub-agent artifacts
            logger.debug(f"🔄 _stream_from_sub_agent: Starting stream loop for sub-agent at {agent_url}")
            logger.debug(f"🔄 _stream_from_sub_agent: Initial state - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content)}")

            async for response_wrapper in client.send_message_streaming(streaming_request):
                chunk_count += 1
                wrapper_type = type(response_wrapper).__name__
                logger.debug(f"📦 _stream_from_sub_agent: Received stream response #{chunk_count}: {wrapper_type}")

                # Extract event data from Pydantic response model
                try:
                    response_dict = response_wrapper.model_dump()
                    result_data = response_dict.get('result', {})
                    event_kind = result_data.get('kind', '')
                    logger.debug(f"📦 _stream_from_sub_agent: Event #{chunk_count} kind={event_kind}")

                    # Handle artifact-update events (these contain the streaming content!)
                    if event_kind == 'artifact-update':
                        artifact_data = result_data.get('artifact', {})
                        artifact_name = artifact_data.get('name', 'streaming_result')
                        parts_data = artifact_data.get('parts', [])

                        logger.debug(f"📦 _stream_from_sub_agent: Received artifact-update, name={artifact_name}, chunk_count={chunk_count}")

                        # Handle complete_result/final_result - accumulate but don't forward as streaming_result
                        if artifact_name in ['complete_result', 'final_result']:
                            # Mark that sub-agent sent complete_result (task is complete)
                            sub_agent_sent_complete_result = True
                            logger.debug(f"✅ Sub-agent sent {artifact_name} - task is complete, accumulating for complete_result")

                            # Extract and accumulate the content
                            texts = []
                            for part in parts_data:
                                if isinstance(part, dict):
                                    text_content = part.get('text', '')
                                    if text_content:
                                        texts.append(text_content)

                            combined_text = ''.join(texts)
                            if combined_text:
                                sub_agent_accumulated_content.append(combined_text)
                                logger.debug(f"📝 Accumulated sub-agent {artifact_name}: {len(combined_text)} chars in _stream_from_sub_agent")
                            else:
                                logger.warning(f"⚠️ {artifact_name} has no text content!")

                            # Skip forwarding as streaming_result - will be sent as complete_result at end
                            logger.debug(f"⏭️ Skipping forwarding {artifact_name} as streaming_result - will be sent as complete_result at end")
                            continue

                        # Extract text from parts
                        texts = []
                        for part in parts_data:
                            if isinstance(part, dict):
                                text_content = part.get('text', '')
                                if text_content:
                                    texts.append(text_content)

                        combined_text = ''.join(texts)
                        if combined_text:
                            logger.debug(f"📝 Extracted {len(combined_text)} chars from artifact")
                            accumulated_text.append(combined_text)

                            # A2A protocol: first artifact must have append=False to create it
                            # Subsequent artifacts use append=True to append to existing artifact
                            if not first_artifact_sent:
                                # First chunk - create new artifact with unique ID
                                artifact = new_text_artifact(
                                    name='streaming_result',
                                    description='Streaming result from sub-agent',
                                    text=combined_text,
                                )
                                sub_agent_streaming_artifact_id = artifact.artifact_id
                                first_artifact_sent = True
                                use_append = False
                                logger.debug(f"📝 Sending FIRST artifact (append=False) with ID: {sub_agent_streaming_artifact_id}")
                            else:
                                # Subsequent chunks - reuse the same artifact ID
                                artifact = new_text_artifact(
                                    name='streaming_result',
                                    description='Streaming result from sub-agent',
                                    text=combined_text,
                                )
                                artifact.artifact_id = sub_agent_streaming_artifact_id
                                use_append = True
                                logger.debug(f"📝 Appending to existing artifact (append=True) with ID: {sub_agent_streaming_artifact_id}")

                            # Forward chunk immediately to client (streaming!)
                            #
# Add small delay after first artifact to ensure it's registered
                            # before subsequent append operations (prevents A2A SDK warnings)
                            if use_append is False:
                                await self._safe_enqueue_event(
                                    event_queue,
                                    TaskArtifactUpdateEvent(
                                        append=use_append,
                                        context_id=task.context_id,
                                        task_id=task.id,
                                        last_chunk=False,
                                        artifact=artifact,
                                    )
                                )
                                # Small delay to ensure artifact is registered in A2A SDK
                                await asyncio.sleep(0.01)  # 10ms
                                logger.debug(f"✅ Streamed FIRST chunk to client (with 10ms buffer): {combined_text[:50]}...")
                            else:
                                await self._safe_enqueue_event(
                                    event_queue,
                                    TaskArtifactUpdateEvent(
                                        append=use_append,
                                        context_id=task.context_id,
                                        task_id=task.id,
                                        last_chunk=False,
                                        artifact=artifact,
                                    )
                                )
                                logger.debug(f"✅ Streamed chunk to client: {combined_text[:50]}...")

                    # Handle status-update events (task completion and content)
                    elif event_kind == 'status-update':
                        status_data = result_data.get('status', {})
                        state = status_data.get('state', '')
                        final = result_data.get('final', False)
                        logger.debug(f"📊 _stream_from_sub_agent: Status update #{chunk_count} - state={state}, final={final}")

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
                            logger.debug(f"📝 Extracted {len(combined_text)} chars from status message")
                            accumulated_text.append(combined_text)

                            # A2A protocol: first artifact must have append=False to create it
                            if not first_artifact_sent:
                                # First chunk - create new artifact with unique ID
                                artifact = new_text_artifact(
                                    name='streaming_result',
                                    description='Streaming result from sub-agent',
                                    text=combined_text,
                                )
                                sub_agent_streaming_artifact_id = artifact.artifact_id
                                first_artifact_sent = True
                                use_append = False
                                logger.debug(f"📝 Sending FIRST artifact (append=False) from status message with ID: {sub_agent_streaming_artifact_id}")
                            else:
                                # Subsequent chunks - reuse the same artifact ID
                                artifact = new_text_artifact(
                                    name='streaming_result',
                                    description='Streaming result from sub-agent',
                                    text=combined_text,
                                )
                                artifact.artifact_id = sub_agent_streaming_artifact_id
                                use_append = True
                                logger.debug(f"📝 Appending status content to artifact (append=True) with ID: {sub_agent_streaming_artifact_id}")

                            # Forward status message content to client
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=use_append,  # First: False (create), subsequent: True (append)
                                    context_id=task.context_id,
                                    task_id=task.id,
                                    last_chunk=False,
                                    artifact=artifact,
                                )
                            )
                            logger.debug(f"✅ Streamed status content to client: {combined_text[:50]}...")

                        if state == 'completed':
                            logger.debug(f"🎉 _stream_from_sub_agent: Sub-agent completed with {chunk_count} chunks")
                            logger.debug(f"🎉 _stream_from_sub_agent: State at completion - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content)}")
                            # Send final artifact with complete accumulated text
                            # For streaming clients: redundant but safe (they already got chunks)
                            # For non-streaming clients: essential (only way to get complete text)
                            final_text = ''.join(accumulated_text)
                            logger.debug(f"📦 _stream_from_sub_agent: Sending final artifact with {len(final_text)} chars")
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=False,
                                    context_id=task.context_id,
                                    task_id=task.id,
                                    last_chunk=True,
                                    artifact=new_text_artifact(
                                        name='final_result',
                                        description='Complete result from sub-agent',
                                        text=final_text,  # Complete accumulated text for non-streaming clients
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

            # Stream loop exited
            logger.debug(f"🔄 _stream_from_sub_agent: Stream loop exited after {chunk_count} chunks")
            logger.debug(f"🔄 _stream_from_sub_agent: Final state - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content)}, accumulated_text_len={len(accumulated_text)}")

            # If we exit the loop without receiving 'completed' status, stream ended prematurely
            # Send any accumulated text as final result
            if accumulated_text:
                logger.warning(f"⚠️  _stream_from_sub_agent: Stream ended without completion status, sending {len(accumulated_text)} partial chunks")
                logger.warning(f"⚠️  _stream_from_sub_agent: sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content)}")
                await self._safe_enqueue_event(
                    event_queue,
                    TaskArtifactUpdateEvent(
                        append=False,
                        context_id=task.context_id,
                        task_id=task.id,
                        last_chunk=True,
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
                                "Connection lost, falling back to alternative method...",
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
                "message_id": str(uuid.uuid4()),
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

    # _clean_json_wrapper() method removed - Frontend now handles JSON parsing
    # to support structured metadata and dynamic form generation

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
        # Reset TODO-based execution plan state for new task
        self._execution_plan_emitted = False
        self._execution_plan_artifact_id = None
        self._latest_execution_plan = []

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
            logger.debug("🔍 Platform Engineer Executor: No trace_id from extract_trace_id_from_context, checking alternatives")

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
            logger.debug(f"🔍 Platform Engineer Executor: Generated ROOT trace_id: {trace_id}")
        else:
            logger.info(f"🔍 Platform Engineer Executor: Using trace_id from context: {trace_id}")

        # ROUTING STRATEGY: Determine execution path based on routing mode
        # DEEP_AGENT_ENHANCED_ORCHESTRATION: Smart routing + orchestration hints (EXPERIMENTAL)
        # DEEP_AGENT_PARALLEL_ORCHESTRATION: All via Deep Agent with parallel orchestration hints
        # DEEP_AGENT_INTELLIGENT_ROUTING: Intelligent routing (DIRECT/PARALLEL/COMPLEX)
        # DEEP_AGENT_SEQUENTIAL_ORCHESTRATION: All via Deep Agent (original behavior)

        if self.routing_mode == "DEEP_AGENT_ENHANCED_ORCHESTRATION":
            # NEW EXPERIMENTAL MODE: Combines smart routing with orchestration hints
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
                    logger.info("🔄 Falling back to Deep Agent with orchestration hints")
                    # Fall through to Deep Agent WITH orchestration hints (key improvement)

            # Handle PARALLEL streaming (multiple sub-agents)
            elif routing.type == RoutingType.PARALLEL:
                agent_names = [name for name, _ in routing.agents]
                logger.info(f"🌊 PARALLEL MODE: Streaming from {', '.join(agent_names)}")
                try:
                    await self._stream_from_multiple_agents(routing.agents, query, task, event_queue, trace_id)
                    return
                except Exception as e:
                    logger.warning(f"⚠️  Parallel streaming failed: {str(e)[:100]}")
                    logger.info("🔄 Falling back to Deep Agent with orchestration hints")
                    # Fall through to Deep Agent WITH orchestration hints (key improvement)

            # COMPLEX mode OR fallback from DIRECT/PARALLEL failures
            # ADD ORCHESTRATION HINTS (this is the key innovation)
            logger.info("🧠 ENHANCED_ORCHESTRATION: Adding orchestration hints to Deep Agent")

            # Analyze query to provide orchestration hints (logging only - agent.stream() doesn't accept config)
            available_agents = platform_registry.AGENT_ADDRESS_MAPPING
            mentioned_agents = []
            for agent_name, agent_url in available_agents.items():
                if agent_name.lower() in query.lower():
                    mentioned_agents.append(agent_name)

            if mentioned_agents:
                logger.info(f"🤖 Detected agents in query for enhanced orchestration: {mentioned_agents}")
            else:
                logger.info("🤖 No specific agents detected - Deep Agent will determine best orchestration strategy")

            # Continue to Deep Agent execution below (with orchestration hints now added)

        elif self.routing_mode == "DEEP_AGENT_INTELLIGENT_ROUTING":
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

        elif self.routing_mode == "DEEP_AGENT_PARALLEL_ORCHESTRATION":
            # Force all queries through Deep Agent with parallel orchestration hints
            logger.info("🎛️  DEEP_AGENT_PARALLEL_ORCHESTRATION mode: Routing to Deep Agent with parallel orchestration hints")

            # Analyze query to provide orchestration hints in logs
            available_agents = platform_registry.AGENT_ADDRESS_MAPPING
            mentioned_agents = []
            for agent_name, agent_url in available_agents.items():
                if agent_name.lower() in query.lower():
                    mentioned_agents.append(agent_name)

            if mentioned_agents:
                logger.info(f"🤖 Detected agents in query for parallel orchestration: {mentioned_agents}")

        else:  # DEEP_AGENT_ONLY
            logger.info("🎛️  DEEP_AGENT_ONLY mode: All queries via Deep Agent (original behavior)")

        # Track streaming state for proper A2A protocol
        first_artifact_sent = False
        accumulated_content = []
        sub_agent_accumulated_content = []  # Track content from sub-agent artifacts
        sub_agent_sent_datapart = False  # Track if sub-agent sent structured DataPart
        sub_agent_datapart_data = None  # Store original DataPart data dict (for recreating DataPart artifacts)
        streaming_artifact_id = None  # Shared artifact ID for all streaming chunks
        sub_agent_sent_complete_result = False  # Track if sub-agent sent complete_result (task is complete)
        seen_artifact_ids = set()  # Track which artifact IDs have been sent (for append=False/True logic)
        try:
            # invoke the underlying agent, using streaming results
            # NOTE: Pass task to maintain task ID consistency across sub-agents
            async for event in self.agent.stream(query, context_id, trace_id):
                # Handle direct artifact payloads emitted by agent binding (e.g., write_todos execution plan)
                artifact_payload = event.get('artifact') if isinstance(event, dict) else None
                if artifact_payload:
                    artifact_name = artifact_payload.get('name', 'agent_artifact')
                    artifact_description = artifact_payload.get('description', 'Artifact from Platform Engineer')
                    artifact_text = artifact_payload.get('text', '')

                    artifact = new_text_artifact(
                        name=artifact_name,
                        description=artifact_description,
                        text=artifact_text,
                    )

                    # Track execution plan emission for retry logic / diagnostics
                    if artifact_name in ('execution_plan_update', 'execution_plan_status_update'):
                        self._execution_plan_emitted = True
                        if artifact_name == 'execution_plan_update':
                            self._execution_plan_artifact_id = artifact.artifact_id
                        parsed_plan = self._parse_execution_plan_text(artifact_text)
                        if parsed_plan:
                            self._latest_execution_plan = parsed_plan

                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            lastChunk=False,
                            artifact=artifact,
                        )
                    )
                    first_artifact_sent = True
                    continue

                # Handle typed A2A events - TRANSFORM APPEND FLAG FOR FORWARDED EVENTS
                if isinstance(event, (A2ATaskArtifactUpdateEvent, A2ATaskStatusUpdateEvent)):
                    logger.debug(f"Executor: Processing streamed A2A event: {type(event).__name__}")

                    # Fix forwarded TaskArtifactUpdateEvent to handle append flag correctly
                    if isinstance(event, A2ATaskArtifactUpdateEvent):
                        # Transform the event to use our first_artifact_sent logic
                        use_append = first_artifact_sent
                        if not first_artifact_sent:
                            first_artifact_sent = True
                            logger.debug("📝 Transforming FIRST forwarded artifact (append=False) to create artifact")
                        else:
                            logger.debug("📝 Transforming subsequent forwarded artifact (append=True)")

                        # Create new event with corrected append flag AND CORRECT TASK ID
                        transformed_event = TaskArtifactUpdateEvent(
                            append=use_append,  # First: False (create), subsequent: True (append)
                            context_id=event.context_id,
                            task_id=task.id,  # ✅ Use the ORIGINAL task ID from client, not sub-agent's task ID
                            lastChunk=event.lastChunk,
                            artifact=event.artifact
                        )
                        await self._safe_enqueue_event(event_queue, transformed_event)
                    else:
                        # Forward status events with corrected task ID
                        if isinstance(event, A2ATaskStatusUpdateEvent):
                            # Update the task ID to match the original client task
                            corrected_status_event = TaskStatusUpdateEvent(
                                context_id=event.context_id,
                                task_id=task.id,  # ✅ Use the ORIGINAL task ID from client
                                status=event.status
                            )
                            await self._safe_enqueue_event(event_queue, corrected_status_event)
                        else:
                            # Forward other events unchanged
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

                # Check if this is a custom event from writer() (e.g., sub-agent streaming via artifact-update)
                if isinstance(event, dict) and 'type' in event and event.get('type') == 'artifact-update':
                    # Custom artifact-update event from sub-agent (via writer() in a2a_remote_agent_connect.py)
                    result = event.get('result', {})
                    artifact = result.get('artifact')

                    if artifact:
                        # Extract text length for logging
                        parts = artifact.get('parts', [])
                        text_len = sum(len(p.get('text', '')) for p in parts if isinstance(p, dict))

                        # Accumulate sub-agent content for final result
                        artifact_name = artifact.get('name', 'streaming_result')
                        logger.debug(f"🎯 _handle_sub_agent_response: Received artifact-update from writer() - name={artifact_name}, text_len={text_len} chars, parts_count={len(parts)}")
                        logger.debug(f"🎯 _handle_sub_agent_response: State before processing - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content)}")

                        # Only accumulate final results (complete_result, final_result) - these contain clean, complete content
                        # Forward streaming_result chunks to client but DON'T accumulate (prevents duplication)
                        if artifact_name in ['complete_result', 'final_result']:
                            # Mark that sub-agent sent complete_result (task is complete)
                            sub_agent_sent_complete_result = True
                            logger.debug(f"✅ Sub-agent sent {artifact_name} - task is complete, will forward as complete_result")

                            # Only accumulate final results - these contain clean, complete content
                            for p in parts:
                                if isinstance(p, dict):
                                    logger.debug(f"🔍 Part keys: {list(p.keys())}")
                                    # Handle both TextPart and DataPart
                                    if p.get('text'):
                                        sub_agent_accumulated_content.append(p.get('text'))
                                        logger.debug(f"📝 Accumulated sub-agent final result: {len(p.get('text'))} chars (artifact={artifact_name})")
                                    elif p.get('data'):
                                        # DataPart with structured data - store original data dict
                                        data_dict = p.get('data')
                                        sub_agent_datapart_data = data_dict  # Store original data dict for recreating DataPart
                                        json_str = json.dumps(data_dict)
                                        sub_agent_accumulated_content.append(json_str)
                                        sub_agent_sent_datapart = True  # Mark that sub-agent sent structured data
                                        logger.debug(f"📝 Accumulated sub-agent DataPart: {len(json_str)} chars - MARKING sub_agent_sent_datapart=True, stored data dict with keys: {list(data_dict.keys()) if isinstance(data_dict, dict) else 'not a dict'}")

                                        # CRITICAL: Clear supervisor's accumulated content - we ONLY want the sub-agent's DataPart
                                        # The supervisor may have already streamed partial text before we received the DataPart
                                        if accumulated_content:
                                            logger.info(f"🗑️ CLEARING {len(accumulated_content)} supervisor content chunks - using ONLY sub-agent DataPart")
                                            accumulated_content.clear()
                                    else:
                                        logger.warning(f"⚠️ Part has neither 'text' nor 'data' key: {p}")
                        elif artifact_name == 'streaming_result':
                            # Forward streaming chunks to client but DON'T accumulate (prevents duplication from full-content chunks)
                            # Streaming chunks are for real-time display only, final results will be used for partial_result/final_result
                            total_chunk_size = sum(len(p.get('text', '')) for p in parts if isinstance(p, dict) and p.get('text'))
                            logger.debug(f"📤 Forwarding streaming_result chunk ({total_chunk_size} chars) - NOT accumulating (will use complete_result/final_result)")
                        elif artifact_name == 'partial_result':
                            # Partial result from sub-agent - accumulate it (it's a final result)
                            for p in parts:
                                if isinstance(p, dict):
                                    if p.get('text'):
                                        sub_agent_accumulated_content.append(p.get('text'))
                                        logger.debug(f"📝 Accumulated sub-agent partial_result: {len(p.get('text'))} chars")
                                    elif p.get('data'):
                                        # DataPart with structured data - store original data dict
                                        data_dict = p.get('data')
                                        sub_agent_datapart_data = data_dict  # Store original data dict for recreating DataPart
                                        json_str = json.dumps(data_dict)
                                        sub_agent_accumulated_content.append(json_str)
                                        sub_agent_sent_datapart = True
                                        logger.debug(f"📝 Accumulated sub-agent partial_result DataPart: {len(json_str)} chars, stored data dict")

                        # Convert dict to proper Artifact object - preserve both TextPart and DataPart
                        from a2a.types import Artifact, TextPart, DataPart, Part
                        artifact_parts = []
                        for p in parts:
                            if isinstance(p, dict):
                                if p.get('text'):
                                    artifact_parts.append(Part(root=TextPart(text=p.get('text'))))
                                elif p.get('data'):
                                    artifact_parts.append(Part(root=DataPart(data=p.get('data'))))
                                    logger.debug("📦 Forwarding DataPart to client")

                        artifact_obj = Artifact(
                            artifactId=artifact.get('artifactId'),
                            name=artifact_name,
                            description=artifact.get('description', 'Streaming from sub-agent'),
                            parts=artifact_parts
                        )

                        # Track each artifact ID separately for append flag
                        artifact_id = artifact.get('artifactId')
                        if artifact_id not in seen_artifact_ids:
                            # First time seeing this artifact ID - send with append=False
                            use_append = False
                            seen_artifact_ids.add(artifact_id)
                            first_artifact_sent = True  # Mark that we've sent at least one artifact
                            logger.debug(f"📝 Forwarding FIRST chunk of sub-agent artifact (append=False) with ID: {artifact_id}")
                        else:
                            # Subsequent chunks of this artifact ID - send with append=True
                            use_append = True
                            logger.debug(f"📝 Forwarding subsequent chunk of sub-agent artifact (append=True) with ID: {artifact_id}")

                        await self._safe_enqueue_event(
                            event_queue,
                            TaskArtifactUpdateEvent(
                                append=use_append,
                                context_id=task.context_id,
                                task_id=task.id,
                                lastChunk=result.get('lastChunk', False),
                                artifact=artifact_obj,
                            )
                        )
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

                logger.debug(f"🔍 EXECUTOR: Received event with is_task_complete={event.get('is_task_complete')}, require_user_input={event.get('require_user_input')}")

                if event['is_task_complete']:
                    await self._ensure_execution_plan_completed(event_queue, task)
                    logger.info("✅ EXECUTOR: Task complete event received! Enqueuing FINAL_RESULT artifact.")

                    # Send final artifact with all accumulated content for non-streaming clients
                    # Content selection strategy (PRIORITY ORDER):
                    # 1. If sub-agent sent DataPart: Use sub-agent's DataPart (has structured data like JarvisResponse)
                    # 2. Otherwise: Use sub-agent's content (backward compatible)

                    if sub_agent_sent_datapart and sub_agent_datapart_data:
                        # Sub-agent sent structured DataPart - recreate DataPart artifact (highest priority)
                        logger.debug("📦 Creating DataPart artifact for final_result - sub_agent_sent_datapart=True")
                        artifact = new_data_artifact(
                            name='final_result',
                            description='Complete structured result from Platform Engineer',
                            data=sub_agent_datapart_data,
                        )
                    elif sub_agent_accumulated_content:
                        # Fallback to sub-agent content
                        final_content = ''.join(sub_agent_accumulated_content)
                        logger.info(f"📝 Using sub-agent accumulated content for final_result ({len(final_content)} chars)")
                        artifact = new_text_artifact(
                            name='final_result',
                            description='Complete result from Platform Engineer.',
                            text=final_content,
                        )
                    elif accumulated_content:
                        # Fallback to supervisor content
                        final_content = ''.join(accumulated_content)
                        logger.info(f"📝 Using supervisor accumulated content for final_result ({len(final_content)} chars) - fallback")
                        artifact = new_text_artifact(
                            name='final_result',
                            description='Complete result from Platform Engineer.',
                            text=final_content,
                        )
                    else:
                        # Final fallback to current event content
                        final_content = content
                        logger.info(f"📝 Using current event content for final_result ({len(final_content)} chars)")
                        artifact = new_text_artifact(
                            name='final_result',
                            description='Complete result from Platform Engineer.',
                            text=final_content,
                        )

                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,  # Final artifact always creates new artifact
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=True,
                            artifact=artifact,
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
                    logger.info(f"Task {task.id} marked as completed with {len(final_content)} chars total.")
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
                    # This is a streaming chunk - forward it immediately to the client!
                    logger.debug(f"🔍 Processing streaming chunk: has_content={bool(content)}, content_length={len(content) if content else 0}")
                    if content:  # Only send artifacts with actual content
                       # Check if this is a tool notification (both metadata-based and content-based)
                       is_tool_notification = (
                           # Metadata-based tool notifications (from tool_call/tool_result events)
                           'tool_call' in event or 'tool_result' in event or
                           # Content-based tool notifications (from streamed text)
                           '🔍 Querying ' in content or
                           '🔍 Checking ' in content or
                           '🔧 Calling ' in content or
                           ('✅ ' in content and 'completed' in content.lower()) or
                           content.strip().startswith('🔍') or
                           content.strip().startswith('🔧') or
                           (content.strip().startswith('✅') and 'completed' in content.lower())
                       )

                       # Check if this is the final response event (contains full accumulated content)
                       # The final response from agent.py contains the full accumulated content, so we shouldn't accumulate it again
                       # to avoid duplication. We detect this deterministically by checking if accumulated content is a substring.
                       existing_accumulated_text = ''.join(accumulated_content) if accumulated_content else ''

                       # Deterministic check: if accumulated content is contained in this event's content, it's the final response
                       # The final response from agent.py contains the full accumulated content, so we shouldn't accumulate it again
                       # We check if accumulated content is a substring of this event's content (deterministic, no thresholds)
                       is_final_response_event = (
                           existing_accumulated_text and  # We have accumulated content to compare
                           existing_accumulated_text in content  # Accumulated content is contained in this event (deterministic substring check)
                       )

                       # Accumulate non-notification content for final UI response
                       # Streaming artifacts are for real-time display, final response for clean UI display
                       # CRITICAL: If sub-agent sent DataPart, DON'T accumulate supervisor's streaming text
                       # We want ONLY the sub-agent's structured response, not the supervisor's rewrite
                       # CRITICAL: Don't accumulate final response event content - it's already the full accumulated content
                       # CRITICAL: If we have sub-agent accumulated content, don't accumulate supervisor content that matches it (avoids duplicates)
                       # Deterministic check: if supervisor content is contained in sub-agent content (or vice versa), it's a duplicate
                       sub_agent_text_so_far = ''.join(sub_agent_accumulated_content) if sub_agent_accumulated_content else ''
                       is_duplicate_of_sub_agent = (
                           sub_agent_text_so_far and  # We have sub-agent content
                           (content in sub_agent_text_so_far or sub_agent_text_so_far in content)  # Content matches sub-agent content (deterministic substring check)
                       )

                       if not is_tool_notification and not is_final_response_event:
                           if not sub_agent_sent_datapart and not is_duplicate_of_sub_agent:
                               accumulated_content.append(content)
                               logger.debug(f"📝 Added content to final response accumulator: {content[:50]}...")
                           elif is_duplicate_of_sub_agent:
                               logger.debug(f"⏭️ SKIPPING supervisor content - duplicates sub-agent content: {content[:50]}...")
                           else:
                               logger.debug(f"⏭️ SKIPPING supervisor content - sub-agent sent DataPart (sub_agent_sent_datapart=True): {content[:50]}...")
                       elif is_final_response_event:
                           logger.debug(f"⏭️ SKIPPING final response event content (already accumulated) - length: {len(content)} chars, accumulated: {len(existing_accumulated_text)} chars")
                       else:
                           logger.debug(f"🔧 Skipping tool notification from final response: {content.strip()}")

                       # A2A protocol: first artifact must have append=False, subsequent use append=True
                       use_append = first_artifact_sent
                       logger.debug(f"🔍 first_artifact_sent={first_artifact_sent}, use_append={use_append}")

                       artifact_name = 'streaming_result'
                       artifact_description = 'Streaming result from Platform Engineer'

                       if is_tool_notification:
                           if 'tool_call' in event:
                               tool_info = event['tool_call']
                               artifact_name = 'tool_notification_start'
                               artifact_description = f'Tool call started: {tool_info.get("name", "unknown")}'
                               logger.debug(f"🔧 Tool call notification: {tool_info}")
                           elif 'tool_result' in event:
                               tool_info = event['tool_result']
                               artifact_name = 'tool_notification_end'
                               artifact_description = f'Tool call completed: {tool_info.get("name", "unknown")}'
                               logger.debug(f"✅ Tool result notification: {tool_info}")
                           else:
                              # Content-based tool notification
                              if ('✅' in content and 'completed' in content.lower()) or (content.strip().startswith('✅') and 'completed' in content.lower()):
                                  artifact_name = 'tool_notification_end'
                                  artifact_description = 'Tool operation completed'
                                  logger.debug(f"✅ Tool completion notification: {content.strip()}")
                              else:
                                  # Assume it's a start notification (🔍 Querying, 🔍 Checking, 🔧 Calling)
                                  artifact_name = 'tool_notification_start'
                                  artifact_description = 'Tool operation started'
                                  logger.debug(f"🔍 Tool start notification: {content.strip()}")

                       # Create shared artifact ID once for all streaming chunks
                       if is_tool_notification:
                           # Tool notifications always get their own artifact IDs
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           use_append = False
                           seen_artifact_ids.add(artifact.artifact_id)  # Track this tool notification artifact
                           logger.debug(f"📝 Creating separate tool notification artifact: {artifact.artifact_id}")
                       elif streaming_artifact_id is None:
                           # First regular content chunk - create new artifact with unique ID
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           streaming_artifact_id = artifact.artifact_id  # Save for subsequent chunks
                           seen_artifact_ids.add(streaming_artifact_id)  # Track this artifact ID
                           first_artifact_sent = True
                           use_append = False
                           logger.info(f"📝 Sending FIRST streaming artifact (append=False) with ID: {streaming_artifact_id}")
                       else:
                           # Subsequent regular content chunks - reuse the same artifact ID
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           artifact.artifact_id = streaming_artifact_id  # Use the same ID for regular chunks
                           use_append = True
                           logger.debug(f"📝 Appending streaming chunk (append=True) to artifact: {streaming_artifact_id}")

                       # Forward chunk immediately to client (STREAMING!)
                       await self._safe_enqueue_event(
                           event_queue,
                           TaskArtifactUpdateEvent(
                               append=use_append,
                               context_id=task.context_id,
                               task_id=task.id,
                               last_chunk=False,  # Not the last chunk, more are coming
                               artifact=artifact,
                           )
                       )
                       logger.debug(f"✅ Streamed chunk to A2A client: {content[:50]}...")

                       # Skip status updates for ALL streaming content to eliminate duplicates
                       # Artifacts already provide the content, status updates are redundant during streaming
                       logger.debug("Skipping status update for streaming content to avoid duplication - artifacts provide the content")

            # If we exit the stream loop without receiving 'is_task_complete', send accumulated content
            # BUT: If require_user_input=True, the task IS complete (just waiting for input) - don't send partial_result
            logger.debug(f"🔍 EXECUTOR: Stream loop exited. Last event is_task_complete={event.get('is_task_complete', False) if event else 'N/A'}, require_user_input={event.get('require_user_input', False) if event else 'N/A'}")
            logger.debug(f"🔍 EXECUTOR: State check - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content) if sub_agent_accumulated_content else 0}, supervisor_accumulated_len={len(accumulated_content) if accumulated_content else 0}")

            # Skip partial_result if task is waiting for user input (task is effectively complete)
            if event and event.get('require_user_input', False):
                logger.info("✅ EXECUTOR: Task is waiting for user input (require_user_input=True) - NOT sending partial_result")
                return

            if (accumulated_content or sub_agent_accumulated_content) and not event.get('is_task_complete', False):
                await self._ensure_execution_plan_completed(event_queue, task)

                # Check if this is an error message - if so, don't send final status to keep queue open
                last_content = ''.join(accumulated_content) if accumulated_content else (''.join(sub_agent_accumulated_content) if sub_agent_accumulated_content else '')
                is_error = '❌ Error:' in last_content or 'Validation error:' in last_content or 'Error:' in event.get('content', '')

                if is_error:
                    logger.info("⚠️ EXECUTOR: Error detected in content - sending error message but keeping queue open for follow-up questions")
                    # Send error as artifact but don't send final status - keep queue open
                    error_artifact = new_text_artifact(
                        name='error_result',
                        description='Error message from Platform Engineer',
                        text=last_content or event.get('content', ''),
                    )
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=True,
                            artifact=error_artifact,
                        )
                    )
                    # Don't send final status - keep queue open for follow-up questions
                    logger.info(f"Task {task.id} error message sent. Queue kept open for follow-up questions.")
                    return

                # If sub-agent sent complete_result, forward it as complete_result (not partial_result)
                logger.debug(f"🔍 EXECUTOR: Checking complete_result flag - sub_agent_sent_complete_result={sub_agent_sent_complete_result}")
                if sub_agent_sent_complete_result:
                    logger.debug("✅ EXECUTOR: Sub-agent sent complete_result - forwarding as complete_result (task is complete)")
                    artifact_name = 'complete_result'
                else:
                    logger.warning("⚠️ EXECUTOR: Stream ended WITHOUT is_task_complete=True and no complete_result from sub-agent - sending PARTIAL_RESULT (premature end)")
                    logger.warning(f"⚠️ EXECUTOR: Debug - sub_agent_sent_complete_result={sub_agent_sent_complete_result}, sub_agent_accumulated_len={len(sub_agent_accumulated_content) if sub_agent_accumulated_content else 0}")
                    artifact_name = 'partial_result'

                # Content selection strategy (PRIORITY ORDER):
                # 1. If sub-agent sent DataPart: Use sub-agent's DataPart (has structured data like JarvisResponse)
                # 2. If sub-agent accumulated content exists: Use it (from complete_result/final_result - clean)
                # 3. Otherwise: Use supervisor's accumulated content

                # DEBUG: Log the state before creating partial_result
                sub_agent_data_status = 'present' if sub_agent_datapart_data else 'None'
                sub_agent_len = len(sub_agent_accumulated_content) if sub_agent_accumulated_content else 0
                supervisor_len = len(accumulated_content) if accumulated_content else 0
                logger.info(
                    f"🔍 DEBUG partial_result creation: "
                    f"sub_agent_sent_datapart={sub_agent_sent_datapart}, "
                    f"sub_agent_datapart_data={sub_agent_data_status}, "
                    f"sub_agent_accumulated_len={sub_agent_len}, "
                    f"supervisor_accumulated_len={supervisor_len}"
                )

                if sub_agent_sent_datapart and sub_agent_datapart_data:
                    # Sub-agent sent structured DataPart - recreate DataPart artifact (highest priority)
                    description = 'Complete structured result from Platform Engineer' if artifact_name == 'complete_result' else 'Partial structured result from Platform Engineer (stream ended)'
                    logger.debug(f"📦 Creating DataPart artifact for {artifact_name} - sub_agent_sent_datapart=True, data keys: {list(sub_agent_datapart_data.keys())}")
                    artifact = new_data_artifact(
                        name=artifact_name,
                        description=description,
                        data=sub_agent_datapart_data,
                    )
                    # DEBUG: Log artifact structure to verify DataPart is present
                    logger.info(f"🔍 DEBUG: Artifact parts count: {len(artifact.parts)}, first part type: {type(artifact.parts[0].root) if artifact.parts else 'None'}, is DataPart: {isinstance(artifact.parts[0].root, DataPart) if artifact.parts else False}")
                elif sub_agent_accumulated_content:
                    # Prefer sub-agent accumulated content (from complete_result/final_result) - it's clean
                    final_content = ''.join(sub_agent_accumulated_content)
                    description = 'Complete result from Platform Engineer' if artifact_name == 'complete_result' else 'Partial result from Platform Engineer (stream ended)'
                    logger.info(f"📝 Using sub-agent accumulated content for {artifact_name} ({len(final_content)} chars) - from complete_result/final_result")
                    artifact = new_text_artifact(
                        name=artifact_name,
                        description=description,
                        text=final_content,
                    )
                elif accumulated_content:
                    # Fallback to supervisor content
                    final_content = ''.join(accumulated_content)
                    description = 'Complete result from Platform Engineer' if artifact_name == 'complete_result' else 'Partial result from Platform Engineer (stream ended)'
                    logger.info(f"📝 Using supervisor accumulated content for {artifact_name} ({len(final_content)} chars) - fallback")
                    artifact = new_text_artifact(
                        name=artifact_name,
                        description=description,
                        text=final_content,
                    )
                else:
                    # Final fallback - should not happen
                    final_content = ''
                    description = 'Complete result from Platform Engineer' if artifact_name == 'complete_result' else 'Partial result from Platform Engineer (stream ended)'
                    logger.warning(f"⚠️ No content available for {artifact_name}")
                    artifact = new_text_artifact(
                        name=artifact_name,
                        description=description,
                        text=final_content,
                    )

                await self._safe_enqueue_event(
                    event_queue,
                    TaskArtifactUpdateEvent(
                        append=False,
                        context_id=task.context_id,
                        task_id=task.id,
                        last_chunk=True,
                        artifact=artifact,
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
                logger.info(f"Task {task.id} marked as completed with {len(final_content)} chars total.")

        except ValueError as ve:
            # Handle ValueError (e.g., LangGraph validation errors) - agent.py should have yielded error event
            # Don't raise - let the error event be processed and queue stay open
            error_msg = str(ve)
            logger.error(f"ValueError during agent execution (should have been handled by agent): {error_msg}")
            # Only enqueue failure status if error event wasn't already sent
            # Check if we already processed an error event by checking if stream ended normally
            try:
                await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                        status=TaskStatus(
                            state=TaskState.failed,
                            message=new_agent_text_message(
                                f"Validation error: {error_msg}",
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
            # Don't raise - allow queue to stay open for any pending events
            return
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
            # Don't raise - allow queue to stay open for any pending tool events
            # The A2A framework will handle cleanup
            return

    def _parse_execution_plan_text(self, text: str) -> list[dict[str, str]]:
        if not text:
            return []

        todos: list[dict[str, str]] = []
        emoji_to_status = {
            '🔄': 'in_progress',
            '⏸️': 'pending',
            '✅': 'completed',
        }

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith('-') or line.startswith('*'):
                content_part = line[1:].strip()
            else:
                content_part = line
            if not content_part:
                continue
            emoji = content_part[0]
            if emoji not in emoji_to_status:
                continue
            status = emoji_to_status[emoji]
            content = content_part[1:].strip()
            if content:
                todos.append({'status': status, 'content': content})

        if todos:
            return todos

        if 'todo list to' in text:
            start = text.find('[')
            end = text.rfind(']')
            if start != -1 and end != -1 and end > start:
                snippet = text[start:end + 1]
                try:
                    parsed = ast.literal_eval(snippet)
                    if isinstance(parsed, list):
                        normalized = []
                        for item in parsed:
                            if isinstance(item, dict):
                                status = (item.get('status') or '').lower()
                                content = item.get('content') or item.get('task') or ''
                                if status and content:
                                    normalized.append({'status': status, 'content': content})
                        if normalized:
                            return normalized
                except (ValueError, SyntaxError):
                    pass
        return []

    def _format_execution_plan_text(self, todos: list[dict[str, str]], label: str = 'final') -> str:
        if not todos:
            return ''
        status_to_emoji = {
            'in_progress': '🔄',
            'pending': '⏸️',
            'completed': '✅',
        }
        heading = '📋 **Execution Plan (final)**' if label == 'final' else '📋 **Execution Plan**'
        lines = [heading, '']
        for item in todos:
            status = item.get('status', 'pending')
            content = item.get('content', '')
            emoji = status_to_emoji.get(status, '•')
            lines.append(f'- {emoji} {content}')
        return '\n'.join(lines)

    async def _ensure_execution_plan_completed(self, event_queue: EventQueue, task: Any) -> None:
        if not self._execution_plan_emitted or not self._latest_execution_plan:
            return

        if all(item.get('status') == 'completed' for item in self._latest_execution_plan):
            return

        completed_plan = [
            {'status': 'completed', 'content': item.get('content', '')}
            for item in self._latest_execution_plan
        ]
        formatted_text = self._format_execution_plan_text(completed_plan, label='final')
        artifact = new_text_artifact(
            name='execution_plan_status_update',
            description='TODO progress update',
            text=formatted_text,
        )
        context_id = getattr(task, 'context_id', None)
        task_id = getattr(task, 'id', None)
        await self._safe_enqueue_event(
            event_queue,
            TaskArtifactUpdateEvent(
                append=False,
                context_id=context_id,
                task_id=task_id,
                lastChunk=False,
                artifact=artifact,
            )
        )
        self._latest_execution_plan = completed_plan

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        """
        Handle task cancellation.

        Sends a cancellation status update to the client and logs the cancellation.
        Note: Currently doesn't stop in-flight LangGraph execution, but prevents
        further streaming and notifies the client properly.
        """
        logger.info("Platform Engineer Agent: Task cancellation requested")

        task = context.current_task
        if task:
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.canceled),
                    final=True,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )
            logger.info(f"Task {task.id} cancelled successfully")
        else:
            logger.warning("Cancellation requested but no current task found")