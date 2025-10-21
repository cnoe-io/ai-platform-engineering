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
                            task.contextId,
                            task.id,
                        ),
                    ),
                    final=False,
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )

            # Stream the response from Strands agent (async generator)
            full_response = ""

            # Process events and send to A2A event queue
            async for event in self.agent.stream_chat(query):
                if "data" in event:
                    chunk = event["data"]
                    full_response += chunk

                elif "error" in event:
                    logger.error(f"Error from agent: {event['error']}")
                    await event_queue.enqueue_event(
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.failed,
                                message=new_agent_text_message(
                                    f"Error: {event['error']}",
                                    task.contextId,
                                    task.id,
                                ),
                            ),
                            final=True,
                            contextId=task.contextId,
                            taskId=task.id,
                        )
                    )
                    return

            # Send final artifact with full response
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    contextId=task.contextId,
                    taskId=task.id,
                    lastChunk=False,
                    artifact=new_text_artifact(
                        name='current_result',
                        description='Result of request to agent.',
                        text=full_response,
                    ),
                )
            )

            # Send final completion status
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.completed),
                    final=True,
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )

            logger.info(f"{agent_name} Agent Executor: Execution completed successfully")

        except Exception as e:
            logger.error(f"Error in {agent_name} Agent Executor: {e}", exc_info=True)
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    contextId=task.contextId,
                    taskId=task.id,
                    lastChunk=True,
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
                    contextId=task.contextId,
                    taskId=task.id,
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
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )
            logger.info(f"Task {task.id} cancelled")

