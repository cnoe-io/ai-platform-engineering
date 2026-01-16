# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
import os
import ast
import json
from typing import Optional, List, Dict, Any
from typing_extensions import override

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
        """
        Safely enqueue an event, handling closed queue gracefully.

        Prevents spam logging of "Queue is closed" by tracking closure state.
        """
        # Track if we've already logged about queue closure (class-level to persist across calls)
        if not hasattr(self, '_queue_closed_logged'):
            self._queue_closed_logged = False

        try:
            await event_queue.enqueue_event(event)
            # Reset flag if queue becomes available again
            if self._queue_closed_logged:
                logger.info("Queue reopened, resuming event streaming")
                self._queue_closed_logged = False
        except Exception as e:
            # Check if the error is related to queue being closed
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                # Only log once when queue first closes, then suppress
                if not self._queue_closed_logged:
                    logger.warning("⚠️ Event queue closed. Subsequent events will be dropped silently until queue reopens.")
                    self._queue_closed_logged = True
                # Don't spam logs or re-raise - this is expected during shutdown/reconnection
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
            logger.info(f"🔍 Platform Engineer Executor: Generated ROOT trace_id: {trace_id}")
        else:
            logger.info(f"🔍 Platform Engineer Executor: Using trace_id from previous context: {trace_id}")

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
                if isinstance(event, (TaskArtifactUpdateEvent, TaskStatusUpdateEvent)):
                    logger.debug(f"Executor: Processing streamed A2A event: {type(event).__name__}")

                    # Fix forwarded TaskArtifactUpdateEvent to handle append flag correctly
                    if isinstance(event, TaskArtifactUpdateEvent):
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
                    logger.info("⚠️ EXECUTOR: Error detected in content - sending error with terminal status")
                    error_text = last_content or event.get('content', '')

                    # Send error as artifact
                    error_artifact = new_text_artifact(
                        name='error_result',
                        description='Error message from Platform Engineer',
                        text=error_text,
                    )
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,  # Don't close queue with artifact
                            artifact=error_artifact,
                        )
                    )
                    # Send terminal status to properly close the stream
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskStatusUpdateEvent(
                            final=True,
                            context_id=task.context_id,
                            task_id=task.id,
                            status=TaskStatus(
                                state=TaskState.completed,
                                message=new_agent_text_message(error_text),
                            ),
                        )
                    )
                    logger.info(f"Task {task.id} error message sent with terminal status.")
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
        Also repairs any orphaned tool calls in the message history to prevent
        subsequent queries from failing.
        """
        logger.info("Platform Engineer Agent: Task cancellation requested")

        task = context.current_task
        if task:
            # CRITICAL: Repair orphaned tool calls immediately on cancel
            # This prevents subsequent queries from failing due to AIMessages
            # with tool_calls that have no corresponding ToolMessage.
            try:
                if hasattr(self.agent, '_repair_orphaned_tool_calls'):
                    config = self.agent.tracing.create_config(task.context_id)
                    await self.agent._repair_orphaned_tool_calls(config)
                    logger.info(f"Task {task.id}: Repaired orphaned tool calls after cancel")
            except Exception as e:
                logger.warning(f"Task {task.id}: Failed to repair orphaned tool calls on cancel: {e}")
                # Don't fail the cancel operation if repair fails

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