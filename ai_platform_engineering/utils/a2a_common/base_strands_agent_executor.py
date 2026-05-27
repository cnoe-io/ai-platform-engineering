# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Base executor class for Strands-based agents with A2A protocol support."""

import logging

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact

from .base_strands_agent import BaseStrandsAgent

logger = logging.getLogger(__name__)


class BaseStrandsAgentExecutor(AgentExecutor):
    """
    Base executor for Strands-based agents with A2A protocol support.

    This executor bridges the synchronous Strands agent streaming
    to the asynchronous A2A protocol event queue.

    Handles:
    - Converting sync streaming to async
    - Managing event queue for status updates
    - Sending artifact updates with proper chunking
    - Error handling and logging
    """

    def __init__(self, agent: BaseStrandsAgent):
        """
        Initialize the executor with a Strands-based agent.

        Args:
            agent: Instance of BaseStrandsAgent or subclass
        """
        self.agent = agent
        agent_name = agent.get_agent_name()
        logger.info(f"{agent_name} Agent Executor initialized (Strands-based)")

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        """
        Execute the agent and stream events back through the event queue.

        This method:
        1. Extracts the user query from context
        2. Sends initial status update
        3. Streams response from Strands agent (using executor for sync → async)
        4. Chunks and sends artifacts through event queue
        5. Sends completion status

        Args:
            context: Request context with user input and current task
            event_queue: Queue for sending status/artifact update events
        """
        agent_name = self.agent.get_agent_name()
        logger.info(f"{agent_name} Agent Executor: Starting execution")

        query = context.get_user_input()
        task = context.current_task

        if not context.message:
            raise Exception('No message provided')

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        try:
            logger.info(f"Processing query: {query[:100]}...")

            # Send initial status update
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(
                        state=TaskState.working,
                        message=new_agent_text_message(
                            self.agent.get_tool_working_message(),
                            task.context_id,
                            task.id,
                        ),
                    ),
                    final=False,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )

            # Stream the response from Strands agent (async generator)
            full_response = ""
            streaming_artifact_id = None
            seen_tool_calls = set()  # Track tool calls to avoid duplicates
            agent_name_formatted = agent_name.title()

            # Process events and send to A2A event queue
            async for event in self.agent.stream_chat(query):
                # Handle tool call start events
                if "tool_call" in event:
                    tool_info = event["tool_call"]
                    tool_name = tool_info.get("name", "unknown")
                    tool_id = tool_info.get("id", "")

                    # Avoid duplicate tool notifications
                    if tool_id and tool_id in seen_tool_calls:
                        continue
                    if tool_id:
                        seen_tool_calls.add(tool_id)

                    tool_name_formatted = tool_name.title()
                    tool_notification = f"🔧 {agent_name_formatted}: Calling tool: {tool_name_formatted}\n"
                    logger.info(f"Tool call started: {tool_name}")

                    # Send tool start notification
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=new_text_artifact(
                                name='tool_notification_start',
                                description=f'Tool call started: {tool_name}',
                                text=tool_notification,
                            ),
                        )
                    )

                # Handle tool completion events
                elif "tool_result" in event:
                    tool_info = event["tool_result"]
                    tool_name = tool_info.get("name", "unknown")
                    is_error = tool_info.get("is_error", False)

                    icon = "❌" if is_error else "✅"
                    status = "failed" if is_error else "completed"
                    tool_name_formatted = tool_name.title()
                    tool_notification = f"{icon} {agent_name_formatted}: Tool {tool_name_formatted} {status}\n"
                    logger.info(f"Tool call {status}: {tool_name}")

                    # Send tool completion notification
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=False,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=new_text_artifact(
                                name='tool_notification_end',
                                description=f'Tool call {status}: {tool_name}',
                                text=tool_notification,
                            ),
                        )
                    )

                # Handle regular data streaming
                elif "data" in event:
                    chunk = event["data"]
                    full_response += chunk

                    # Stream each chunk immediately!
                    if streaming_artifact_id is None:
                        # First chunk - create new artifact
                        artifact = new_text_artifact(
                            name='streaming_result',
                            description=f'Streaming result from {agent_name}',
                            text=chunk,
                        )
                        streaming_artifact_id = artifact.artifact_id
                        use_append = False
                        logger.debug(f"🚀 {agent_name}: Sending FIRST streaming chunk (append=False)")
                    else:
                        # Subsequent chunks - reuse artifact ID
                        artifact = new_text_artifact(
                            name='streaming_result',
                            description=f'Streaming result from {agent_name}',
                            text=chunk,
                        )
                        artifact.artifact_id = streaming_artifact_id
                        use_append = True
                        logger.debug(f"🚀 {agent_name}: Streaming chunk (append=True)")

                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=use_append,
                            context_id=task.context_id,
                            task_id=task.id,
                            last_chunk=False,
                            artifact=artifact,
                        )
                    )
                # Handle error events
                elif "error" in event:
                    logger.error(f"Error from agent: {event['error']}")
                    await event_queue.enqueue_event(
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.failed,
                                message=new_agent_text_message(
                                    f"Error: {event['error']}",
                                    task.context_id,
                                    task.id,
                                ),
                            ),
                            final=True,
                            context_id=task.context_id,
                            task_id=task.id,
                        )
                    )
                    return

            # Close the streaming artifact so SSE clients can finalize reconstruction
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

            # Send final complete artifact as backup (for non-streaming clients)
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    context_id=task.context_id,
                    task_id=task.id,
                    last_chunk=True,
                    artifact=new_text_artifact(
                        name='complete_result',
                        description=f'Complete result from {agent_name}',
                        text=full_response,
                    ),
                )
            )

            # Send final completion status
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.completed),
                    final=True,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )

            logger.info(f"{agent_name} Agent Executor: Execution completed successfully")

        except Exception as e:
            logger.error(f"Error in {agent_name} Agent Executor: {e}", exc_info=True)
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    context_id=task.context_id,
                    task_id=task.id,
                    last_chunk=True,
                    artifact=new_text_artifact(
                        name='error_result',
                        description='Error result from agent.',
                        text=f"I encountered an error while processing your request: {str(e)}"
                    )
                )
            )
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.failed),
                    final=True,
                    context_id=task.context_id,
                    task_id=task.id,
                )
            )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """
        Handle task cancellation.

        Args:
            context: Request context
            event_queue: Event queue for publishing cancellation updates
        """
        agent_name = self.agent.get_agent_name()
        logger.info(f"{agent_name} Agent Executor: Task cancellation requested")

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
            logger.info(f"Task {task.id} cancelled")
