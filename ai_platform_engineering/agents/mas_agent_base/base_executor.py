"""Base executor with common event handling logic."""

import logging
from typing import Optional

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
from typing_extensions import override

from .base_agent import BaseAgent

logger = logging.getLogger(__name__)


class BaseAgentExecutor(AgentExecutor):
    """Base executor with common event handling logic."""

    def __init__(self, agent: BaseAgent, agent_name: Optional[str] = None):
        """
        Args:
            agent: The underlying agent implementation
            agent_name: Name for logging (defaults to agent.agent_name)
        """
        self.agent = agent
        self.agent_name = agent_name or agent.agent_name
        self.logger = logging.getLogger(f"{__name__}.{self.agent_name}")

    async def initialize(self):
        """Initialize the agent and its dependencies."""
        await self.agent.initialize()

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Common execution logic with event handling."""
        query = context.get_user_input()
        task = context.current_task
        context_id = context.message.context_id if context.message else None

        if not context.message:
            raise Exception("No message provided")

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        # Extract trace_id from A2A context (sub-agent, never generate)
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            self.logger.warning(f"{self.agent_name}: No trace_id from supervisor")
        else:
            self.logger.info(f"{self.agent_name}: Using trace_id from supervisor: {trace_id}")

        # Invoke agent with streaming
        async for event in self.agent.stream(query, context_id, trace_id):
            await self._handle_agent_event(event, task, event_queue)

    async def _handle_agent_event(self, event: dict, task, event_queue: EventQueue):
        """Handle different event types consistently."""
        if event["is_task_complete"]:
            self.logger.info("Task complete. Enqueuing completion events.")
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    contextId=task.contextId,
                    taskId=task.id,
                    lastChunk=True,
                    artifact=new_text_artifact(
                        name="current_result",
                        description="Result of request to agent.",
                        text=event["content"],
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
            self.logger.info(f"Task {task.id} marked as completed.")

        elif event["require_user_input"]:
            self.logger.info("User input required. Enqueuing input_required event.")
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(
                        state=TaskState.input_required,
                        message=new_agent_text_message(
                            event["content"],
                            task.contextId,
                            task.id,
                        ),
                    ),
                    final=True,
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )
            self.logger.info(f"Task {task.id} requires user input.")

        else:
            self.logger.debug("Working event. Enqueuing working state.")
            await event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(
                        state=TaskState.working,
                        message=new_agent_text_message(
                            event["content"],
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
    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Cancel operation (not currently supported)."""
        raise NotImplementedError("cancel not supported")
