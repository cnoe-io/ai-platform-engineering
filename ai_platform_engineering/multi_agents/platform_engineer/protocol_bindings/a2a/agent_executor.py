# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import hashlib
import inspect
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

    # Trace ID for feedback/scoring (exposed to clients)
    trace_id: Optional[str] = None

    # Execution plan state (per-request to avoid cross-user leakage)
    execution_plan_emitted: bool = False
    execution_plan_artifact_id: Optional[str] = None
    latest_execution_plan: List[Dict] = field(default_factory=list)
    current_plan_step_id: Optional[str] = None


class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

    def _is_last_plan_step_active(self, state: StreamState) -> bool:
        """Check if the last plan step is currently in_progress.

        TODO: This is a heuristic — it assumes the supervisor's streaming tokens
        are the final answer when the last plan step is active. This can be wrong
        if the LLM dynamically adds more steps after the "last" one. A more
        reliable signal would be the LangGraph framework explicitly tagging the
        supervisor's synthesis phase, but that isn't available today. Bring this
        up with the deepagents/langgraph maintainers for a deterministic signal.
        """
        if not state.execution_plan_emitted or not state.latest_execution_plan:
            return False
        last_step = state.latest_execution_plan[-1]
        return (
            last_step.get('status') == 'in_progress'
            and last_step.get('step_id') == state.current_plan_step_id
        )

    def _find_plan_step_for_agent(self, state: StreamState, agent_name: str) -> str | None:
        """Find the plan step_id for a given agent name."""
        if not state.latest_execution_plan or not agent_name:
            return None
        agent_lower = agent_name.lower()
        for step in state.latest_execution_plan:
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
          4. Bare emoji format: "⏳ Search for tickets" (no agent, no bullet)
        """
        items: list[dict] = []

        emoji_status_map = {"⏳": "pending", "🔄": "in_progress", "✅": "completed", "❌": "failed"}

        # Pattern 1: Emoji + [Agent] + description
        agent_pattern = re.compile(r'([⏳✅🔄❌])\s*\[([^\]]+)\]\s*(.+)')
        # Pattern 2: Bullet + emoji + description (no agent brackets)
        bullet_emoji_pattern = re.compile(r'-\s*([⏳✅🔄❌])\s+(.+)')
        # Pattern 3: Markdown checkbox
        checkbox_pattern = re.compile(r'-\s*\[([xX ])\]\s*(.+)')
        # Pattern 4: Bare emoji + description (no agent, no bullet) — produced by
        # _build_todo_plan_text() in agent.py when content has no [Agent] prefix
        bare_emoji_pattern = re.compile(r'^([⏳✅🔄❌])\s+(.+)')

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
                continue

            match = bare_emoji_pattern.match(stripped)
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

        return items

    async def _ensure_execution_plan_completed(self, event_queue: EventQueue, task: A2ATask, state: StreamState) -> None:
        """Ensure execution plan shows all steps completed before final result."""
        if not state.execution_plan_emitted or not state.latest_execution_plan:
            return

        # Check if any steps are still pending or in_progress
        has_unfinished = any(
            item.get('status') in ('pending', 'in_progress')
            for item in state.latest_execution_plan
        )
        if not has_unfinished:
            return

        # Mark all unfinished steps as completed
        for item in state.latest_execution_plan:
            if item.get('status') in ('pending', 'in_progress'):
                item['status'] = 'completed'

        # Send full plan update with all steps completed (structured DataPart)
        plan_data = self._build_plan_data(state.latest_execution_plan)

        artifact = Artifact(
            artifact_id=state.execution_plan_artifact_id or str(uuid.uuid4()),
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
            logger.info(f"Extracted final answer: {len(final_content)} chars (marker found at pos {idx})")
            return final_content
        return content

    def _get_final_content(self, state: StreamState) -> tuple:
        """
        Get final content with priority order:
        1. Sub-agent DataPart (structured data - e.g., Jarvis forms)
        2. Supervisor content (synthesis — preferred for both single and multi-agent)
        3. Sub-agent text content (fallback when supervisor produced nothing)

        Returns: (content, is_datapart)

        Extracts content after [FINAL ANSWER] marker to filter out
        intermediate thinking/planning messages.
        """
        if state.sub_agent_datapart:
            logger.info("_get_final_content: using sub_agent_datapart")
            return state.sub_agent_datapart, True

        # Prefer supervisor synthesis when available (covers both single and multi-agent)
        if state.supervisor_content:
            raw_content = ''.join(state.supervisor_content)
            extracted = self._extract_final_answer(raw_content)
            logger.info(
                f"_get_final_content: supervisor synthesis ({state.sub_agents_completed} sub-agents completed), "
                f"raw={len(raw_content)} chars, extracted={len(extracted)} chars"
            )
            return extracted, False

        # Fallback: use sub-agent content directly when supervisor produced nothing
        if state.sub_agent_content:
            raw_content = ''.join(state.sub_agent_content)
            extracted = self._extract_final_answer(raw_content)
            logger.info(f"_get_final_content: fallback to sub-agent content, raw={len(raw_content)} chars, extracted={len(extracted)} chars")
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
            '🔍 Querying ', '🔍 Checking ', '🔍 Searching ',
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

        # Extract tool name from content patterns
        if '✅' in content and 'completed' in content.lower():
            tool_name = re.sub(r'[✅\s]*(Supervisor:\s*Agent task\s*|Workflow:\s*)?', '', content.strip(), count=1)
            tool_name = re.sub(r'\s*completed.*', '', tool_name).strip()
            return 'tool_notification_end', f'Tool call completed: {tool_name or "unknown"}'

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

        # Extract sourceAgent from artifact metadata, event, or current state.
        # source_agent is injected by a2a_remote_agent_connect at dispatch time,
        # avoiding the race condition where state.current_agent is overwritten
        # by parallel tool calls.
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
        meta = {
            'sourceAgent': source_agent,
            'agentType': 'sub-agent',
            **existing_metadata,  # Preserve any other metadata
        }
        # Propagate plan_step_id so the UI nests sub-agent tools under the plan step.
        # Try agent-specific step first, fall back to current.
        if 'plan_step_id' not in meta and state.current_plan_step_id:
            matched = self._find_plan_step_for_agent(state, source_agent) if source_agent else None
            meta['plan_step_id'] = matched or state.current_plan_step_id

        artifact = Artifact(
            artifactId=artifact_data.get('artifactId'),
            name=artifact_name,
            description=artifact_data.get('description', f'From {source_agent}'),
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
        logger.info(
            f"Task {task.id} _handle_task_complete: "
            f"supervisor_content_len={len(state.supervisor_content)}, "
            f"sub_agent_content_len={len(state.sub_agent_content)}, "
            f"sub_agents_completed={state.sub_agents_completed}, "
            f"event_content_len={len(content)}, "
            f"from_response_format_tool={event.get('from_response_format_tool', False)}"
        )

        # If event came from ResponseFormat tool (structured response mode),
        # use content directly since it's the clean final answer.
        # The ResponseFormat output is the authoritative supervisor synthesis
        # and must always be sent.
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

        # Include trace_id in artifact metadata for client feedback/scoring
        if state.trace_id:
            artifact.metadata = artifact.metadata or {}
            artifact.metadata['trace_id'] = state.trace_id

        await self._send_artifact(event_queue, task, artifact, append=False, last_chunk=True)
        await self._send_completion(event_queue, task, trace_id=state.trace_id)
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
        # Send a final text artifact with the structured content so the UI
        # replaces any previously-streamed chunks.  Without this, the UI keeps
        # showing the raw concatenated streaming output because
        # _handle_user_input_required only used to send a status message (which
        # the UI doesn't render as the primary content area).
        if content:
            final_artifact = new_text_artifact(
                name='final_result',
                description='Complete result from Platform Engineer',
                text=content,
            )
            await self._send_artifact(event_queue, task, final_artifact, append=False, last_chunk=True)

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

        # Narration events get their own artifact type so clients (UI, Slack) can
        # render them as "thinking" rather than as main answer text.
        if event.get('is_narration'):
            artifact = new_text_artifact(
                name='narration_text',
                description='Pre-tool narration',
                text=content,
            )
            artifact.metadata = {'sourceAgent': 'supervisor', 'agentType': 'narration'}
            await self._send_artifact(event_queue, task, artifact, append=False)
            return  # Do not accumulate into supervisor_content or streaming artifact

        is_tool_notification = self._is_tool_notification(content, event)

        # Track current agent from tool_call events for sub-agent message grouping
        tool_name_raw = None
        if 'tool_call' in event:
            tool_name_raw = event['tool_call'].get('name', 'unknown')
            state.current_agent = tool_name_raw
            logger.info(f"🎯 Current agent set to: {tool_name_raw}")
        elif 'tool_result' in event:
            # Tool completed - keep current agent for any remaining content
            tool_name_raw = event['tool_result'].get('name', state.current_agent)
            logger.info(f"✅ Tool completed: {tool_name_raw}")

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

            # Tag tool notification with the correct plan step.
            # Try to match the tool's sourceAgent to its dedicated plan step
            # first; fall back to _current_plan_step_id (set when write_todos
            # marks a step as in_progress).
            plan_step_id = state.current_plan_step_id
            if source_agent and source_agent != 'supervisor':
                matched_step = self._find_plan_step_for_agent(state, source_agent)
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

        # When a plan exists, tag streaming chunks with the active plan_step_id
        # so the UI nests them under the current step as "thinking" instead of
        # rendering them below the plan as orphaned content.
        if not is_tool_notification and state.current_plan_step_id and state.execution_plan_emitted:
            artifact.metadata['plan_step_id'] = state.current_plan_step_id

        # Tag streaming chunks as final answer when the last plan step is active.
        # This lets the UI stream the answer live below the plan instead of
        # waiting for the final_result artifact.
        if not is_tool_notification and self._is_last_plan_step_active(state):
            artifact.metadata['is_final_answer'] = True
            if self._current_plan_step_id:
                artifact.metadata['plan_step_id'] = self._current_plan_step_id

        await self._send_artifact(event_queue, task, artifact, append=use_append)

    async def _handle_stream_end(self, state: StreamState, task: A2ATask,
                                event_queue: EventQueue):
        """Handle end of stream without explicit completion."""
        # Debug: Log accumulated content before getting final
        logger.info(f"📦 Stream end - supervisor_content: {len(state.supervisor_content)} items, {sum(len(c) for c in state.supervisor_content)} chars")
        logger.info(f"📦 Stream end - sub_agent_content: {len(state.sub_agent_content)} items, {sum(len(c) for c in state.sub_agent_content)} chars")
        logger.info(f"📦 Stream end - sub_agents_completed: {state.sub_agents_completed}")

        final_content, is_datapart = self._get_final_content(state)
        logger.info(f"📦 Final content for UI: {len(final_content) if isinstance(final_content, str) else 'datapart'} chars, is_datapart={is_datapart}")

        # If we have accumulated content (supervisor synthesis or sub-agent content), send it
        if final_content or is_datapart:
            artifact_name = 'final_result' if state.sub_agents_completed > 0 else 'partial_result'
            description = 'Complete result from Platform Engineer'
            if is_datapart:
                artifact = new_data_artifact(name=artifact_name, description=description, data=final_content)
            else:
                artifact = new_text_artifact(name=artifact_name, description=description, text=final_content)

            # Include trace_id in artifact metadata for client feedback/scoring
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

        # Extract user email from "by user: email\n\n..." prefix injected by UI
        user_email = None
        raw_query = query or ""
        if raw_query.startswith("by user: "):
            first_line = raw_query.split("\n", 1)[0]
            user_email = first_line.replace("by user: ", "").strip()
            if user_email:
                logger.info(f"📧 Extracted user email from message: {user_email}")

        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            trace_id = str(uuid.uuid4()).replace('-', '').lower()
            logger.info(f"Generated ROOT trace_id: {trace_id}")

        # Extract user_id from A2A message metadata (set by client or gateway),
        # falling back to the email extracted from the query prefix.
        user_id = None
        if context.message and context.message.metadata:
            meta = context.message.metadata
            if isinstance(meta, dict):
                user_id = meta.get("user_id") or meta.get("user_email")
        if not user_id and user_email:
            user_id = user_email

        # Initialize state
        state = StreamState()
        state.trace_id = trace_id  # For client feedback/scoring

        try:
            self.agent._pending_user_email = user_email
            stream_params = inspect.signature(self.agent.stream).parameters
            stream_kwargs = {"user_id": user_id} if "user_id" in stream_params else {}
            async for event in self.agent.stream(query, context_id, trace_id, **stream_kwargs):
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
                        if artifact and state.current_plan_step_id:
                            meta = dict(artifact.metadata or {})
                            if 'plan_step_id' not in meta:
                                agent_name = meta.get('sourceAgent', '')
                                matched = self._find_plan_step_for_agent(state, agent_name) if agent_name else None
                                meta['plan_step_id'] = matched or state.current_plan_step_id
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

                    # Track execution plan and emit structured DataPart
                    if artifact_name in ('execution_plan_update', 'execution_plan_status_update'):
                        state.execution_plan_emitted = True
                        parsed = self._parse_execution_plan_text(artifact_text)
                        if parsed:
                            if state.latest_execution_plan and artifact_name == 'execution_plan_status_update':
                                # Status updates only contain changed steps — merge
                                # into the existing full plan instead of replacing it.
                                # This prevents the plan from shrinking to just the
                                # updated steps, which broke _is_last_plan_step_active().
                                update_map = {s['step_id']: s for s in parsed}
                                for i, existing_step in enumerate(state.latest_execution_plan):
                                    if existing_step['step_id'] in update_map:
                                        updated = update_map[existing_step['step_id']]
                                        # Preserve completed/failed status from existing plan
                                        if existing_step.get('status') in ('completed', 'failed'):
                                            updated['status'] = existing_step['status']
                                        state.latest_execution_plan[i] = updated
                            else:
                                # Initial plan (execution_plan_update) or no existing
                                # plan — set the full plan array.
                                state.latest_execution_plan = parsed

                        # Track which step the LLM is currently working on.
                        # When write_todos marks a step as in_progress, that's
                        # the LLM declaring "I'm working on this step now" —
                        # all subsequent tool notifications inherit this step_id.
                        for step in state.latest_execution_plan:
                            if step.get('status') == 'in_progress':
                                state.current_plan_step_id = step['step_id']
                                break

                        # Mark first step as in_progress on initial plan if none set
                        if parsed and artifact_name == 'execution_plan_update':
                            if not any(s.get('status') == 'in_progress' for s in parsed):
                                parsed[0]['status'] = 'in_progress'
                                state.current_plan_step_id = parsed[0]['step_id']

                        plan_data = self._build_plan_data(state.latest_execution_plan)

                        artifact = Artifact(
                            artifact_id=state.execution_plan_artifact_id or str(uuid.uuid4()),
                            name=artifact_name,
                            description=artifact_payload.get('description', 'Structured execution plan'),
                            parts=[Part(root=DataPart(data=plan_data))],
                        )
                        if artifact_name == 'execution_plan_update':
                            state.execution_plan_artifact_id = artifact.artifact_id
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
                        await self._ensure_execution_plan_completed(event_queue, task, state)
                        await self._handle_task_complete(event, state, content, task, event_queue)
                        return

                # 3. Task complete
                if event.get('is_task_complete'):
                    state.task_complete = True
                    await self._ensure_execution_plan_completed(event_queue, task, state)
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
