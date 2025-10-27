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

        # Execution plan streaming state
        self._execution_plan_active = False
        self._execution_plan_buffer = ""
        self._execution_plan_complete = False

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
            logger.info("🎛️  Routing Mode: DEEP_AGENT_PARALLEL_ORCHESTRATION - All queries via Deep Agent with parallel orchestration (DEFAULT - best performance)")
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
        
        logger.info(f"📚 Knowledge base keywords: {self.knowledge_base_keywords}")
        logger.info(f"🔧 Orchestration keywords: {self.orchestration_keywords}")

    def _parse_env_keywords(self, env_var: str, default: str) -> List[str]:
        """Parse comma-separated keywords from environment variable."""
        keywords_str = os.getenv(env_var, default)
        keywords = [kw.strip() for kw in keywords_str.split(',') if kw.strip()]
        return keywords

    def _handle_execution_plan_detection(self, content: str) -> bool:
        """
        Detect and handle execution plan streaming using Unicode markers ⟦ and ⟧.
        Returns True if this content is part of an execution plan.
        """
        # Check for start marker ⟦ (U+27E6)
        if '⟦' in content:
            self._execution_plan_active = True
            self._execution_plan_buffer = content
            self._execution_plan_complete = False
            logger.debug(f"🎯 Execution plan START detected: {content[:50]}...")
            return True
        
        # If we're in an active execution plan, accumulate content
        elif self._execution_plan_active:
            self._execution_plan_buffer += content
            
            # Check for end marker ⟧ (U+27E7)
            if '⟧' in content:
                self._execution_plan_active = False
                self._execution_plan_complete = True
                logger.debug(f"🎯 Execution plan END detected. Total length: {len(self._execution_plan_buffer)} chars")
                # Note: The complete execution plan will be sent as an artifact in the main streaming logic
            
            return True
        
        return False

    def _get_complete_execution_plan(self) -> str:
        """Get the complete execution plan buffer and reset the state."""
        if self._execution_plan_complete:
            complete_plan = self._execution_plan_buffer
            # Reset state for next execution plan
            self._execution_plan_buffer = ""
            self._execution_plan_complete = False
            return complete_plan
        return ""

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
            first_artifact_sent = False  # Track if we've sent the initial artifact
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

                            # A2A protocol: first artifact must have append=False to create it
                            # Subsequent artifacts use append=True to append to existing artifact
                            use_append = first_artifact_sent
                            if not first_artifact_sent:
                                first_artifact_sent = True
                                logger.info("📝 Sending FIRST artifact (append=False) to create artifact")
                            else:
                                logger.info("📝 Appending to existing artifact (append=True)")

                            # Forward chunk immediately to client (streaming!)
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=use_append,  # First: False (create), subsequent: True (append)
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

                            # A2A protocol: first artifact must have append=False to create it
                            use_append = first_artifact_sent
                            if not first_artifact_sent:
                                first_artifact_sent = True
                                logger.info("📝 Sending FIRST artifact (append=False) from status message")
                            else:
                                logger.info("📝 Appending status content to artifact (append=True)")

                            # Forward status message content to client
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskArtifactUpdateEvent(
                                    append=use_append,  # First: False (create), subsequent: True (append)
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
                            # Send final artifact with complete accumulated text
                            # For streaming clients: redundant but safe (they already got chunks)
                            # For non-streaming clients: essential (only way to get complete text)
                            final_text = ''.join(accumulated_text)
                            logger.info(f"📦 Sending final artifact with {len(final_text)} chars")
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
        # Reset execution plan state for new task
        self._execution_plan_active = False
        self._execution_plan_buffer = ""
        self._execution_plan_complete = False
        
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
        streaming_artifact_id = None  # Shared artifact ID for all streaming chunks
        execution_plan_artifact_id = None  # Separate artifact ID for execution plan streaming
        execution_plan_first_chunk = True  # Track if this is the first execution plan chunk

        try:
            # invoke the underlying agent, using streaming results
            # NOTE: Pass task to maintain task ID consistency across sub-agents
            async for event in self.agent.stream(query, context_id, trace_id):
                # Handle typed A2A events - TRANSFORM APPEND FLAG FOR FORWARDED EVENTS
                if isinstance(event, (A2ATaskArtifactUpdateEvent, A2ATaskStatusUpdateEvent)):
                    logger.debug(f"Executor: Processing streamed A2A event: {type(event).__name__}")
                    
                    # Fix forwarded TaskArtifactUpdateEvent to handle append flag correctly
                    if isinstance(event, A2ATaskArtifactUpdateEvent):
                        # Transform the event to use our first_artifact_sent logic
                        use_append = first_artifact_sent
                        if not first_artifact_sent:
                            first_artifact_sent = True
                            logger.info("📝 Transforming FIRST forwarded artifact (append=False) to create artifact")
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
                    logger.info("Task complete event received. Enqueuing final TaskArtifactUpdateEvent and TaskStatusUpdateEvent.")
                    
                    # Send final artifact with all accumulated content for non-streaming clients
                    final_content = ''.join(accumulated_content) if accumulated_content else content
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,  # Final artifact always creates new artifact
                            context_id=task.context_id,
                            task_id=task.id,
                            lastChunk=True,
                            artifact=new_text_artifact(
                                name='final_result',
                                description='Complete result from Platform Engineer.',
                                text=final_content,
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
                       
                       # Execution plan detection using Unicode markers ⟦ and ⟧
                       is_execution_plan = self._handle_execution_plan_detection(content)
                       
                       # Accumulate non-notification content for final UI response
                       # Streaming artifacts are for real-time display, final response for clean UI display
                       if not is_tool_notification and not is_execution_plan:
                           accumulated_content.append(content)
                           logger.debug(f"📝 Added content to final response accumulator: {content[:50]}...")
                       elif is_tool_notification:
                           logger.debug(f"🔧 Skipping tool notification from final response: {content.strip()}")
                       elif is_execution_plan:
                           logger.debug(f"📋 Skipping execution plan from final response: {content.strip()}")
                       
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
                       elif is_execution_plan:
                           # Check if execution plan is complete
                           complete_plan = self._get_complete_execution_plan()
                           if complete_plan:
                               # Send complete execution plan as special artifact
                               artifact_name = 'execution_plan_update'
                               artifact_description = 'Complete execution plan streamed to user'
                               content = complete_plan  # Use complete plan content
                               logger.debug(f"📋 Complete execution plan ready: {len(complete_plan)} chars")
                           else:
                               # Still accumulating execution plan
                               artifact_name = 'execution_plan_streaming'
                               artifact_description = 'Execution plan streaming in progress'
                               logger.debug(f"📋 Execution plan streaming: {content[:50]}...")
                        
                       # Create shared artifact ID once for all streaming chunks
                       if is_execution_plan:
                           # Handle execution plan streaming separately
                           if execution_plan_first_chunk:
                               # First execution plan chunk - create new artifact
                               artifact = new_text_artifact(
                                   name=artifact_name,
                                   description=artifact_description,
                                   text=content,
                               )
                               execution_plan_artifact_id = artifact.artifactId  # Save for subsequent chunks
                               execution_plan_first_chunk = False
                               use_append = False
                               logger.info(f"📝 Sending FIRST execution plan chunk (append=False) with ID: {execution_plan_artifact_id}")
                           else:
                               # Subsequent execution plan chunks - reuse the same artifact ID
                               artifact = new_text_artifact(
                                   name=artifact_name,
                                   description=artifact_description,
                                   text=content,
                               )
                               artifact.artifactId = execution_plan_artifact_id  # Reuse the same artifact ID
                               use_append = True
                               logger.debug(f"📝 Appending execution plan chunk (append=True) to artifact: {execution_plan_artifact_id}")
                       elif is_tool_notification:
                           # Tool notifications always get their own artifact IDs
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           use_append = False
                           logger.debug(f"📝 Creating separate tool notification artifact: {artifact.artifactId}")
                       elif streaming_artifact_id is None:
                           # First regular content chunk - create new artifact with unique ID
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           streaming_artifact_id = artifact.artifactId  # Save for subsequent chunks
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
                           artifact.artifactId = streaming_artifact_id  # Use the same ID for regular chunks
                           use_append = True
                           logger.debug(f"📝 Appending streaming chunk (append=True) to artifact: {streaming_artifact_id}")

                       # Forward chunk immediately to client (STREAMING!)
                       await self._safe_enqueue_event(
                           event_queue,
                           TaskArtifactUpdateEvent(
                               append=use_append,
                               context_id=task.context_id,
                               task_id=task.id,
                               lastChunk=False,  # Not the last chunk, more are coming
                               artifact=artifact,
                           )
                       )
                       logger.debug(f"✅ Streamed chunk to A2A client: {content[:50]}...")
                    
                    # Skip status updates for ALL streaming content to eliminate duplicates
                    # Artifacts already provide the content, status updates are redundant during streaming
                    logger.debug("Skipping status update for streaming content to avoid duplication - artifacts provide the content")

            # If we exit the stream loop without receiving 'is_task_complete', send accumulated content
            if accumulated_content and not event.get('is_task_complete', False):
                logger.warning(f"⚠️  Stream ended without completion signal, sending accumulated content ({len(accumulated_content)} chunks)")
                final_content = ''.join(accumulated_content)
                await self._safe_enqueue_event(
                    event_queue,
                    TaskArtifactUpdateEvent(
                        append=False,
                        context_id=task.context_id,
                        task_id=task.id,
                        lastChunk=True,
                        artifact=new_text_artifact(
                            name='partial_result',
                            description='Partial result from Platform Engineer (stream ended)',
                            text=final_content,
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
                logger.info(f"Task {task.id} marked as completed with {len(final_content)} chars total.")

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