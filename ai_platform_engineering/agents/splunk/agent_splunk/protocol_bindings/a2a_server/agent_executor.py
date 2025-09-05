# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from agent_splunk.protocol_bindings.a2a_server.agent import SplunkAgent # type: ignore[import-untyped]
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
# Enable debug logging for better trace_id debugging
logging.getLogger(__name__).setLevel(logging.DEBUG)


class SplunkAgentExecutor(AgentExecutor):
    """Splunk AgentExecutor."""

    def __init__(self):
        self.agent = SplunkAgent()

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

        # Extract trace_id from A2A context - Splunk is a SUB-AGENT, should NEVER generate trace_id
        logger.debug(f"RequestContext details: message={context.message}, message.metadata={getattr(context.message, 'metadata', None) if context.message else None}")
        trace_id = extract_trace_id_from_context(context)
        if not trace_id:
            logger.warning("Splunk Agent: No trace_id from supervisor")
            # Additional debugging - check if trace_id exists in message metadata directly
            if context.message and hasattr(context.message, 'metadata') and context.message.metadata:
                logger.debug(f"Message metadata contents: {context.message.metadata}")
                if 'trace_id' in context.message.metadata:
                    trace_id = context.message.metadata['trace_id']
                    logger.info(f"Found trace_id in message metadata directly: {trace_id}")
            if not trace_id:
                trace_id = None
        else:
            logger.info(f"Splunk Agent: Using trace_id from supervisor: {trace_id}")

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
                            name='result',
                            description='Agent response',
                            text=event['content'],
                        ),
                    )
                )
                await event_queue.enqueue_event(
                    TaskStatusUpdateEvent(
                        final=True,
                        contextId=task.contextId,
                        taskId=task.id,
                        status=TaskStatus(state=TaskState.completed),
                    )
                )
            else:
                await event_queue.enqueue_event(
                    TaskStatusUpdateEvent(
                        final=False,
                        contextId=task.contextId,
                        taskId=task.id,
                        status=TaskStatus(
                            state=TaskState.working,
                            message=new_agent_text_message(
                                event['content'], task.contextId, task.id
                            ),
                        ),
                    )
                )

    @override
    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        logger.warning('Splunk agent cancel operation requested but not implemented')
        raise Exception('cancel not supported')
