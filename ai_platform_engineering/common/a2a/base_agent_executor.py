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

from ai_platform_engineering.common.a2a.base_agent import BaseAgent

logger = logging.getLogger(__name__)


class BaseAgentExecutor(AgentExecutor, ABC):
    """
    Abstract base class for AgentExecutor implementations.

    Provides common A2A protocol handling with streaming support.
    Manages task state transitions (working → input_required → completed).

    Subclasses only need to:
    1. Initialize with their specific agent instance
    2. Optionally override execute() for custom behavior
    """

    def __init__(self, agent: BaseAgent):
        """
        Initialize the executor with an agent.

        Args:
            agent: Instance of a BaseAgent subclass
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

        # Stream responses from the underlying agent
        async for event in self.agent.stream(query, task.contextId, trace_id):
            if event['is_task_complete']:
                # Task completed successfully - send artifact and final status
                await event_queue.enqueue_event(
                    TaskArtifactUpdateEvent(
                        append=False,
                        contextId=task.contextId,
                        taskId=task.id,
                        lastChunk=True,
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
                # Agent requires user input - send input_required status
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
                # Agent is still working - send working status
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

