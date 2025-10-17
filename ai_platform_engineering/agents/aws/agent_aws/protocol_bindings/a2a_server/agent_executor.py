# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
from typing_extensions import override

from agent_aws.protocol_bindings.a2a_server.agent import AWSAgent
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact


logger = logging.getLogger(__name__)


class AWSAgentExecutor(AgentExecutor):
    """A2A Agent Executor for AWS Agent."""

    SUPPORTED_CONTENT_TYPES = ["text/plain"]

    def __init__(self):
        """Initialize the AWS Agent Executor."""
        self.agent = AWSAgent()
        logger.info("AWS Agent Executor initialized")

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Execute the agent with the given context.

        Args:
            context: Request context containing user input and task info
            event_queue: Event queue for publishing task updates
        """
        query = context.get_user_input()
        task = context.current_task
        context_id = context.message.contextId if context.message else None

        if not context.message:
            raise Exception('No message provided')

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        try:
            # Run agent and stream response
            async for event in self.agent.stream(query, context_id):
                if event['is_task_complete']:
                    # Send artifact chunk that client can accumulate
                    await event_queue.enqueue_event(
                        TaskArtifactUpdateEvent(
                            append=False,
                            contextId=task.contextId,
                            taskId=task.id,
                            lastChunk=False,
                            artifact=new_text_artifact(
                                name='current_result',
                                description='Result of request to agent.',
                                text=event['content'],
                            ),
                        )
                    )
                    await event_queue.enqueue_event(
                        TaskStatusUpdateEvent(
                            status=TaskStatus(state=TaskState.completed),
                            final=True,
                            contextId=task.contextId,
                            taskId=task.id,
                        )
                    )
                elif event['require_user_input']:
                    await event_queue.enqueue_event(
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.input_required,
                                message=new_agent_text_message(
                                    event['content'],
                                    task.contextId,
                                    task.id,
                                ),
                            ),
                            final=True,
                            contextId=task.contextId,
                            taskId=task.id,
                        )
                    )
                else:
                    await event_queue.enqueue_event(
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.working,
                                message=new_agent_text_message(
                                    event['content'],
                                    task.contextId,
                                    task.id,
                                ),
                            ),
                            final=False,
                            contextId=task.contextId,
                            taskId=task.id,
                        )
                    )
        except Exception as e:
            logger.error(f"Error executing agent: {e}")
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

    @override
    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Cancel the current task execution.

        Args:
            context: Request context
            event_queue: Event queue for publishing cancellation updates
        """
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
