# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import hashlib
import logging
import re
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
from langchain_core.messages.base import message_to_dict
from langgraph.types import Command

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

    # Clean final content from the last model call (supervisor summary).
    # When set, used instead of supervisor_content for the final_result
    # artifact so intermediate streaming text is not included.
    final_model_content: Optional[str] = None

    # Artifact tracking
    streaming_artifact_id: Optional[str] = None
    seen_artifact_ids: set = field(default_factory=set)
    first_artifact_sent: bool = False

    # Completion tracking
    # Track count of completed sub-agents for multi-agent scenarios
    sub_agents_completed: int = 0
    task_complete: bool = False
    user_input_required: bool = False

    # When True, the executor has finished processing but continues to drain
    # remaining stream events so the LangGraph async generator completes
    # naturally.  Closing the generator early triggers a GeneratorExit that
    # the OTel instrumentor misinterprets as an error, producing a false
    # ERROR status on the root tracing span.
    stream_finished: bool = False

    # Trace ID for feedback/scoring (exposed to clients)
    trace_id: Optional[str] = None


class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

        # Execution plan state (TODO-based tracking)
        self._execution_plan_emitted = False
        self._execution_plan_artifact_id = None
        self._latest_execution_plan: list[dict] = []
        # The step_id the LLM is currently working on (set when write_todos
        # marks a step as in_progress). All tool notifications inherit this.
        self._current_plan_step_id: str | None = None

    def _is_last_plan_step_active(self) -> bool:
        """Check if the last plan step is currently in_progress.

        TODO: This is a heuristic — it assumes the supervisor's streaming tokens
        are the final answer when the last plan step is active. This can be wrong
        if the LLM dynamically adds more steps after the "last" one. A more
        reliable signal would be the LangGraph framework explicitly tagging the
        supervisor's synthesis phase, but that isn't available today. Bring this
        up with the deepagents/langgraph maintainers for a deterministic signal.
        """
        if not self._execution_plan_emitted or not self._latest_execution_plan:
            return False
        last_step = self._latest_execution_plan[-1]
        return (
            last_step.get('status') == 'in_progress'
            and last_step.get('step_id') == self._current_plan_step_id
        )

    def _find_plan_step_for_agent(self, agent_name: str) -> str | None:
        """Find the plan step_id for a given agent name."""
        if not self._latest_execution_plan or not agent_name:
            return None
        agent_lower = agent_name.lower()
        for step in self._latest_execution_plan:
            if step.get('agent', '').lower() == agent_lower:
                if step.get('status') in ('in_progress', 'pending'):
                    return step['step_id']
        return None

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

    @staticmethod
    def _make_step_id(description: str, agent: str = "Supervisor") -> str:
        """Generate a stable step_id by hashing description + agent."""
        key = f"{agent.lower().strip()}::{description.strip()}"
        return "step-" + hashlib.sha256(key.encode()).hexdigest()[:12]

    def _parse_execution_plan_text(self, text: str) -> list[dict]:
        """Parse TODO-based execution plan text into structured list.

        Returns list of dicts with keys: step_id, title, agent, status, order.

        Supports multiple formats for backwards compatibility:
          1. Emoji + [Agent] format: "⏳ [Jira] Search for tickets"
          2. Bullet + emoji format (write_todos): "- ⏳ Search for tickets"
          3. Markdown checkbox format: "- [x] step" / "- [ ] step"
        """
        items: list[dict] = []

        emoji_status_map = {"⏳": "pending", "🔄": "in_progress", "✅": "completed", "❌": "failed"}

        agent_pattern = re.compile(r'([⏳✅🔄❌])\s*\[([^\]]+)\]\s*(.+)')
        bullet_emoji_pattern = re.compile(r'-\s*([⏳✅🔄❌])\s+(.+)')
        checkbox_pattern = re.compile(r'-\s*\[([xX ])\]\s*(.+)')

        order = 0
        for line in text.strip().split('\n'):
            stripped = line.strip()

            match = agent_pattern.search(stripped)
            if match:
                status = emoji_status_map.get(match.group(1), 'pending')
                agent = match.group(2).strip()
                title = match.group(3).strip()
                step_id = self._make_step_id(title, agent)
                items.append({
                    'step_id': step_id, 'title': title, 'agent': agent,
                    'status': status, 'order': order,
                })
                order += 1
                continue

            match = bullet_emoji_pattern.match(stripped)
            if match:
                status = emoji_status_map.get(match.group(1), 'pending')
                title = match.group(2).strip()
                agent = "Supervisor"
                step_id = self._make_step_id(title, agent)
                items.append({
                    'step_id': step_id, 'title': title, 'agent': agent,
                    'status': status, 'order': order,
                })
                order += 1
                continue

            match = checkbox_pattern.match(stripped)
            if match:
                status = 'completed' if match.group(1).lower() == 'x' else 'pending'
                title = match.group(2).strip()
                agent = "Supervisor"
                step_id = self._make_step_id(title, agent)
                items.append({
                    'step_id': step_id, 'title': title, 'agent': agent,
                    'status': status, 'order': order,
                })
                order += 1

        return items

    async def _ensure_execution_plan_completed(self, event_queue: EventQueue, task: A2ATask) -> None:
        """Ensure execution plan shows all steps completed before final result."""
        if not self._execution_plan_emitted or not self._latest_execution_plan:
            return

        # Check if any steps are still pending or in_progress
        has_unfinished = any(
            item.get('status') in ('pending', 'in_progress')
            for item in self._latest_execution_plan
        )
        if not has_unfinished:
            return

        # Mark all unfinished steps as completed
        for item in self._latest_execution_plan:
            if item.get('status') in ('pending', 'in_progress'):
                item['status'] = 'completed'

        # Send full plan update with all steps completed (structured DataPart)
        plan_data = self._build_plan_data(self._latest_execution_plan)

        artifact = Artifact(
            artifact_id=self._execution_plan_artifact_id or str(uuid.uuid4()),
            name='execution_plan_status_update',
            description='All execution steps completed',
            parts=[Part(root=DataPart(data=plan_data))],
        )

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

    @staticmethod
    def _build_plan_data(steps: list[dict]) -> dict:
        """Build structured plan data dict from internal step list."""
        return {
            'steps': [
                {
                    'step_id': s.get('step_id', ''),
                    'title': s.get('title') or s.get('step', ''),
                    'agent': s.get('agent', 'Supervisor'),
                    'status': s.get('status', 'pending'),
                    'order': s.get('order', idx),
                }
                for idx, s in enumerate(steps)
            ]
        }

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
            logger.debug(f"Extracted final answer: {len(final_content)} chars (marker found at pos {idx})")
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
            return state.sub_agent_datapart, True

        # Multi-agent scenario: prefer supervisor synthesis
        # The supervisor summarizes results from all sub-agents
        if state.sub_agents_completed > 1 and state.supervisor_content:
            raw_content = ''.join(state.supervisor_content)
            logger.debug(f"Multi-agent scenario ({state.sub_agents_completed} agents): using supervisor synthesis ({len(raw_content)} chars)")
            return self._extract_final_answer(raw_content), False

        # Single agent or no supervisor content: use sub-agent content
        if state.sub_agent_content:
            raw_content = ''.join(state.sub_agent_content)
            logger.debug(f"Using sub-agent content ({len(raw_content)} chars)")
            return self._extract_final_answer(raw_content), False

        # Fallback to supervisor content even for single agent
        if state.supervisor_content:
            raw_content = ''.join(state.supervisor_content)
            logger.debug(f"Fallback to supervisor content ({len(raw_content)} chars)")
            return self._extract_final_answer(raw_content), False

        return '', False

    def _is_tool_notification(self, content: str, event: dict) -> bool:
        """Check if content is a tool notification (should not be accumulated)."""
        # Metadata-based detection
        if 'tool_call' in event or 'tool_result' in event:
            return True

        # Content-based detection
        tool_indicators = [
            '🔍 Querying ', '🔍 Checking ', '🔍 Searching ',
            '🔧 Calling ', '🔧 Supervisor:', '🔧 Workflow:',
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

        # Extract tool name from content patterns
        if '✅' in content and 'completed' in content.lower():
            # e.g. "✅ Supervisor: Agent task Search completed\n"
            # or   "✅ Workflow: some_step completed\n"
            tool_name = re.sub(r'[✅\s]*(Supervisor:\s*Agent task\s*|Workflow:\s*)?', '', content.strip(), count=1)
            tool_name = re.sub(r'\s*completed.*', '', tool_name).strip()
            return 'tool_notification_end', f'Tool call completed: {tool_name or "unknown"}'

        # e.g. "🔍 Searching the knowledge base..."
        # or   "🔧 Calling search..."
        source = event.get('source_agent', '')
        if source:
            return 'tool_notification_start', f'Tool call started: {source}'

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
        await self._safe_enqueue_event(
            event_queue,
            TaskArtifactUpdateEvent(
                append=append,
                context_id=task.context_id,
                task_id=task.id,
                last_chunk=last_chunk,
                artifact=artifact,
            )
        )

    async def _send_completion(self, event_queue: EventQueue, task: A2ATask, trace_id: str = None):
        """Send task completion status with optional trace_id for client feedback."""
        logger.info(f"📤 Sending completion status for task {task.id} (trace_id={trace_id})")
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(state=TaskState.completed),
                final=True,
                context_id=task.context_id,
                task_id=task.id,
                metadata={'trace_id': trace_id} if trace_id else None,
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

        # Accumulate final results (complete_result, final_result, partial_result)
        if artifact_name in ('complete_result', 'final_result', 'partial_result'):
            state.sub_agents_completed += 1
            logger.debug(f"Sub-agent completed with {artifact_name} (total completed: {state.sub_agents_completed})")

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

        # source_agent is injected by a2a_remote_agent_connect at dispatch time,
        # avoiding the race condition where state.current_agent is overwritten
        # by parallel tool calls.
        existing_metadata = artifact_data.get('metadata', {})
        source_agent = (
            existing_metadata.get('sourceAgent') or
            event.get('source_agent') or
            getattr(state, 'current_agent', None) or
            'sub-agent'
        )
        meta = {
            'sourceAgent': source_agent,
            'agentType': 'sub-agent',
            **existing_metadata,
        }
        # Propagate plan_step_id so the UI nests sub-agent tools under the plan step.
        # Try agent-specific step first, fall back to current.
        if 'plan_step_id' not in meta and self._current_plan_step_id:
            matched = self._find_plan_step_for_agent(source_agent) if source_agent else None
            meta['plan_step_id'] = matched or self._current_plan_step_id

        artifact = Artifact(
            artifactId=artifact_data.get('artifactId'),
            name=artifact_name,
            description=artifact_data.get('description', 'From sub-agent'),
            parts=artifact_parts,
            metadata=meta,
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
        is_datapart = False

        # Prefer the clean final model response over accumulated content
        if state.final_model_content:
            final_content = state.final_model_content
        else:
            final_content, is_datapart = self._get_final_content(state)

        # Fall back to event content if nothing accumulated
        if not final_content and not is_datapart:
            final_content = content

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

        if state.trace_id:
            artifact.metadata = artifact.metadata or {}
            artifact.metadata['trace_id'] = state.trace_id

        await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)
        await self._send_completion(event_queue, task, trace_id=state.trace_id)
        logger.info(f"Task {task.id} completed.")

    async def _handle_user_input_required(self, content: str, task: A2ATask,
                                          event_queue: EventQueue):
        """Handle user input required event."""
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
        if event.get('final_model_content'):
            state.final_model_content = event['final_model_content']

        if not content:
            return

        # NOTE: We no longer block streaming after sub-agent completion.
        # For multi-agent scenarios, the supervisor needs to synthesize results
        # from all sub-agents, so we must continue accumulating content.
        # The _get_final_content() method handles choosing the right content
        # based on whether it's a single-agent or multi-agent scenario.

        is_tool_notification = self._is_tool_notification(content, event)

        # Accumulate non-notification content (unless DataPart already received)
        if not is_tool_notification and not state.sub_agent_datapart:
            state.supervisor_content.append(content)

        # Create artifact
        if is_tool_notification:
            artifact_name, description = self._get_artifact_name_for_notification(content, event)
            artifact = new_text_artifact(name=artifact_name, description=description, text=content)

            # Tag tool notification with the correct plan step.
            # Try to match the tool's sourceAgent to its dedicated plan step
            # first; fall back to _current_plan_step_id.
            source_agent = event.get('source_agent') or 'supervisor'
            plan_step_id = self._current_plan_step_id
            if source_agent and source_agent != 'supervisor':
                matched_step = self._find_plan_step_for_agent(source_agent)
                if matched_step:
                    plan_step_id = matched_step

            artifact.metadata = {
                'sourceAgent': source_agent,
                'agentType': 'notification',
            }
            if plan_step_id:
                artifact.metadata['plan_step_id'] = plan_step_id

            use_append = False
            state.seen_artifact_ids.add(artifact.artifact_id)
        elif state.streaming_artifact_id is None:
            # First streaming chunk
            artifact = new_text_artifact(
                name='streaming_result',
                description='Streaming result',
                text=content,
            )
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
            use_append = True

        # Tag the final-answer chunks with plan_step_id and is_final_answer when
        # the last plan step is active.  Only stamp plan_step_id on final-answer
        # chunks (not all post-plan thinking chunks) so non-UI consumers (Slack
        # bot, basic A2A clients) don't receive unexpected intermediate content.
        if not is_tool_notification and self._is_last_plan_step_active():
            if artifact.metadata is None:
                artifact.metadata = {}
            artifact.metadata['is_final_answer'] = True
            if self._current_plan_step_id:
                artifact.metadata['plan_step_id'] = self._current_plan_step_id

        await self._send_artifact(event_queue, task, artifact, append=use_append)

    async def _handle_stream_end(self, state: StreamState, task: A2ATask,
                                event_queue: EventQueue):
        """Handle end of stream without explicit completion."""
        is_datapart = False

        # Prefer the clean final model response (last model call only) over
        # the accumulated supervisor_content which includes intermediate
        # streaming text the user already saw in real-time.
        if state.final_model_content:
            final_content = state.final_model_content
            logger.info(
                f"Using final_model_content ({len(final_content)} chars) "
                f"instead of supervisor_content ({sum(len(c) for c in state.supervisor_content)} chars)"
            )
        else:
            final_content, is_datapart = self._get_final_content(state)

        # If we have content, send it as the final artifact
        if final_content or is_datapart:
            if state.sub_agents_completed > 1:
                artifact_name = 'final_result'
                description = 'Synthesized result from multiple agents'
                logger.info(f"Sending multi-agent synthesis ({state.sub_agents_completed} agents)")
            elif state.sub_agents_completed == 1:
                artifact_name = 'final_result'
                description = 'Final result'
            else:
                artifact_name = 'final_result' if state.final_model_content else 'partial_result'
                description = 'Final result' if state.final_model_content else 'Partial result (stream ended)'

            if is_datapart:
                artifact = new_data_artifact(name=artifact_name, description=description, data=final_content)
            else:
                artifact = new_text_artifact(name=artifact_name, description=description, text=final_content)

            if state.trace_id:
                artifact.metadata = artifact.metadata or {}
                artifact.metadata['trace_id'] = state.trace_id

            await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)

        await self._send_completion(event_queue, task, trace_id=state.trace_id)
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
        self._current_plan_step_id = None

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

        # Check for resume command from form submission
        # Resume metadata can come from:
        # 1. context.metadata (legacy)
        # 2. Message parts containing DataPart with resume key (A2A SDK)
        resume_cmd: Optional[Command] = None
        metadata = getattr(context, "metadata", None) or {}

        # Also check message parts for DataPart containing resume
        if context.message and hasattr(context.message, 'parts'):
            for part in context.message.parts:
                # Handle Part wrapper (root.data pattern)
                if hasattr(part, 'root') and hasattr(part.root, 'data'):
                    data_content = part.root.data
                    if isinstance(data_content, dict) and 'resume' in data_content:
                        logger.info("📦 Found resume command in message DataPart")
                        metadata = data_content
                        break
                # Handle direct DataPart
                elif hasattr(part, 'data') and isinstance(part.data, dict):
                    if 'resume' in part.data:
                        logger.info("📦 Found resume command in direct DataPart")
                        metadata = part.data
                        break
                # Handle dict parts
                elif isinstance(part, dict) and 'data' in part:
                    data_content = part.get('data', {})
                    if isinstance(data_content, dict) and 'resume' in data_content:
                        logger.info("📦 Found resume command in dict DataPart")
                        metadata = data_content
                        break

        if isinstance(metadata, dict) and metadata.get("resume"):
            # Convert frontend decisions to HITL response format
            logger.info("🔄 Processing resume command from form submission")
            decisions = metadata["resume"].get("decisions", [])
            responses = []
            is_response = False

            for decision in decisions:
                decision_type = decision.get("type", "")
                edited_action = decision.get("edited_action") or {}
                action_name = (
                    decision.get("action_name", "")
                    or edited_action.get("name", "")
                )
                logger.info(f"  Decision: type={decision_type}, action={action_name}")

                # Extract args: prefer edited_action.args (LangGraph HITL format),
                # fall back to legacy decision.args.args path
                inner_args = edited_action.get("args") or decision.get("args", {}).get("args", {})

                # Log user's form selections (passed via HITL resume mechanism)
                if action_name == "CAIPEAgentResponse" and isinstance(inner_args, dict):
                    user_inputs = inner_args.get("user_inputs", {})

                    if not user_inputs:
                        meta = inner_args.get("metadata", {})
                        input_fields = meta.get("input_fields", [])
                        if input_fields:
                            logger.info(f"  📋 Extracting values from {len(input_fields)} input_fields")
                            user_inputs = {}
                            for fld in input_fields:
                                field_name = fld.get("field_name", "")
                                field_value = fld.get("value")
                                if field_name and field_value is not None:
                                    user_inputs[field_name] = field_value

                    if user_inputs:
                        logger.info(f"  📋 Form has {len(user_inputs)} user inputs (passed via HITL resume)")

                if decision_type in ("accept", "approve"):
                    responses.append({"type": "approve"})
                elif decision_type == "edit":
                    responses.append({
                        "type": "edit",
                        "edited_action": {
                            "name": action_name,
                            "args": inner_args,
                        }
                    })
                elif decision_type == "reject":
                    reject_message = decision.get("message", "User rejected the request")
                    responses.append({
                        "type": "reject",
                        "message": reject_message
                    })
                elif decision_type == "response":
                    is_response = True
                    message = decision.get("args", "") or decision.get("message", "")
                    responses.append({
                        "type": "reject",
                        "message": message
                    })

            logger.info(f"📦 Created resume Command with {len(responses)} decisions")
            # LangChain HITL expects resume={"decisions": [...]}
            resume_cmd = Command(
                resume={"decisions": responses},
                update={"inputs": [{"tasks": []}]} if is_response else {}
            )
            query = None  # Don't use query when resuming

        # Fallback: When UI sends form data as plain text (not DataPart resume),
        # detect input_required state and construct a resume Command from the text.
        # The UI's handleUserInputSubmit sends "key: value\nkey: value\n..." as a
        # regular message. We parse it and build the HITL approve response so the
        # interrupted graph (CAIPEAgentResponse) can continue.
        if resume_cmd is None and task and hasattr(task, 'status') and hasattr(task.status, 'state'):
            task_state = task.status.state if task.status else None
            if task_state == TaskState.input_required:
                raw_text = context.get_user_input() or ""
                # Strip "by user: email\n\n" prefix if present
                form_text = raw_text
                if form_text.startswith("by user: "):
                    parts = form_text.split("\n\n", 1)
                    form_text = parts[1] if len(parts) > 1 else parts[0]

                # Parse key: value pairs from the text
                user_inputs = {}
                for line in form_text.strip().split("\n"):
                    if ": " in line:
                        key, _, value = line.partition(": ")
                        user_inputs[key.strip()] = value.strip()

                if user_inputs:
                    logger.info(f"📝 Detected form text submission for input_required task: {len(user_inputs)} fields")
                    for k, v in user_inputs.items():
                        logger.info(f"  📋 {k}: {v}")

                    # Build resume with approve + edited args containing user inputs
                    resume_cmd = Command(
                        resume={"decisions": [{
                            "type": "approve",
                            "edited_action": {
                                "name": "CAIPEAgentResponse",
                                "args": {
                                    "args": {
                                        "user_inputs": user_inputs,
                                        "metadata": {}
                                    }
                                }
                            }
                        }]}
                    )
                    query = None  # Don't use query when resuming
                    logger.info(f"📦 Constructed resume Command from form text for task {task.id}")

        # Extract user email from "by user: email\n\n..." prefix injected by UI
        user_email = None
        raw_query = context.get_user_input() or ""
        if raw_query.startswith("by user: "):
            first_line = raw_query.split("\n", 1)[0]
            user_email = first_line.replace("by user: ", "").strip()
            if user_email:
                logger.info(f"📧 Extracted user email from message: {user_email}")

        # Initialize state
        state = StreamState()
        state.trace_id = trace_id

        try:
            async for event in self.agent.stream(query, context_id, trace_id, command=resume_cmd, user_email=user_email):
                # Drain remaining events after the executor has finished
                # processing to let the LangGraph generator close naturally.
                if state.stream_finished:
                    continue

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

                        # Propagate plan_step_id to sub-agent artifacts so
                        # the UI can nest them under the correct plan step.
                        # Try agent-specific step first, fall back to current.
                        artifact = event.artifact
                        if artifact and self._current_plan_step_id:
                            meta = dict(artifact.metadata or {})
                            if 'plan_step_id' not in meta:
                                agent_name = meta.get('sourceAgent', '')
                                matched = self._find_plan_step_for_agent(agent_name) if agent_name else None
                                meta['plan_step_id'] = matched or self._current_plan_step_id
                                artifact = Artifact(
                                    artifactId=artifact.artifactId,
                                    name=artifact.name,
                                    description=artifact.description,
                                    parts=artifact.parts,
                                    metadata=meta,
                                )

                        transformed = TaskArtifactUpdateEvent(
                            append=use_append,
                            context_id=event.context_id,
                            task_id=task.id,
                            lastChunk=event.lastChunk,
                            artifact=artifact,
                        )
                        await self._safe_enqueue_event(event_queue, transformed)
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

                # Handle interrupt events (HITL forms)
                if event.get('event_type') == 'interrupt':
                    msg = event.get('message')
                    if msg and hasattr(msg, 'tool_calls') and msg.tool_calls:
                        # Extract structured form metadata from CAIPEAgentResponse tool calls
                        # The frontend expects a UserInputMetaData artifact with input_fields
                        form_metadata = None
                        form_response_text = None
                        for tc in msg.tool_calls:
                            tc_name = tc.get("name", "")
                            if tc_name == "CAIPEAgentResponse":
                                tc_args = tc.get("args", {})
                                form_response_text = tc_args.get("response")
                                meta = tc_args.get("metadata", {})
                                input_fields = meta.get("input_fields", [])
                                if input_fields:
                                    form_metadata = {
                                        "user_input": True,
                                        "input_title": meta.get("input_title"),
                                        "input_description": meta.get("input_description"),
                                        "input_fields": input_fields,
                                        "response": form_response_text,
                                    }
                                    break

                        if not form_metadata:
                            # Fallback: wrap the raw AIMessage for backward compatibility
                            data = message_to_dict(msg)["data"]
                            ak = data.get("additional_kwargs") or {}
                            ak["agent_type"] = event.get("agent_type", "user_input")
                            data["additional_kwargs"] = ak
                            form_metadata = data
                            logger.warning(f"Task {task.id}: Could not extract input_fields from interrupt, using raw message data")

                        # Send response text as a content message before the form
                        if form_response_text:
                            await self._safe_enqueue_event(
                                event_queue,
                                TaskStatusUpdateEvent(
                                    status=TaskStatus(
                                        state=TaskState.working,
                                        message=new_agent_text_message(
                                            form_response_text,
                                            task.context_id,
                                            task.id
                                        ),
                                    ),
                                    final=False,
                                    context_id=task.context_id,
                                    task_id=task.id,
                                )
                            )

                        # Send as UserInputMetaData artifact (matching multi-agent executor format)
                        # This ensures the frontend receives the form before the stream ends
                        form_artifact = Artifact(
                            artifact_id=str(uuid.uuid4()),
                            name="UserInputMetaData",
                            description="Structured user input form definition",
                            parts=[Part(root=DataPart(data=form_metadata))]
                        )
                        await self._send_artifact(event_queue, task, form_artifact, append=False)
                        logger.info(f"Task {task.id} sent UserInputMetaData artifact with {len(form_metadata.get('input_fields', []))} fields.")

                        # Then send the input-required status (final=True will end the stream)
                        status_text = form_response_text or "Please provide the required information."
                        await self._safe_enqueue_event(
                            event_queue,
                            TaskStatusUpdateEvent(
                                status=TaskStatus(
                                    state=TaskState.input_required,
                                    message=new_agent_text_message(
                                        status_text,
                                        task.context_id,
                                        task.id
                                    ),
                                ),
                                final=True,
                                context_id=task.context_id,
                                task_id=task.id,
                            )
                        )

                        state.user_input_required = True
                        logger.info(f"Task {task.id} requires user input (HITL form).")
                        state.stream_finished = True
                        continue
                    continue

                # Handle artifact payloads (execution plan, etc.)
                artifact_payload = event.get('artifact')
                if artifact_payload:
                    artifact_name = artifact_payload.get('name', 'agent_artifact')
                    artifact_text = artifact_payload.get('text', '')

                    # Track execution plan and emit structured DataPart
                    if artifact_name in ('execution_plan_update', 'execution_plan_status_update'):
                        self._execution_plan_emitted = True
                        parsed = self._parse_execution_plan_text(artifact_text)
                        if parsed:
                            if self._latest_execution_plan and artifact_name == 'execution_plan_status_update':
                                # Status updates only contain changed steps — merge
                                # into the existing full plan instead of replacing it.
                                # This prevents the plan from shrinking to just the
                                # updated steps, which broke _is_last_plan_step_active().
                                update_map = {s['step_id']: s for s in parsed}
                                for i, existing_step in enumerate(self._latest_execution_plan):
                                    if existing_step['step_id'] in update_map:
                                        updated = update_map[existing_step['step_id']]
                                        # Preserve completed/failed status from existing plan
                                        if existing_step.get('status') in ('completed', 'failed'):
                                            updated['status'] = existing_step['status']
                                        self._latest_execution_plan[i] = updated
                            else:
                                # Initial plan (execution_plan_update) or no existing
                                # plan — set the full plan array.
                                self._latest_execution_plan = parsed

                        # Track which step the LLM is currently working on.
                        for step in self._latest_execution_plan:
                            if step.get('status') == 'in_progress':
                                self._current_plan_step_id = step['step_id']
                                break

                        # Mark first step as in_progress on initial plan if none set
                        if parsed and artifact_name == 'execution_plan_update':
                            if not any(s.get('status') == 'in_progress' for s in parsed):
                                parsed[0]['status'] = 'in_progress'
                                self._current_plan_step_id = parsed[0]['step_id']

                        plan_data = self._build_plan_data(self._latest_execution_plan)

                        artifact = Artifact(
                            artifact_id=self._execution_plan_artifact_id or str(uuid.uuid4()),
                            name=artifact_name,
                            description=artifact_payload.get('description', 'Structured execution plan'),
                            parts=[Part(root=DataPart(data=plan_data))],
                        )
                        if artifact_name == 'execution_plan_update':
                            self._execution_plan_artifact_id = artifact.artifact_id
                            # Do NOT reset state.streaming_artifact_id here.
                            # Resetting it causes post-plan chunks to open a new
                            # artifact (Y) while clients tracking the pre-plan
                            # artifact (X) never receive the final answer.
                            # plan_step_id is stamped on final-answer chunks via
                            # _is_last_plan_step_active(), so the UI can still
                            # nest the answer under the plan without a new artifact.
                    else:
                        artifact = new_text_artifact(
                            name=artifact_name,
                            description=artifact_payload.get('description', 'Artifact from Platform Engineer'),
                            text=artifact_text,
                        )

                    await self._send_artifact(event_queue, task, artifact, append=False)
                    state.first_artifact_sent = True
                    continue

                # 1. Sub-agent artifact update
                if event.get('type') == 'artifact-update':
                    await self._handle_sub_agent_artifact(event, state, task, event_queue)
                    continue

                # Normalize content
                content = self._normalize_content(event.get('content', ''))

                # Capture clean final model content if provided by the agent
                if event.get('final_model_content'):
                    state.final_model_content = event['final_model_content']

                # 2. ResponseFormat tool response (structured response mode)
                #    The LLM called the structured response tool — this IS the
                #    final user-facing answer. Use its content directly instead
                #    of accumulated streaming text. Reuse the streaming artifact
                #    ID so the UI replaces the intermediate narration.
                if event.get('from_response_format_tool') and content:
                    state.task_complete = True
                    await self._ensure_execution_plan_completed(event_queue, task)

                    metadata = event.get('metadata') or {}
                    needs_user_input = (
                        event.get('require_user_input')
                        or (isinstance(metadata, dict) and metadata.get('user_input'))
                    )
                    if needs_user_input:
                        state.user_input_required = True
                        logger.info("ResponseFormat tool requires user input")

                        artifact = new_text_artifact(
                            name='final_result',
                            description='Complete result from Platform Engineer',
                            text=content,
                        )
                        if state.streaming_artifact_id:
                            artifact.artifact_id = state.streaming_artifact_id
                        await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)

                        await self._handle_user_input_required(content, task, event_queue)
                        state.stream_finished = True
                        continue

                    logger.info(
                        f"📤 ResponseFormat content preview ({len(content)} chars): "
                        f"{content[:300]}{'...' if len(content) > 300 else ''}"
                    )

                    artifact = new_text_artifact(
                        name='final_result',
                        description='Complete result from Platform Engineer',
                        text=content,
                    )
                    reused_id = False
                    if state.streaming_artifact_id:
                        artifact.artifact_id = state.streaming_artifact_id
                        reused_id = True
                    logger.info(
                        f"📤 final_result artifact: id={artifact.artifact_id}, "
                        f"reused_streaming_id={reused_id}, parts={len(artifact.parts)}"
                    )
                    await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)
                    await self._send_completion(event_queue, task, trace_id=state.trace_id)
                    logger.info(f"Task {task.id} completed (ResponseFormat tool, {len(content)} chars).")
                    state.stream_finished = True
                    continue

                # 3. Task complete
                if event.get('is_task_complete'):
                    state.task_complete = True
                    await self._ensure_execution_plan_completed(event_queue, task)
                    await self._handle_task_complete(event, state, content, task, event_queue)
                    state.stream_finished = True
                    continue

                # 4. User input required
                if event.get('require_user_input'):
                    state.user_input_required = True
                    await self._handle_user_input_required(content, task, event_queue)
                    state.stream_finished = True
                    continue

                # 4. Streaming chunk
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
