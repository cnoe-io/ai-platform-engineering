# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

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
import uuid

import logging
logger = logging.getLogger(__name__)

from ai_platform_engineering.multi_agents.incident_engineer.protocol_bindings.a2a.agent import (
  AIIncidentEngineerA2ABinding
)

class AIIncidentEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIIncidentEngineerA2ABinding()


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
        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            # Incident engineer is the ROOT supervisor - generate trace_id
            # Langfuse requires 32 lowercase hex chars (no dashes)
            trace_id = str(uuid.uuid4()).replace('-', '').lower()
            logger.info(f"🔍 Incident Engineer Executor: Generated ROOT trace_id: {trace_id}")
        else:
            logger.info(f"🔍 Incident Engineer Executor: Using trace_id from context: {trace_id}")
        
        # invoke the underlying agent, using streaming results
        async for event in self.agent.stream(query, context_id, trace_id):
            if event['is_task_complete']:
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

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')
