# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from agent_argocd.protocol_bindings.a2a_server.agent import ArgoCDAgent # type: ignore[import-untyped]
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
import logging

logger = logging.getLogger(__name__)


class ArgoCDAgentExecutor(AgentExecutor):
    """ArgoCD AgentExecutor Example."""

    def __init__(self):
        self.agent = ArgoCDAgent()

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = context.get_user_input()
        task = context.current_task
        context_id = context.message.contextId if context.message else None

        if not context.message:
            raise Exception('No message provided')

        if not task:
            task = new_task(context.message)
            await event_queue.enqueue_event(task)

        # Extract trace_id from A2A context - THIS IS A SUB-AGENT, should NEVER generate trace_id
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            logger.warning("ArgoCD Agent: No trace_id from supervisor")
            trace_id = None
        else:
            logger.info(f"ArgoCD Agent: Using trace_id from supervisor: {trace_id}")

        # invoke the underlying agent, using streaming results
        async for event in self.agent.stream(query, context_id, trace_id):
            if event['is_task_complete']:
                logger.info("Task complete event received. Enqueuing TaskArtifactUpdateEvent and TaskStatusUpdateEvent.")
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
                logger.info(f"Task {task.id} marked as completed.")
            elif event['require_user_input']:
                logger.info("User input required event received. Enqueuing TaskStatusUpdateEvent with input_required state.")
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
                logger.info(f"Task {task.id} requires user input.")
            else:
                logger.info("Working event received. Enqueuing TaskStatusUpdateEvent with working state.")
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
                logger.info(f"Task {task.id} is in progress.")
    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')
