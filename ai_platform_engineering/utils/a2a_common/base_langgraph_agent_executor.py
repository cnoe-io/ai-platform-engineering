# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base agent executor for A2A protocol handling with streaming support."""

import logging
from abc import ABC
from typing_extensions import override

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from cnoe_agent_utils.tracing import extract_trace_id_from_context

from .base_langgraph_agent import BaseLangGraphAgent

logger = logging.getLogger(__name__)


class BaseLangGraphAgentExecutor(AgentExecutor, ABC):
    """
    Abstract base class for LangGraph AgentExecutor implementations.

    Provides common A2A protocol handling with streaming support.
    Manages task state transitions (working → input_required → completed).

    Subclasses only need to:
    1. Initialize with their specific agent instance
    2. Optionally override execute() for custom behavior
    """

    def __init__(self, agent: BaseLangGraphAgent):
        """
        Initialize the executor with an agent.

        Args:
            agent: Instance of a BaseLangGraphAgent subclass
        """
        self.agent = agent

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """
        Execute the agent and stream events back through the event queue.

        This method:
        1. Extracts the user query and task from context
        2. Gets trace_id from parent agent (if this is a sub-agent)
        3. Streams agent responses through the event queue
        4. Handles three states: working, input_required, completed

        Args:
            context: Request context with user input and current task
            event_queue: Queue for sending status/artifact update events
        """
        query = context.get_user_input()
        task = context.current_task
        agent_name = self.agent.get_agent_name()

        if not context.message:
            raise Exception('No message provided')

        # Create new task if needed
        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        # Extract trace_id from A2A context - THIS IS A SUB-AGENT, should NEVER generate trace_id
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            logger.warning(f"{agent_name} Agent: No trace_id from supervisor")
            trace_id = None
        else:
            logger.info(f"{agent_name} Agent: Using trace_id from supervisor: {trace_id}")

        # Accumulate content from all streaming events
        accumulated_content: list[str] = []
        streaming_artifact_id: str | None = None

        # Send initial working status so clients know the task has started
        await event_queue.enqueue_event(
            TaskStatusUpdateEvent(
                status=TaskStatus(state=TaskState.working),
                final=False,
                context_id=task.context_id,
                task_id=task.id,
            )
        )

        # Stream responses from the underlying agent
        async for event in self.agent.stream(query, task.context_id, trace_id):
            if event['is_task_complete']:
                # Task completed successfully - send empty final marker (content already streamed)
                final_content = ''.join(accumulated_content) if accumulated_content else event.get('content', '')
                logger.info(
                    f"{agent_name}: Task complete. Accumulated {len(accumulated_content)} chunks, final_content length: {len(final_content)}"
                )

                # Close the streaming artifact (if any) so SSE consumers see last_chunk=True
                if streaming_artifact_id is not None:
                    closing_artifact = new_text_artifact(
                        name='streaming_result',
                        description=f'Streaming result from {agent_name} (complete)',
                        text='',
                    )
                    closing_artifact.artifact_id = streaming_artifact_id
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=True,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=True,
                            artifact=closing_artifact,
                        )
                    )

                # Emit a final artifact containing the full result for non-streaming clients
                await event_queue.enqueue_event(
                    TaskArtifactUpdateEvent(
                        append=False,
                        context_id=task.context_id,
                        task_id=task.id,
                        last_chunk=True,
                        artifact=new_text_artifact(
                            name='complete_result',
                            description=f'Complete result from {agent_name}',
                            text=final_content,
                        ),
                    )
                )
                await event_queue.enqueue_event(
                    TaskStatusUpdateEvent(
                        status=TaskStatus(state=TaskState.completed),
                        final=True,
                        context_id=task.context_id,
                        task_id=task.id,
                    )
                )
            elif event['require_user_input']:
                # Agent requires user input - send input_required status
                await event_queue.enqueue_event(
                    TaskStatusUpdateEvent(
                        status=TaskStatus(
                            state=TaskState.input_required,
                            message=new_agent_text_message(
                                event['content'],
                                task.context_id,
                                task.id,
                            ),
                        ),
                        final=True,
                        context_id=task.context_id,
                        task_id=task.id,
                    )
                )
            else:
                # Check if this is a custom event from writer() (e.g., sub-agent streaming via artifact-update)
                if 'type' in event and event.get('type') == 'artifact-update':
                    # Custom artifact-update event from sub-agent - forward as TaskArtifactUpdateEvent
                    result = event.get('result', {})
                    artifact = result.get('artifact')
                    
                    if artifact:
                        # Extract text length for logging
                        parts = artifact.get('parts', [])
                        text_len = sum(len(p.get('text', '')) for p in parts if isinstance(p, dict))
                        
                        logger.info(f"{agent_name}: Forwarding artifact-update from sub-agent ({text_len} chars)")
                        
                        # Convert dict to proper Artifact object
                        from a2a.types import Artifact, TextPart
                        artifact_obj = Artifact(
                            artifactId=artifact.get('artifactId'),
                            name=artifact.get('name', 'streaming_result'),
                            description=artifact.get('description', 'Streaming from sub-agent'),
                            parts=[TextPart(text=p.get('text', '')) for p in parts if isinstance(p, dict) and p.get('text')]
                        )
                        
                        await event_queue.enqueue_event(
                            TaskArtifactUpdateEvent(
                                append=result.get('append', True),
                                contextId=task.contextId,
                                taskId=task.id,
                                lastChunk=result.get('lastChunk', False),
                                artifact=artifact_obj,
                            )
                        )
                    continue
                
                # Agent is still working - stream tool messages immediately, accumulate AI responses
                content = event['content']

                kind = event.get('kind')
                if not kind:
                    if 'tool_call' in event:
                        kind = 'tool_call'
                    elif 'tool_result' in event:
                        kind = 'tool_result'
                    else:
                        kind = 'text_chunk'

                # Check if this is a tool call or tool result message
                if kind == 'tool_call' or 'tool_call' in event:
                    tool_info = event.get('tool_call', {})
                    tool_name = tool_info.get('name', 'unknown')
                    description = f"Tool call started: {tool_name}"
                    logger.info(f"{agent_name}: 🔧 Tool call - {tool_name}")
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=new_text_artifact(
                                name='tool_notification_start',
                                description=description,
                                text=content or description,
                            ),
                        )
                    )
                    continue

                if kind == 'tool_result' or 'tool_result' in event:
                    tool_info = event.get('tool_result', {})
                    tool_name = tool_info.get('name', 'unknown')
                    is_error = tool_info.get('is_error', False) or tool_info.get('status') == 'failed'
                    status_text = 'failed' if is_error else tool_info.get('status', 'completed')
                    description = f"Tool call {status_text}: {tool_name}"
                    logger.info(f"{agent_name}: ✅ Tool result - {tool_name} ({status_text})")
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=new_text_artifact(
                                name='tool_notification_end',
                                description=description,
                                text=content or description,
                            ),
                        )
                    )
                    continue

                if kind == 'tool_output':
                    if content:
                        await event_queue.enqueue_event(
                            TaskArtifactUpdateEvent(
                                append=False,
                                context_id=task.context_id,
                                task_id=task.id,
                                last_chunk=False,
                                artifact=new_text_artifact(
                                    name='tool_output',
                                    description=f'Tool output from {agent_name}',
                                    text=content,
                                ),
                            )
                        )
                    continue

                # Default behaviour: treat as AI text chunk
                if content:
                    accumulated_content.append(content)
                    logger.debug(
                        f"{agent_name}: Accumulated AI response chunk ({len(content)} chars). Total chunks: {len(accumulated_content)}"
                    )

                    artifact = new_text_artifact(
                        name='streaming_result',
                        description=f'Streaming result from {agent_name}',
                        text=content,
                    )

                    append_flag = False
                    if streaming_artifact_id is None:
                        streaming_artifact_id = artifact.artifact_id
                        append_flag = False
                    else:
                        artifact.artifact_id = streaming_artifact_id
                        append_flag = True

                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=append_flag,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=artifact,
                        )
                    )

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        """
        Handle task cancellation.

        Default implementation raises an exception.
        Override if cancellation support is needed.
        """
        raise Exception('cancel not supported')

