# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from typing_extensions import override

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
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
    TextPart,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding
)
from cnoe_agent_utils.tracing import extract_trace_id_from_context

logger = logging.getLogger(__name__)


def new_data_artifact(name: str, description: str, data: dict, artifact_id: str = None) -> Artifact:
    """Create an A2A Artifact with structured JSON data using DataPart."""
    return Artifact(
        artifact_id=artifact_id or str(uuid.uuid4()),
        name=name,
        description=description,
        parts=[Part(root=DataPart(data=data))]
    )


@dataclass
class StreamState:
    """Tracks streaming state for A2A protocol."""
    # Content accumulation
    supervisor_content: List[str] = field(default_factory=list)
    sub_agent_content: List[str] = field(default_factory=list)
    sub_agent_datapart: Optional[Dict] = None

    # Artifact tracking
    streaming_artifact_id: Optional[str] = None
    seen_artifact_ids: set = field(default_factory=set)
    first_artifact_sent: bool = False

    # Completion tracking
    # Track count of completed sub-agents for multi-agent scenarios
    sub_agents_completed: int = 0
    task_complete: bool = False
    user_input_required: bool = False

    # Source agent tracking for sub-agent message grouping
    current_agent: Optional[str] = None
    agent_streaming_artifact_ids: Dict[str, str] = field(default_factory=dict)


class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

        # Execution plan state (TODO-based tracking)
        self._execution_plan_emitted = False
        self._execution_plan_artifact_id = None
        self._latest_execution_plan: list[dict[str, str]] = []

    # ─────────────────────────────────────────────────────────────────────────
    # Helper Methods
    # ─────────────────────────────────────────────────────────────────────────

    async def _safe_enqueue_event(self, event_queue: EventQueue, event) -> None:
        """Safely enqueue an event, handling closed queue gracefully."""
        if not hasattr(self, '_queue_closed_logged'):
            self._queue_closed_logged = False

        try:
            await event_queue.enqueue_event(event)
            if self._queue_closed_logged:
                logger.info("Queue reopened, resuming event streaming")
                self._queue_closed_logged = False
        except Exception as e:
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                if not self._queue_closed_logged:
                    logger.warning("⚠️ Event queue closed. Events will be dropped until queue reopens.")
                    self._queue_closed_logged = True
            else:
                logger.error(f"Failed to enqueue event {type(event).__name__}: {e}")
                raise

    def _parse_execution_plan_text(self, text: str) -> list[dict[str, str]]:
        """Parse TODO-based execution plan text into structured list."""
        import re
        items = []
        pattern = r'-\s*\[([xX ])\]\s*(.+)'
        for line in text.strip().split('\n'):
            match = re.match(pattern, line.strip())
            if match:
                status = 'completed' if match.group(1).lower() == 'x' else 'pending'
                items.append({'step': match.group(2).strip(), 'status': status})
        return items

    async def _ensure_execution_plan_completed(self, event_queue: EventQueue, task: A2ATask) -> None:
        """Ensure execution plan shows all steps completed before final result."""
        if not self._execution_plan_emitted or not self._latest_execution_plan:
            return

        # Check if any steps are still pending
        has_pending = any(item.get('status') == 'pending' for item in self._latest_execution_plan)
        if not has_pending:
            return

        # Mark all steps as completed
        completed_plan = [{'step': item['step'], 'status': 'completed'} for item in self._latest_execution_plan]
        plan_text = self._format_execution_plan_text(completed_plan, 'final')

        artifact = new_text_artifact(
            name='execution_plan_status_update',
            description='All execution steps completed',
            text=plan_text,
        )
        if self._execution_plan_artifact_id:
            artifact.artifact_id = self._execution_plan_artifact_id

        await self._safe_enqueue_event(
            event_queue,
            TaskArtifactUpdateEvent(
                append=True,
                context_id=task.context_id,
                task_id=task.id,
                lastChunk=False,
                artifact=artifact,
            )
        )
        logger.info("Sent execution plan completion update")

    def _format_execution_plan_text(self, todos: list[dict[str, str]], label: str = 'final') -> str:
        """Format execution plan as markdown checkbox list."""
        lines = []
        for item in todos:
            checkbox = '[x]' if item.get('status') == 'completed' else '[ ]'
            lines.append(f"- {checkbox} {item.get('step', '')}")
        return '\n'.join(lines)

    def _extract_final_answer(self, content: str) -> str:
        """
        Extract content after [FINAL ANSWER] marker.
        If marker not found, return original content.
        """
        marker = "[FINAL ANSWER]"
        if marker in content:
            # Extract everything after the marker
            idx = content.find(marker)
            final_content = content[idx + len(marker):].strip()
            logger.info(f"Extracted final answer: {len(final_content)} chars (marker found at pos {idx})")
            return final_content
        return content

    def _get_final_content(self, state: StreamState) -> tuple:
        """
        Get final content with priority order for multi-agent scenarios:
        1. Sub-agent DataPart (structured data - e.g., Jarvis forms)
        2. Supervisor content (synthesis from multiple agents)
        3. Sub-agent text content (single agent fallback)

        Returns: (content, is_datapart)

        Note: For multi-agent scenarios (sub_agents_completed > 1), supervisor
        content is preferred as it contains the synthesis. For single-agent
        scenarios, sub-agent content is preferred as it IS the final answer.

        Extracts content after [FINAL ANSWER] marker to filter out
        intermediate thinking/planning messages.
        """
        if state.sub_agent_datapart:
            logger.info("_get_final_content: using sub_agent_datapart")
            return state.sub_agent_datapart, True

        # Multi-agent scenario: prefer supervisor synthesis
        # The supervisor summarizes results from all sub-agents
        if state.sub_agents_completed > 1 and state.supervisor_content:
            raw_content = ''.join(state.supervisor_content)
            extracted = self._extract_final_answer(raw_content)
            logger.info(f"_get_final_content: multi-agent synthesis ({state.sub_agents_completed} agents), raw={len(raw_content)} chars, extracted={len(extracted)} chars")
            return extracted, False

        # Single agent or no supervisor content: use sub-agent content
        if state.sub_agent_content:
            raw_content = ''.join(state.sub_agent_content)
            extracted = self._extract_final_answer(raw_content)
            logger.info(f"_get_final_content: sub-agent content, raw={len(raw_content)} chars, extracted={len(extracted)} chars")
            return extracted, False

        # Fallback to supervisor content even for single agent
        if state.supervisor_content:
            raw_content = ''.join(state.supervisor_content)
            extracted = self._extract_final_answer(raw_content)
            logger.info(f"_get_final_content: fallback supervisor content, raw={len(raw_content)} chars, extracted={len(extracted)} chars, has_FINAL_ANSWER={'[FINAL ANSWER]' in raw_content}")
            return extracted, False

        logger.warning("_get_final_content: NO content available (all sources empty)")
        return '', False

    def _is_tool_notification(self, content: str, event: dict) -> bool:
        """Check if content is a tool notification (should not be accumulated)."""
        # Metadata-based detection
        if 'tool_call' in event or 'tool_result' in event:
            return True

        # Content-based detection
        tool_indicators = [
            '🔍 Querying ', '🔍 Checking ',
            '🔧 Calling ', '🔧 Supervisor:',
        ]
        if any(ind in content for ind in tool_indicators):
            return True

        # Completion notification
        if content.strip().startswith('✅') and 'completed' in content.lower():
            return True

        return False

    def _get_artifact_name_for_notification(self, content: str, event: dict) -> tuple:
        """Get artifact name and description for tool notifications."""
        if 'tool_call' in event:
            tool_name = event['tool_call'].get('name', 'unknown')
            return 'tool_notification_start', f'Tool call started: {tool_name}'

        if 'tool_result' in event:
            tool_name = event['tool_result'].get('name', 'unknown')
            return 'tool_notification_end', f'Tool call completed: {tool_name}'

        if '✅' in content and 'completed' in content.lower():
            return 'tool_notification_end', 'Tool operation completed'

        return 'tool_notification_start', 'Tool operation started'

    def _normalize_content(self, content) -> str:
        """Normalize content to string (handles AWS Bedrock list format)."""
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    parts.append(item.get('text', ''))
                elif isinstance(item, str):
                    parts.append(item)
                else:
                    parts.append(str(item))
            return ''.join(parts)
        return str(content) if content else ''

    async def _send_artifact(self, event_queue: EventQueue, task: A2ATask,
                             artifact: Artifact, append: bool, last_chunk: bool = False):
        """Send an artifact update event."""
        # Debug: Log artifact being sent
        artifact_name = getattr(artifact, 'name', 'unknown')
        # A2A stores text in parts[0].text, not in a top-level text attribute
        parts = getattr(artifact, 'parts', [])
        parts_text = None
        if parts:
            # Try different ways to access text
            first_part = parts[0]
            if hasattr(first_part, 'text'):
                parts_text = first_part.text
            elif hasattr(first_part, 'root') and hasattr(first_part.root, 'text'):
                parts_text = first_part.root.text
            elif isinstance(first_part, dict):
                parts_text = first_part.get('text')
        text_preview = parts_text[:100] if parts_text else '(no parts.text)'
        text_len = len(parts_text) if parts_text else 0

        if artifact_name in ('final_result', 'partial_result'):
            logger.info(f"📤 FINAL ARTIFACT: parts_count={len(parts)}, text_len={text_len}")
            logger.info(f"📤 FINAL ARTIFACT preview: {text_preview}...")
            # Debug: Log the actual artifact structure
            logger.info(f"📤 FINAL ARTIFACT parts[0] type: {type(parts[0]) if parts else 'NO_PARTS'}")
            logger.info(f"📤 FINAL ARTIFACT parts[0] attrs: {dir(parts[0]) if parts else 'NO_PARTS'}")

        await self._safe_enqueue_event(
            event_queue,
            TaskArtifactUpdateEvent(
                append=append,
                context_id=task.context_id,
                task_id=task.id,
                lastChunk=last_chunk,
                artifact=artifact,
            )
        )

    async def _send_completion(self, event_queue: EventQueue, task: A2ATask):
        """Send task completion status."""
        logger.info(f"📤 Sending completion status for task {task.id}")
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(state=TaskState.completed),
                final=True,
                context_id=task.context_id,
                task_id=task.id,
            )
        )
        logger.info(f"📤 Completion status enqueued for task {task.id}")

    async def _send_error(self, event_queue: EventQueue, task: A2ATask, error_msg: str):
        """Send task failure status."""
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(
                    state=TaskState.failed,
                    message=new_agent_text_message(error_msg, task.context_id, task.id),
                ),
                final=True,
                context_id=task.context_id,
                task_id=task.id,
            )
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Event Handlers
    # ─────────────────────────────────────────────────────────────────────────

    async def _handle_sub_agent_artifact(self, event: dict, state: StreamState,
                                         task: A2ATask, event_queue: EventQueue):
        """Handle artifact-update events from sub-agents."""
        result = event.get('result', {})
        artifact_data = result.get('artifact')
        if not artifact_data:
            return

        artifact_name = artifact_data.get('name', 'streaming_result')
        parts = artifact_data.get('parts', [])

        # Extract sourceAgent from artifact metadata, event, or current state
        existing_metadata = artifact_data.get('metadata', {})
        source_agent = (
            existing_metadata.get('sourceAgent') or
            event.get('source_agent') or
            state.current_agent or
            'sub-agent'
        )
        logger.debug(f"📦 Sub-agent artifact from: {source_agent}")

        # Accumulate final results (complete_result, final_result, partial_result)
        if artifact_name in ('complete_result', 'final_result', 'partial_result'):
            state.sub_agents_completed += 1
            logger.info(f"Sub-agent completed with {artifact_name} (total completed: {state.sub_agents_completed})")

            for part in parts:
                if isinstance(part, dict):
                    if part.get('text'):
                        state.sub_agent_content.append(part['text'])
                    elif part.get('data'):
                        state.sub_agent_datapart = part['data']
                        # Clear supervisor content when DataPart received
                        state.supervisor_content.clear()

        # Build and forward artifact to client
        artifact_parts = []
        for part in parts:
            if isinstance(part, dict):
                if part.get('text'):
                    artifact_parts.append(Part(root=TextPart(text=part['text'])))
                elif part.get('data'):
                    artifact_parts.append(Part(root=DataPart(data=part['data'])))

        # Create artifact with sourceAgent metadata for sub-agent message grouping
        artifact = Artifact(
            artifactId=artifact_data.get('artifactId'),
            name=artifact_name,
            description=artifact_data.get('description', f'From {source_agent}'),
            parts=artifact_parts,
            metadata={
                'sourceAgent': source_agent,
                'agentType': 'sub-agent',
                **existing_metadata  # Preserve any other metadata
            }
        )

        # Track artifact ID for append logic
        artifact_id = artifact_data.get('artifactId')
        use_append = artifact_id in state.seen_artifact_ids
        if not use_append:
            state.seen_artifact_ids.add(artifact_id)
            state.first_artifact_sent = True

        await self._send_artifact(
            event_queue, task, artifact,
            append=use_append,
            last_chunk=result.get('lastChunk', False)
        )

    async def _handle_task_complete(self, event: dict, state: StreamState,
                                    content: str, task: A2ATask, event_queue: EventQueue):
        """Handle task completion event."""
        logger.info(
            f"Task {task.id} _handle_task_complete: "
            f"supervisor_content_len={len(state.supervisor_content)}, "
            f"sub_agent_content_len={len(state.sub_agent_content)}, "
            f"sub_agents_completed={state.sub_agents_completed}, "
            f"event_content_len={len(content)}, "
            f"from_response_format_tool={event.get('from_response_format_tool', False)}"
        )

        # ================================================================
        # DEDUPLICATION: Single sub-agent scenario
        # If exactly 1 sub-agent completed, its complete_result was already
        # forwarded to the client by _handle_sub_agent_artifact. The UI
        # uses the status-update (final=true, state=completed) to set
        # isFinal. Sending another final_result with the same content
        # would duplicate it. Just send completion status.
        # ================================================================
        if state.sub_agents_completed == 1 and state.sub_agent_content and not state.sub_agent_datapart:
            logger.info(
                f"Task {task.id}: single sub-agent already sent complete_result — "
                "skipping duplicate final_result, sending completion status only"
            )
            await self._send_completion(event_queue, task)
            logger.info(f"Task {task.id} completed (single sub-agent, deduped).")
            return

        final_content, is_datapart = self._get_final_content(state)

        # If event came from ResponseFormat tool (structured response mode),
        # use content directly since it's the clean final answer
        if event.get('from_response_format_tool'):
            logger.info("Using content directly from ResponseFormat tool (structured response mode)")
            final_content = content
            is_datapart = False
        else:
            final_content, is_datapart = self._get_final_content(state)

            # Fall back to event content if nothing accumulated
            if not final_content and not is_datapart:
                final_content = content

        logger.info(
            f"Task {task.id} final_result: is_datapart={is_datapart}, "
            f"content_len={len(final_content) if isinstance(final_content, str) else 'N/A'}, "
            f"preview={str(final_content)[:200] if final_content else '(empty)'}"
        )

        # Create appropriate artifact
        if is_datapart:
            artifact = new_data_artifact(
                name='final_result',
                description='Complete structured result',
                data=final_content,
            )
        else:
            artifact = new_text_artifact(
                name='final_result',
                description='Complete result from Platform Engineer',
                text=final_content if isinstance(final_content, str) else '',
            )

        await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)
        await self._send_completion(event_queue, task)
        logger.info(f"Task {task.id} completed.")

    async def _handle_user_input_required(self, content: str, task: A2ATask,
                                          event_queue: EventQueue, metadata: Optional[Dict] = None):
        """
        Handle user input required event.

        Args:
            content: The text content describing the input request
            task: The current A2A task
            event_queue: Event queue for sending events
            metadata: Optional metadata containing form field definitions (backward compatible)
                     Expected structure: {
                         "user_input": True,
                         "input_title": "Form Title",
                         "input_description": "Description",
                         "input_fields": [
                             {
                                 "field_name": "repo_name",
                                 "field_label": "Repository Name",
                                 "field_description": "...",
                                 "field_type": "text",
                                 "required": True,
                                 ...
                             }
                         ]
                     }
        """
        # If metadata with form fields is provided, send it as a separate artifact
        # This allows the UI to render a structured form instead of just text
        if metadata and metadata.get("input_fields"):
            logger.info(f"📝 Sending user input form metadata with {len(metadata.get('input_fields', []))} fields")

            # Create a DataPart artifact with the form metadata
            form_artifact = new_data_artifact(
                name="UserInputMetaData",
                description="Structured user input form definition",
                data=metadata
            )

            # Send the form metadata artifact
            await self._safe_enqueue_event(
                event_queue,
                TaskArtifactUpdateEvent(
                    artifact=form_artifact,
                    append=False,
                    last_chunk=False,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )

        # Send the status update with the text content (backward compatible)
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(
                    state=TaskState.input_required,
                    message=new_agent_text_message(content, task.context_id, task.id),
                ),
                final=True,
                context_id=task.context_id,
                task_id=task.id,
            )
        )
        logger.info(f"Task {task.id} requires user input.")

    async def _handle_streaming_chunk(self, event: dict, state: StreamState,
                                      content: str, task: A2ATask, event_queue: EventQueue):
        """Handle streaming content chunk."""
        if not content:
            return

        # NOTE: We no longer block streaming after sub-agent completion.
        # For multi-agent scenarios, the supervisor needs to synthesize results
        # from all sub-agents, so we must continue accumulating content.
        # The _get_final_content() method handles choosing the right content
        # based on whether it's a single-agent or multi-agent scenario.

        is_tool_notification = self._is_tool_notification(content, event)

        # Track current agent from tool_call events for sub-agent message grouping
        if 'tool_call' in event:
            tool_name = event['tool_call'].get('name', 'unknown')
            state.current_agent = tool_name
            logger.info(f"🎯 Current agent set to: {tool_name}")
        elif 'tool_result' in event:
            # Tool completed - keep current agent for any remaining content
            tool_name = event['tool_result'].get('name', state.current_agent)
            logger.info(f"✅ Tool completed: {tool_name}")

        # Also detect agent from event metadata if provided
        source_agent = event.get('source_agent') or state.current_agent or 'supervisor'

        # ================================================================
        # DEDUPLICATION: After a sub-agent sends complete_result, the
        # supervisor re-streams that same content as its "synthesis".
        # For single-agent scenarios (sub_agents_completed == 1), this
        # produces duplicate content in the UI. Suppress streaming
        # artifacts after sub-agent completion for single-agent flows.
        # Multi-agent flows (2+ sub-agents) still need the supervisor
        # synthesis. Tool notifications are always forwarded.
        # ================================================================
        if not is_tool_notification and state.sub_agents_completed == 1:
            # Single sub-agent already sent complete_result — supervisor is just
            # re-streaming the same content. Accumulate silently but don't forward.
            state.supervisor_content.append(content)
            logger.debug(f"⏭️ Suppressing duplicate streaming chunk after sub-agent completion ({len(content)} chars)")
            return

        # Accumulate non-notification content (unless DataPart already received)
        if not is_tool_notification and not state.sub_agent_datapart:
            state.supervisor_content.append(content)

        # Create artifact with sourceAgent metadata
        if is_tool_notification:
            artifact_name, description = self._get_artifact_name_for_notification(content, event)
            artifact = new_text_artifact(name=artifact_name, description=description, text=content)
            artifact.metadata = {'sourceAgent': source_agent, 'agentType': 'notification'}
            use_append = False
            state.seen_artifact_ids.add(artifact.artifact_id)
        elif state.streaming_artifact_id is None:
            # First streaming chunk
            artifact = new_text_artifact(
                name='streaming_result',
                description='Streaming result',
                text=content,
            )
            artifact.metadata = {'sourceAgent': source_agent, 'agentType': 'streaming'}
            state.streaming_artifact_id = artifact.artifact_id
            state.seen_artifact_ids.add(artifact.artifact_id)
            state.first_artifact_sent = True
            use_append = False
        else:
            # Subsequent chunks - reuse artifact ID
            artifact = new_text_artifact(
                name='streaming_result',
                description='Streaming result',
                text=content,
            )
            artifact.artifact_id = state.streaming_artifact_id
            artifact.metadata = {'sourceAgent': source_agent, 'agentType': 'streaming'}
            use_append = True

        await self._send_artifact(event_queue, task, artifact, append=use_append)

    async def _handle_stream_end(self, state: StreamState, task: A2ATask,
                                event_queue: EventQueue):
        """Handle end of stream without explicit completion."""
        # For multi-agent scenarios, we need to send the supervisor's synthesis
        # For single-agent scenarios where sub-agent already sent complete_result,
        # we just need to send the completion status (content already forwarded)

        # Debug: Log accumulated content before getting final
        logger.info(f"📦 Stream end - supervisor_content: {len(state.supervisor_content)} items, {sum(len(c) for c in state.supervisor_content)} chars")
        logger.info(f"📦 Stream end - sub_agent_content: {len(state.sub_agent_content)} items, {sum(len(c) for c in state.sub_agent_content)} chars")
        logger.info(f"📦 Stream end - sub_agents_completed: {state.sub_agents_completed}")

        # ================================================================
        # DEDUPLICATION: Single sub-agent scenario
        # If exactly 1 sub-agent completed, its complete_result was already
        # forwarded to the client by _handle_sub_agent_artifact. The UI
        # sets isFinal from the status-update event (final=true,
        # state=completed). Sending final_result with the same content
        # would duplicate it. Just send completion status.
        # ================================================================
        if state.sub_agents_completed == 1 and state.sub_agent_content:
            logger.info(
                "📦 Single sub-agent already sent complete_result — "
                "skipping duplicate final_result, sending completion status only"
            )
            await self._send_completion(event_queue, task)
            logger.info(f"Task {task.id} completed (stream end, single sub-agent, deduped).")
            return

        final_content, is_datapart = self._get_final_content(state)
        logger.info(f"📦 Final content for UI: {len(final_content) if isinstance(final_content, str) else 'datapart'} chars, is_datapart={is_datapart}")

        # If we have accumulated content (supervisor synthesis or sub-agent content), send it
        if final_content or is_datapart:
            # Determine artifact name based on scenario
            if state.sub_agents_completed > 1:
                artifact_name = 'final_result'
                description = 'Synthesized result from multiple agents'
                logger.info(f"Sending multi-agent synthesis ({state.sub_agents_completed} agents)")
            elif state.sub_agents_completed == 1:
                # Single sub-agent already sent its result, but we may have additional content
                artifact_name = 'final_result'
                description = 'Final result'
            else:
                artifact_name = 'partial_result'
                description = 'Partial result (stream ended)'

            if is_datapart:
                artifact = new_data_artifact(name=artifact_name, description=description, data=final_content)
            else:
                artifact = new_text_artifact(name=artifact_name, description=description, text=final_content)

            await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)

        await self._send_completion(event_queue, task)
        logger.info(f"Task {task.id} completed (stream end, {state.sub_agents_completed} sub-agents).")

    # ─────────────────────────────────────────────────────────────────────────
    # Main Execute Method
    # ─────────────────────────────────────────────────────────────────────────

    @override
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Execute the agent."""
        # Reset execution plan state for new task
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
                raise Exception("Failed to create task")
            await self._safe_enqueue_event(event_queue, task)

        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            trace_id = str(uuid.uuid4()).replace('-', '').lower()
            logger.info(f"Generated ROOT trace_id: {trace_id}")

        # Initialize state
        state = StreamState()

        try:
            async for event in self.agent.stream(query, context_id, trace_id):
                # FIX for A2A Streaming Duplication (Retry/Fallback):
                # When the agent encounters an error (e.g., orphaned tool calls) and retries,
                # the executor may have already accumulated content from the failed attempt.
                # Clear accumulated content to prevent duplication.
                if isinstance(event, dict) and event.get('clear_accumulators'):
                    logger.info("🗑️ Received clear_accumulators signal - clearing accumulated content")
                    state.supervisor_content.clear()
                    state.sub_agent_content.clear()
                    # Continue processing the event (it may also have content)

                # Handle typed A2A events (forwarded from sub-agents)
                if isinstance(event, (TaskArtifactUpdateEvent, TaskStatusUpdateEvent)):
                    # Transform and forward with correct task ID
                    if isinstance(event, TaskArtifactUpdateEvent):
                        use_append = state.first_artifact_sent
                        if not state.first_artifact_sent:
                            state.first_artifact_sent = True
                        transformed = TaskArtifactUpdateEvent(
                            append=use_append,
                            context_id=event.context_id,
                            task_id=task.id,
                            lastChunk=event.lastChunk,
                            artifact=event.artifact
                        )
                        await self._safe_enqueue_event(event_queue, transformed)

                        # 🔧 CRITICAL FIX: Accumulate content from typed artifacts for final_result
                        # Without this, _get_final_content returns empty and UI never gets final render
                        artifact = event.artifact
                        if artifact and hasattr(artifact, 'parts') and artifact.parts:
                            artifact_name = getattr(artifact, 'name', 'streaming_result')
                            is_final_artifact = artifact_name in ('complete_result', 'final_result', 'partial_result')

                            for part in artifact.parts:
                                part_root = getattr(part, 'root', None)
                                if part_root and hasattr(part_root, 'text') and part_root.text:
                                    # Accumulate streaming content
                                    if artifact_name == 'streaming_result':
                                        if not self._is_tool_notification(part_root.text, {}):
                                            state.supervisor_content.append(part_root.text)
                                    # Accumulate final results from sub-agents
                                    elif is_final_artifact:
                                        state.sub_agent_content.append(part_root.text)

                            # Increment sub_agents_completed once per final artifact
                            if is_final_artifact:
                                state.sub_agents_completed += 1
                                logger.info(f"Sub-agent completed via typed event with {artifact_name} (total: {state.sub_agents_completed})")
                    else:
                        corrected = TaskStatusUpdateEvent(
                            context_id=event.context_id,
                            task_id=task.id,
                            status=event.status
                        )
                        await self._safe_enqueue_event(event_queue, corrected)
                    continue

                if isinstance(event, A2AMessage):
                    # Convert A2A Message to status update
                    text_content = ""
                    parts = getattr(event, "parts", None)
                    if parts:
                        texts = [getattr(getattr(p, "root", None), "text", "") or "" for p in parts]
                        text_content = " ".join(texts)
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.working,
                                message=new_agent_text_message(text_content or "(streamed)", task.context_id, task.id),
                            ),
                            final=False,
                            context_id=task.context_id,
                            task_id=task.id,
                        )
                    )
                    continue

                if isinstance(event, A2ATask):
                    await self._safe_enqueue_event(event_queue, event)
                    continue

                # Handle dict events
                if not isinstance(event, dict):
                    continue

                # Handle artifact payloads (execution plan, etc.)
                artifact_payload = event.get('artifact')
                if artifact_payload:
                    artifact_name = artifact_payload.get('name', 'agent_artifact')
                    artifact_text = artifact_payload.get('text', '')

                    artifact = new_text_artifact(
                        name=artifact_name,
                        description=artifact_payload.get('description', 'Artifact from Platform Engineer'),
                        text=artifact_text,
                    )

                    # Track execution plan
                    if artifact_name in ('execution_plan_update', 'execution_plan_status_update'):
                        self._execution_plan_emitted = True
                        if artifact_name == 'execution_plan_update':
                            self._execution_plan_artifact_id = artifact.artifact_id
                        parsed = self._parse_execution_plan_text(artifact_text)
                        if parsed:
                            self._latest_execution_plan = parsed

                    await self._send_artifact(event_queue, task, artifact, append=False)
                    state.first_artifact_sent = True
                    continue

                # 1. Sub-agent artifact update
                if event.get('type') == 'artifact-update':
                    await self._handle_sub_agent_artifact(event, state, task, event_queue)
                    continue

                # Normalize content
                content = self._normalize_content(event.get('content', ''))

                # 2. ResponseFormat tool response — always the final output
                #    The LLM called the structured response tool, so this IS the
                #    final user-facing answer regardless of is_task_complete.
                #    (The LLM may set is_task_complete=False when the task "failed"
                #    but the response is still terminal — there's nothing more to do.)
                if event.get('from_response_format_tool'):
                    # Derive require_user_input from metadata.user_input
                    # (In structured mode, request_user_input tool is removed;
                    #  user input is expressed via PlatformEngineerResponse metadata)
                    metadata = event.get('metadata') or {}
                    needs_user_input = (
                        event.get('require_user_input')
                        or (isinstance(metadata, dict) and metadata.get('user_input'))
                    )
                    if needs_user_input:
                        state.user_input_required = True
                        logger.info("ResponseFormat tool requires user input — treating as input_required")
                        await self._handle_user_input_required(content, task, event_queue, metadata if isinstance(metadata, dict) else None)
                        return
                    else:
                        state.task_complete = True
                        logger.info(
                            f"ResponseFormat tool response is final output "
                            f"(is_task_complete={event.get('is_task_complete')}, "
                            f"content_len={len(content)})"
                        )
                        await self._ensure_execution_plan_completed(event_queue, task)
                        await self._handle_task_complete(event, state, content, task, event_queue)
                        return

                # 3. Task complete
                if event.get('is_task_complete'):
                    state.task_complete = True
                    await self._ensure_execution_plan_completed(event_queue, task)
                    await self._handle_task_complete(event, state, content, task, event_queue)
                    return

                # 4. User input required
                if event.get('require_user_input'):
                    state.user_input_required = True
                    # Pass metadata from event (contains form field definitions)
                    metadata = event.get('metadata')
                    await self._handle_user_input_required(content, task, event_queue, metadata)
                    return

                # 5. Streaming chunk
                await self._handle_streaming_chunk(event, state, content, task, event_queue)

            # Stream ended without explicit completion
            if not state.task_complete and not state.user_input_required:
                await self._handle_stream_end(state, task, event_queue)

        except Exception as e:
            logger.error(f"Execution error: {e}")
            await self._send_error(event_queue, task, f"Agent execution failed: {e}")

    @override
    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """
        Handle task cancellation.

        Sends a cancellation status update to the client and logs the cancellation.
        Also repairs any orphaned tool calls in the message history.
        """
        logger.info("Platform Engineer Agent: Task cancellation requested")

        task = context.current_task
        if task:
            # Repair orphaned tool calls on cancel to prevent subsequent query failures
            try:
                if hasattr(self.agent, '_repair_orphaned_tool_calls'):
                    config = self.agent.tracing.create_config(task.context_id)
                    await self.agent._repair_orphaned_tool_calls(config)
                    logger.info(f"Task {task.id}: Repaired orphaned tool calls after cancel")
            except Exception as e:
                logger.warning(f"Task {task.id}: Failed to repair orphaned tool calls on cancel: {e}")

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
