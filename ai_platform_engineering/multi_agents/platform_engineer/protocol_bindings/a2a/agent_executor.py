# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import contextvars
import logging
import uuid
import httpx
import asyncio
import os
import ast
import json
from typing import Optional, List, Dict, Any
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
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    SendStreamingMessageRequest,
    MessageSendParams,
    Artifact,
    Part,
    TextPart,
    DataPart,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding
)
from ai_platform_engineering.multi_agents.platform_engineer import platform_registry
from ai_platform_engineering.multi_agents.platform_engineer.response_format import PlatformEngineerResponse
from cnoe_agent_utils.tracing import extract_trace_id_from_context
import json

logger = logging.getLogger(__name__)

# Debug mode: Enable detailed event tracking
DEBUG_EVENT_TRACKING = os.getenv("DEBUG_EVENT_TRACKING", "false").lower() in ["true", "1", "yes"]

# Import context variables from shared module to avoid circular imports
from ai_platform_engineering.utils.a2a_common.context_vars import (
    _event_queue_ctx,
    _task_ctx,
)


@dataclass
class EventRecord:
    """Record of an event for debugging purposes"""
    sequence: int
    event_type: str  # 'streaming_chunk', 'artifact_update', 'status_update', 'accumulation'
    artifact_name: Optional[str] = None
    artifact_id: Optional[str] = None  # Artifact ID for tracking append operations
    content_length: int = 0
    content_preview: str = ""
    was_accumulated: bool = False
    accumulator_state: Optional[str] = None  # "X chunks, Y chars"
    metadata: Optional[Dict[str, Any]] = None


class EventTracker:
    """Tracks all events during execution for debugging duplication issues"""

    def __init__(self, enabled: bool = False):
        self.enabled = enabled
        self.events: List[EventRecord] = []
        self.sequence = 0

    def record_streaming_chunk(
        self,
        event_type: str,
        content: Optional[str] = None,
        artifact_name: Optional[str] = None,
        artifact_id: Optional[str] = None,
        was_accumulated: bool = False,
        accumulator_state: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Record a streaming chunk event"""
        if not self.enabled:
            return

        self.sequence += 1
        content_len = len(content) if content else 0
        content_preview = content if content else ""  # Store full content

        self.events.append(EventRecord(
            sequence=self.sequence,
            event_type=event_type,
            artifact_name=artifact_name,
            artifact_id=artifact_id,
            content_length=content_len,
            content_preview=content_preview,
            was_accumulated=was_accumulated,
            accumulator_state=accumulator_state,
            metadata=metadata or {}
        ))

    def record_event_enqueued(
        self,
        event_class_name: str,
        content: Optional[str] = None,
        artifact_name: Optional[str] = None,
        artifact_id: Optional[str] = None,
        was_accumulated: bool = False,
        accumulator_state: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Record an event that was enqueued to the event queue (TaskArtifactUpdateEvent, TaskStatusUpdateEvent, etc.)"""
        if not self.enabled:
            return

        self.sequence += 1
        content_len = len(content) if content else 0
        content_preview = content if content else ""  # Store full content

        self.events.append(EventRecord(
            sequence=self.sequence,
            event_type=event_class_name,  # Use actual event class name
            artifact_name=artifact_name,
            artifact_id=artifact_id,
            content_length=content_len,
            content_preview=content_preview,
            was_accumulated=was_accumulated,
            accumulator_state=accumulator_state,
            metadata=metadata or {}
        ))

    def record_accumulation(
        self,
        chunk_num: int,
        content: str,
        accumulator_state: str,
        was_duplicate: bool = False
    ):
        """Record an accumulation event"""
        if not self.enabled:
            return

        self.sequence += 1
        self.events.append(EventRecord(
            sequence=self.sequence,
            event_type='accumulation',
            content_length=len(content),
            content_preview=content,  # Store full content, not just preview
            was_accumulated=True,
            accumulator_state=accumulator_state,
            metadata={'chunk_num': chunk_num, 'was_duplicate': was_duplicate}
        ))

    def record_partial_result(
        self,
        final_content: str,
        chunk_count: int,
        total_before_join: int,
        artifact_id: Optional[str] = None
    ):
        """Record partial_result creation"""
        if not self.enabled:
            return

        self.sequence += 1
        self.events.append(EventRecord(
            sequence=self.sequence,
            event_type='partial_result_creation',
            artifact_name='partial_result',
            artifact_id=artifact_id,
            content_length=len(final_content),
            content_preview=final_content,  # Store full content
            was_accumulated=False,
            accumulator_state=f"{chunk_count} chunks, {total_before_join} chars before join",
            metadata={'final_length': len(final_content), 'chunk_count': chunk_count}
        ))

    def generate_table(self) -> str:
        """Generate a formatted table of all events with full content"""
        if not self.enabled or not self.events:
            return ""

        lines = []
        lines.append("=" * 120)
        lines.append("EVENT TRACKING TABLE (DEBUG MODE)")
        lines.append("=" * 120)
        lines.append("")
        lines.append(f"{'#':<4} {'Event Type':<30} {'Artifact':<20} {'Artifact ID':<38} {'Len':<6} {'Accum?':<7} {'Accumulator State':<25}")
        lines.append("-" * 150)

        for event in self.events:
            accum_str = "YES" if event.was_accumulated else "NO"
            artifact_str = event.artifact_name or "-"
            artifact_id_str = (event.artifact_id or "-")[:36]  # Truncate long IDs
            accum_state_str = event.accumulator_state or "-"

            # Header row
            lines.append(
                f"{event.sequence:<4} {event.event_type:<30} {artifact_str:<20} {artifact_id_str:<38} "
                f"{event.content_length:<6} {accum_str:<7} {accum_state_str:<25}"
            )

            # Content row(s) - show full content, wrap if needed
            if event.content_preview:
                content_display = event.content_preview.replace('\n', '\\n').replace('\r', '\\r')
                # Split into multiple lines if content is long
                max_line_length = 110
                if len(content_display) <= max_line_length:
                    lines.append(f"     Content: {content_display}")
                else:
                    # Wrap content across multiple lines
                    words = content_display.split()
                    current_line = "     Content: "
                    for word in words:
                        if len(current_line) + len(word) + 1 <= max_line_length:
                            current_line += word + " "
                        else:
                            lines.append(current_line.rstrip())
                            current_line = "     " + word + " "
                    if current_line.strip() != "Content:":
                        lines.append(current_line.rstrip())

            # Add separator between events
            lines.append("-" * 150)

        lines.append(f"Total Events: {len(self.events)}")
        lines.append("=" * 150)

        return "\n".join(lines)

    def log_table(self):
        """Log the event table"""
        if self.enabled:
            table = self.generate_table()
            logger.info(f"\n{table}\n")


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


class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor with streaming support for A2A sub-agents."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

        # TODO-based execution plan state
        self._execution_plan_emitted = False
        self._execution_plan_artifact_id = None
        self._latest_execution_plan: list[dict[str, str]] = []


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

    async def _safe_enqueue_event(self, event_queue: EventQueue, event) -> None:
        """Safely enqueue an event, handling closed queue gracefully."""
        event_type_name = type(event).__name__
        event_task_id = getattr(event, 'task_id', 'N/A')
        event_context_id = getattr(event, 'context_id', 'N/A')

        # Check if queue is closed before attempting to enqueue
        if event_queue.is_closed():
            logger.warning(f"⚠️ Queue is closed, cannot enqueue event: {event_type_name} (task_id={event_task_id})")
            return

        try:
            logger.info(f"🔍 _safe_enqueue_event: Enqueuing {event_type_name} (task_id={event_task_id}, context_id={event_context_id})")
            await event_queue.enqueue_event(event)
            logger.info(f"🔍 _safe_enqueue_event: Successfully enqueued {event_type_name}")
        except Exception as e:
            # Check if the error is related to queue being closed
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                logger.warning(f"⚠️ Queue is closed, cannot enqueue event: {event_type_name} (task_id={event_task_id})")
                # Don't re-raise the exception for closed queue - this is expected during shutdown
            else:
                logger.error(f"❌ Failed to enqueue event {event_type_name}: {e}")
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

        # All queries go through Deep Agent with parallel orchestration
        # Analyze query to detect mentioned agents for logging
        available_agents = platform_registry.AGENT_ADDRESS_MAPPING
        mentioned_agents = []
        for agent_name, agent_url in available_agents.items():
            if agent_name.lower() in query.lower():
                mentioned_agents.append(agent_name)

        if mentioned_agents:
            logger.info(f"🤖 Detected agents in query: {mentioned_agents}")

        # Track streaming state for proper A2A protocol
        first_artifact_sent = False
        accumulated_content = []
        sub_agent_accumulated_content = []  # Track content from sub-agent artifacts
        sub_agent_sent_datapart = False  # Track if sub-agent sent structured DataPart
        streaming_artifact_id = None  # Shared artifact ID for all streaming chunks
        streaming_result_sent = False  # Track if we sent any streaming_result chunks
        # seen_artifact_ids - removed # THIS WILL BREAK JAVIS SAYING ERROR


        # Debug event tracking
        event_tracker = EventTracker(enabled=DEBUG_EVENT_TRACKING)
        if DEBUG_EVENT_TRACKING:
            logger.info("🔍 DEBUG_EVENT_TRACKING enabled - will generate event table at end")

        try:
            # Set context variables so tools can access event_queue and task directly
            _event_queue_ctx.set(event_queue)
            _task_ctx.set(task)

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
                if isinstance(event, (TaskArtifactUpdateEvent, TaskStatusUpdateEvent)):
                    logger.debug(f"Executor: Processing streamed A2A event: {type(event).__name__}")

                    # Fix forwarded TaskArtifactUpdateEvent to handle append flag correctly
                    if isinstance(event, TaskArtifactUpdateEvent):
                        # Check if this is a streaming_result artifact from sub-agent
                        if hasattr(event, 'artifact') and event.artifact and hasattr(event.artifact, 'name'):
                            if event.artifact.name == 'streaming_result':
                                streaming_result_sent = True  # Mark that we forwarded streaming_result from sub-agent
                                logger.debug(f"📝 Forwarded streaming_result from sub-agent - marking streaming_result_sent=True")

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
                        if isinstance(event, TaskStatusUpdateEvent):
                            # Extract metadata from sub-agent event
                            event_metadata = getattr(event, 'metadata', None) or {}
                            # Use generic 'tool_notification' if this is a tool notification event
                            artifact_name = 'tool_notification' if event_metadata.get('tool_notification') else None

                            # Track forwarded status event
                            if DEBUG_EVENT_TRACKING:
                                # Extract message text from status for tracking
                                status_message_text = ""
                                if hasattr(event.status, 'message') and event.status.message:
                                    if hasattr(event.status.message, 'parts'):
                                        for part in event.status.message.parts:
                                            if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                                status_message_text += part.root.text

                                event_tracker.record_event_enqueued(
                                    event_class_name='TaskStatusUpdateEvent',
                                    content=status_message_text,
                                    artifact_name=artifact_name,  # Use generic 'tool_notification' if applicable
                                    artifact_id=None,
                                    was_accumulated=False,
                                    metadata=event_metadata
                                )

                            # Update the task ID to match the original client task
                            # Preserve metadata (including tool_notification) from sub-agent
                            corrected_status_event = TaskStatusUpdateEvent(
                                context_id=event.context_id,
                                task_id=task.id,  # ✅ Use the ORIGINAL task ID from client
                                status=event.status,
                                metadata=event_metadata,  # Preserve metadata including tool_notification
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

                # Check if this is a custom event from writer() (e.g., sub-agent streaming via artifact-update or status-update)
                if isinstance(event, dict) and 'type' in event:
                    event_type = event.get('type')

                    # Handle status-update events from sub-agents
                    if event_type == 'status-update':
                        result = event.get('result', {})
                        metadata = result.get('metadata', {})
                        is_tool_notification = metadata.get('tool_notification', False)
                        tool_name = metadata.get('tool_name', 'N/A')
                        tool_status = metadata.get('status', 'N/A')
                        logger.info(f"🎯 Supervisor: Received status-update from sub-agent (tool_notification={is_tool_notification}, tool_name={tool_name}, status={tool_status})")
                        if result:
                            # Convert JSON result to TaskStatusUpdateEvent object (standard A2A SDK name)
                            # The supervisor will forward it with correct task ID and preserved metadata
                            # Note: TaskStatus, TaskState, and new_agent_text_message are already imported at module level

                            status_dict = result.get('status', {})
                            context_id = result.get('contextId')
                            task_id = result.get('taskId')
                            metadata = result.get('metadata', {})

                            # Build TaskStatus from JSON
                            state_str = status_dict.get('state', 'working')
                            state = TaskState[state_str] if hasattr(TaskState, state_str) else TaskState.working

                            # Build message from JSON
                            message_dict = status_dict.get('message', {})
                            message = None
                            if message_dict:
                                parts = message_dict.get('parts', [])
                                text_parts = [p.get('text', '') for p in parts if isinstance(p, dict) and p.get('text')]
                                if text_parts:
                                    message = new_agent_text_message(
                                        '\n'.join(text_parts),
                                        context_id or task.context_id,
                                        task_id or task.id,
                                    )

                            status_obj = TaskStatus(state=state, message=message) if message else TaskStatus(state=state)

                            # Create TaskStatusUpdateEvent from sub-agent (standard A2A SDK name)
                            sub_agent_status_event = TaskStatusUpdateEvent(
                                status=status_obj,
                                final=result.get('final', False),
                                context_id=context_id or task.context_id,
                                task_id=task_id or task.id,
                                metadata=metadata,  # Preserve metadata including tool_notification
                            )

                            logger.debug(f"🎯 Platform Engineer: Converted status-update from sub-agent to TaskStatusUpdateEvent (metadata: {metadata})")

                            # Extract metadata for tracking
                            event_metadata = metadata
                            artifact_name = 'tool_notification' if event_metadata.get('tool_notification') else None

                            # Track forwarded status event
                            if DEBUG_EVENT_TRACKING:
                                # Extract message text from status for tracking
                                status_message_text = ""
                                if message:
                                    if hasattr(message, 'parts'):
                                        for part in message.parts:
                                            if hasattr(part, 'root') and hasattr(part.root, 'text'):
                                                status_message_text += part.root.text

                                event_tracker.record_event_enqueued(
                                    event_class_name='TaskStatusUpdateEvent',
                                    content=status_message_text,
                                    artifact_name=artifact_name,
                                    artifact_id=None,
                                    was_accumulated=False,
                                    metadata=event_metadata
                                )

                            # Forward to client with corrected task ID and context ID (use supervisor's task context)
                            corrected_status_event = TaskStatusUpdateEvent(
                                context_id=task.context_id,  # ✅ Use the ORIGINAL context ID from supervisor's task
                                task_id=task.id,  # ✅ Use the ORIGINAL task ID from client
                                status=sub_agent_status_event.status,
                                metadata=event_metadata,  # Preserve metadata including tool_notification
                                final=sub_agent_status_event.final,
                            )
                            logger.info(f"📤 Forwarding sub-agent tool notification to client: {tool_name} - {tool_status} (task_id={task.id}, context_id={task.context_id})")
                            logger.info(f"🔍 Event details before enqueue: task_id={corrected_status_event.task_id}, context_id={corrected_status_event.context_id}, final={corrected_status_event.final}, metadata={corrected_status_event.metadata}")
                            logger.info(f"🔍 EventQueue state before enqueue: is_closed={event_queue.is_closed()}, queue_size={event_queue.queue.qsize() if hasattr(event_queue.queue, 'qsize') else 'N/A'}")
                            try:
                                await self._safe_enqueue_event(event_queue, corrected_status_event)
                                logger.info(f"✅ Successfully enqueued sub-agent tool notification: {tool_name} (event type: {type(corrected_status_event).__name__})")
                                logger.info(f"🔍 EventQueue state after enqueue: is_closed={event_queue.is_closed()}, queue_size={event_queue.queue.qsize() if hasattr(event_queue.queue, 'qsize') else 'N/A'}")
                            except Exception as e:
                                logger.error(f"❌ Failed to enqueue sub-agent tool notification: {tool_name} - {e}")
                                import traceback
                                logger.error(traceback.format_exc())
                            continue  # Skip rest of loop, event has been processed

                    # Handle artifact-update events from sub-agents
                    elif event_type == 'artifact-update':
                        # Custom artifact-update event from sub-agent (via writer() in a2a_remote_agent_connect.py)
                        result = event.get('result', {})
                        artifact = result.get('artifact')

                        if not artifact:
                            logger.warning("⚠️ Received artifact-update event but artifact is None, skipping")
                            continue

                        # Process artifact
                        # Extract text length for logging
                        parts = artifact.get('parts', [])
                        text_len = sum(len(p.get('text', '')) for p in parts if isinstance(p, dict))

                        logger.debug(f"🎯 Platform Engineer: Forwarding artifact-update from sub-agent ({text_len} chars)")

                        # Accumulate sub-agent content for final result
                        # NOTE: Only accumulate DataPart (structured data) - NOT streaming_result TextPart chunks
                        # streaming_result chunks are already forwarded to the client, accumulating them would cause duplication
                        artifact_name = artifact.get('name', 'streaming_result')
                        logger.debug(f"🔍 Processing artifact: name={artifact_name}, parts_count={len(parts)}")
                        if artifact_name in ['streaming_result', 'partial_result', 'final_result', 'complete_result']:
                            for p in parts:
                                if isinstance(p, dict):
                                    logger.debug(f"🔍 Part keys: {list(p.keys())}")
                                    # Only accumulate DataPart (structured data) - NOT TextPart from streaming_result
                                    # TextPart from streaming_result is already forwarded to client, accumulating would duplicate
                                    if p.get('data'):
                                        # DataPart with structured data - store as JSON string
                                        # This is the only content we accumulate - it needs to be sent as partial_result/final_result
                                        json_str = json.dumps(p.get('data'))
                                        sub_agent_accumulated_content.append(json_str)
                                        sub_agent_sent_datapart = True  # Mark that sub-agent sent structured data
                                        logger.info(f"📝 Accumulated sub-agent DataPart: {len(json_str)} chars - MARKING sub_agent_sent_datapart=True")
                                    elif p.get('text'):
                                        # TextPart from streaming_result - Accumulate for partial_result
                                        # We forward streaming_result chunks to client for real-time display,
                                        # but we also need to accumulate the content to send as partial_result
                                        # so the client can replace token-by-token streaming with clean formatted markdown
                                        text_content = p.get('text', '')
                                        if artifact_name == 'streaming_result':
                                            sub_agent_accumulated_content.append(text_content)
                                            logger.debug(f"📝 Accumulated streaming_result TextPart: {len(text_content)} chars (for partial_result)")
                                        else:
                                            # For non-streaming artifacts (partial_result, final_result), accumulate as well
                                            sub_agent_accumulated_content.append(text_content)
                                            logger.debug(f"📝 Accumulated TextPart from {artifact_name}: {len(text_content)} chars")
                                    else:
                                        logger.warning(f"⚠️ Part has neither 'text' nor 'data' key: {p}")

                        # Convert dict to proper Artifact object - preserve both TextPart and DataPart
                        from a2a.types import Artifact, TextPart, DataPart, Part
                        artifact_parts = []
                        for p in parts:
                            if isinstance(p, dict):
                                if p.get('text'):
                                    artifact_parts.append(Part(root=TextPart(text=p.get('text'))))
                                elif p.get('data'):
                                    artifact_parts.append(Part(root=DataPart(data=p.get('data'))))
                                    logger.info(f"📦 Forwarding DataPart to client")

                        artifact_obj = Artifact(
                            artifactId=artifact.get('artifactId'),
                            name=artifact_name,
                            description=artifact.get('description', 'Streaming from sub-agent'),
                            parts=artifact_parts
                        )

                        # Track sub-agent artifact forwarding
                        if DEBUG_EVENT_TRACKING:
                            # Extract content from parts for tracking
                            tracked_content = ""
                            for p in parts:
                                if isinstance(p, dict):
                                    if p.get('text'):
                                        tracked_content += p.get('text', '')
                                    elif p.get('data'):
                                        tracked_content += json.dumps(p.get('data'))
                            event_tracker.record_event_enqueued(
                                event_class_name='TaskArtifactUpdateEvent',
                                content=tracked_content,
                                artifact_name=artifact_name,
                                artifact_id=artifact_obj.artifact_id,
                                was_accumulated=False,
                                metadata={'source': 'sub-agent', 'append': first_artifact_sent}
                            )

                        # Track if we're forwarding streaming_result from sub-agent
                        if artifact_name == 'streaming_result':
                            streaming_result_sent = True  # Mark that we forwarded streaming_result from sub-agent
                            logger.debug(f"📝 Forwarded streaming_result from sub-agent (custom event) - marking streaming_result_sent=True")

                        # Use first_artifact_sent logic for append flag
                        use_append = first_artifact_sent
                        if not first_artifact_sent:
                            first_artifact_sent = True
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
                        continue  # Skip rest of loop, event has been processed

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

                # Track streaming chunk event
                if DEBUG_EVENT_TRACKING and content:
                    event_tracker.record_streaming_chunk(
                        event_type='streaming_chunk',
                        content=content,
                        artifact_id=streaming_artifact_id,  # Use current streaming artifact ID if available
                        was_accumulated=False,  # Will be updated when accumulation happens
                        metadata={'is_task_complete': event.get('is_task_complete', False)}
                    )

                if event['is_task_complete']:
                    # Supervisor's own completion - proceed with final result
                    await self._ensure_execution_plan_completed(event_queue, task)
                    logger.info("✅ EXECUTOR: Task complete event received! Enqueuing FINAL_RESULT artifact.")

                    # Send final artifact with all accumulated content for non-streaming clients
                    # Content selection strategy (PRIORITY ORDER):
                    # 1. If sub-agent sent DataPart: Use sub-agent's DataPart (has structured data like JarvisResponse)
                    # 2. Otherwise: Use sub-agent's content or supervisor's content (backward compatible)

                    require_user_input = event.get('require_user_input', False)

                    if sub_agent_sent_datapart and sub_agent_accumulated_content:
                        # Sub-agent sent structured DataPart - use it directly (highest priority)
                        final_content = ''.join(sub_agent_accumulated_content)
                        logger.info(f"📦 Using sub-agent DataPart for final_result ({len(final_content)} chars) - sub_agent_sent_datapart=True")
                    elif sub_agent_accumulated_content:
                        # Fallback to sub-agent content
                        final_content = ''.join(sub_agent_accumulated_content)
                        logger.info(f"📝 Using sub-agent accumulated content for final_result ({len(final_content)} chars)")
                    elif accumulated_content:
                        # Fallback to supervisor content
                        final_content = ''.join(accumulated_content)
                        logger.info(f"📝 Using supervisor accumulated content for final_result ({len(final_content)} chars) - fallback")
                    else:
                        # Final fallback to current event content
                        final_content = content
                        logger.info(f"📝 Using current event content for final_result ({len(final_content)} chars)")

                    # Always use TextPart for final_result
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
                    # Handle tool_call and tool_result events using TaskStatusUpdateEvent (correct A2A protocol)
                    if 'tool_call' in event:
                        tool_info = event['tool_call']
                        tool_name = tool_info.get('name', 'unknown')
                        logger.info(f"Tool call detected: {tool_name}")

                        # Send tool notification as TaskStatusUpdateEvent with tool information in message
                        tool_message_text = f"🔧 Supervisor: Calling tool: {tool_name}"

                        # Track event
                        if DEBUG_EVENT_TRACKING:
                            event_tracker.record_event_enqueued(
                                event_class_name='TaskStatusUpdateEvent',
                                content=tool_message_text,
                                artifact_name='tool_notification',
                                artifact_id=None,
                                was_accumulated=False,
                                metadata={'tool_name': tool_name, 'status': 'started', 'event_source': 'tool_call'}
                            )

                        await self._safe_enqueue_event(
                            event_queue,
                            TaskStatusUpdateEvent(
                                status=TaskStatus(
                                    state=TaskState.working,
                                    message=new_agent_text_message(
                                        tool_message_text,
                                        task.context_id,
                                        task.id,
                                    ),
                                ),
                                final=False,
                                context_id=task.context_id,
                                task_id=task.id,
                                metadata={'tool_notification': True, 'tool_name': tool_name, 'status': 'started'},
                            )
                        )
                        continue

                    elif 'tool_result' in event:
                        tool_info = event['tool_result']
                        tool_name = tool_info.get('name', 'unknown')
                        is_error = tool_info.get('is_error', False) or tool_info.get('status') == 'failed'
                        status_text = 'failed' if is_error else 'completed'
                        logger.info(f"Tool result detected: {tool_name} ({status_text})")

                        # Send tool completion notification as TaskStatusUpdateEvent
                        icon = "❌" if status_text == 'failed' else "✅"
                        tool_result_message_text = f"{icon} Supervisor: Tool {tool_name} {status_text}"

                        # Track event
                        if DEBUG_EVENT_TRACKING:
                            event_tracker.record_event_enqueued(
                                event_class_name='TaskStatusUpdateEvent',
                                content=tool_result_message_text,
                                artifact_name='tool_notification',
                                artifact_id=None,
                                was_accumulated=False,
                                metadata={'tool_name': tool_name, 'status': status_text, 'event_source': 'tool_result'}
                            )

                        await self._safe_enqueue_event(
                            event_queue,
                            TaskStatusUpdateEvent(
                                status=TaskStatus(
                                    state=TaskState.working,
                                    message=new_agent_text_message(
                                        tool_result_message_text,
                                        task.context_id,
                                        task.id,
                                    ),
                                ),
                                final=False,
                                context_id=task.context_id,
                                task_id=task.id,
                                metadata={'tool_notification': True, 'tool_name': tool_name, 'status': status_text},
                            )
                        )
                        continue

                    # This is a streaming chunk - forward it immediately to the client!
                    logger.debug(f"🔍 Processing streaming chunk: has_content={bool(content)}, content_length={len(content) if content else 0}")
                    if content:  # Only send artifacts with actual content
                       # This is regular streaming content (not a tool notification - those are handled above)
                       # Accumulate content for final UI response
                       # Streaming artifacts are for real-time display, final response for clean UI display
                       # CRITICAL: If sub-agent sent DataPart, DON'T accumulate supervisor's streaming text
                       # We want ONLY the sub-agent's structured response, not the supervisor's rewrite
                       if content:
                           if not sub_agent_sent_datapart:
                               # 🔍 DEBUG: Track accumulation to find duplication
                               content_preview = content[:100].replace('\n', '\\n')
                               accumulator_state = f"{len(accumulated_content)} chunks, {sum(len(c) for c in accumulated_content)} chars"

                               logger.debug(f"📝 ACCUMULATING chunk #{len(accumulated_content)+1}: {len(content)} chars | Preview: {content_preview}...")
                               logger.debug(f"📝 ACCUMULATOR STATE: {accumulator_state}")

                               # Check for duplicate content
                               skip_duplicate = False
                               if accumulated_content:
                                   accumulated_text = ''.join(accumulated_content)
                                   last_chunk = accumulated_content[-1]

                                   # Check 1: Current chunk matches last chunk (exact duplicate)
                                   if content.strip() == last_chunk.strip() and len(content.strip()) > 50:
                                       logger.warning(f"⚠️ DUPLICATE DETECTED: Current content matches last chunk! Skipping accumulation.")
                                       logger.warning(f"⚠️ Last chunk: {last_chunk[:100]}...")
                                       logger.warning(f"⚠️ Current chunk: {content[:100]}...")
                                       skip_duplicate = True
                                   # Check 2: Current chunk contains all accumulated content (LLM sent full text again)
                                   elif accumulated_text.strip() and accumulated_text.strip() in content.strip():
                                       logger.warning(f"⚠️ FULL TEXT DUPLICATE: Current chunk contains all accumulated content! Skipping accumulation.")
                                       logger.warning(f"⚠️ Accumulated: {accumulated_text[:100]}... ({len(accumulated_text)} chars)")
                                       logger.warning(f"⚠️ Current chunk: {content[:100]}... ({len(content)} chars)")
                                       skip_duplicate = True
                                   # Check 3: Current chunk is substring of accumulated content (might be legitimate repetition)
                                   elif content.strip() in accumulated_text.strip():
                                       logger.debug(f"⚠️ CONTENT ALREADY EXISTS: Current content appears in accumulated content! May cause duplication.")
                                       # Don't skip - might be legitimate repetition
                               else:
                                   logger.info(f"📝 First chunk being accumulated")

                               # Track event
                               event_tracker.record_accumulation(
                                   chunk_num=len(accumulated_content)+1,
                                   content=content,
                                   accumulator_state=accumulator_state,
                                   was_duplicate=skip_duplicate
                               )

                               if not skip_duplicate:
                                   accumulated_content.append(content)
                               else:
                                   logger.warning(f"⚠️ SKIPPED duplicate chunk - not adding to accumulator")

                               after_state = f"{len(accumulated_content)} chunks, {sum(len(c) for c in accumulated_content)} chars"
                               logger.debug(f"📝 AFTER ACCUMULATION: {after_state}")
                           else:
                               logger.info(f"⏭️ SKIPPING supervisor content - sub-agent sent DataPart (sub_agent_sent_datapart=True): {content[:50]}...")

                       # Send result content as streaming_result
                       artifact_name = 'streaming_result'
                       artifact_description = 'Streaming result from Platform Engineer'

                       # A2A protocol: first artifact must have append=False, subsequent use append=True
                       use_append = first_artifact_sent
                       logger.debug(f"🔍 first_artifact_sent={first_artifact_sent}, use_append={use_append}")

                       # Create shared artifact ID once for all streaming chunks
                       if streaming_artifact_id is None:
                           # First regular content chunk - create new artifact with unique ID
                           artifact = new_text_artifact(
                               name=artifact_name,
                               description=artifact_description,
                               text=content,
                           )
                           streaming_artifact_id = artifact.artifact_id  # Save for subsequent chunks
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

                       # Track result artifact (after artifact is created so we have artifact_id)
                       if DEBUG_EVENT_TRACKING:
                           event_tracker.record_event_enqueued(
                               event_class_name='TaskArtifactUpdateEvent',
                               content=content,
                               artifact_name=artifact_name,
                               artifact_id=artifact.artifact_id,
                               was_accumulated=not sub_agent_sent_datapart,
                               accumulator_state=f"{len(accumulated_content)} chunks",
                               metadata={'is_tool_notification': False}
                           )

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
                       streaming_result_sent = True  # Mark that we sent streaming_result chunks
                       logger.debug(f"✅ Streamed result chunk to A2A client: {content[:50]}...")

                       # Skip status updates for ALL streaming content to eliminate duplicates
                       # Artifacts already provide the content, status updates are redundant during streaming
                       logger.debug("Skipping status update for streaming content to avoid duplication - artifacts provide the content")

            # If we exit the stream loop without receiving 'is_task_complete', send accumulated content
            # BUT: If require_user_input=True, the task IS complete (just waiting for input) - don't send partial_result
            logger.info(f"🔍 EXECUTOR: Stream loop exited. Last event is_task_complete={event.get('is_task_complete', False) if event else 'N/A'}, require_user_input={event.get('require_user_input', False) if event else 'N/A'}")

            # Log event table if debug tracking is enabled
            if DEBUG_EVENT_TRACKING:
                event_tracker.log_table()

            # Skip partial_result if task is waiting for user input (task is effectively complete)
            if event and event.get('require_user_input', False):
                logger.info("✅ EXECUTOR: Task is waiting for user input (require_user_input=True) - NOT sending partial_result")
                return

            if (accumulated_content or sub_agent_accumulated_content) and not event.get('is_task_complete', False):
                await self._ensure_execution_plan_completed(event_queue, task)

                # Always send partial_result as a clean final result, even if streaming_result chunks were sent
                # The client uses partial_result to replace token-by-token streaming content with properly formatted markdown
                logger.info(f"📝 Sending partial_result for final display (streaming_result_sent={streaming_result_sent})")

                logger.warning("❌ EXECUTOR: Stream ended WITHOUT is_task_complete=True, sending PARTIAL_RESULT")

                # Content selection strategy (PRIORITY ORDER):
                # 1. If sub-agent sent DataPart: Use sub-agent's DataPart (has structured data like JarvisResponse)
                # 2. Otherwise: Use sub-agent's content or supervisor's content (backward compatible)

                require_user_input = event.get('require_user_input', False)

                if sub_agent_sent_datapart and sub_agent_accumulated_content:
                    # Sub-agent sent structured DataPart - use it directly (highest priority)
                    final_content = ''.join(sub_agent_accumulated_content)
                    logger.info(f"📦 Using sub-agent DataPart for partial_result ({len(final_content)} chars) - sub_agent_sent_datapart=True")
                elif sub_agent_accumulated_content:
                    # Fallback to sub-agent content
                    final_content = ''.join(sub_agent_accumulated_content)
                    logger.info(f"📝 Using sub-agent accumulated content for partial_result ({len(final_content)} chars)")
                elif accumulated_content:
                    # Final fallback to supervisor content
                    # 🔍 DEBUG: Log accumulation details before joining
                    logger.info(f"📝 ACCUMULATOR BEFORE JOIN: {len(accumulated_content)} chunks")
                    for i, chunk in enumerate(accumulated_content):
                        logger.info(f"📝   Chunk {i+1}: {len(chunk)} chars | Preview: {chunk[:80].replace(chr(10), '\\n')}...")

                    total_before_join = sum(len(c) for c in accumulated_content)
                    logger.info(f"📝 Total chars before join: {total_before_join}")

                    final_content = ''.join(accumulated_content)
                    logger.info(f"📝 Using supervisor accumulated content for partial_result ({len(final_content)} chars)")

                    # 🔍 DEBUG: Check for duplication in final content
                    if len(final_content) > 100:
                        # Check if first half matches second half (simple duplication check)
                        half_point = len(final_content) // 2
                        first_half = final_content[:half_point].strip()
                        second_half = final_content[half_point:].strip()
                        if first_half and second_half and first_half == second_half:
                            logger.warning(f"⚠️ DUPLICATION IN FINAL CONTENT: First half matches second half! ({len(first_half)} chars each)")
                        elif len(final_content) != total_before_join:
                            logger.warning(f"⚠️ SIZE MISMATCH: final_content={len(final_content)} chars, sum of chunks={total_before_join} chars")
                else:
                    # Final fallback to current event content
                    final_content = content
                    logger.info(f"📝 Using current event content for partial_result ({len(final_content)} chars)")

                # Always use TextPart for partial_result
                artifact = new_text_artifact(
                    name='partial_result',
                    description='Partial result from Platform Engineer (stream ended)',
                    text=final_content,
                )

                # Track partial_result creation (after artifact is created so we have artifact_id)
                if DEBUG_EVENT_TRACKING:
                    chunk_count = len(sub_agent_accumulated_content) if sub_agent_accumulated_content else len(accumulated_content) if accumulated_content else 0
                    total_before_join = len(final_content)
                    event_tracker.record_partial_result(
                        final_content=final_content,
                        chunk_count=chunk_count,
                        total_before_join=total_before_join,
                        artifact_id=artifact.artifact_id
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

        except Exception as e:
            logger.error(f"Error during agent execution: {e}")
            # Log event table even on error if debug tracking is enabled
            if DEBUG_EVENT_TRACKING:
                event_tracker.log_table()
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