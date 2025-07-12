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

from .agent import RAGAgent

# Configure logging
import logging
logger = logging.getLogger(__name__)

class RAGAgentExecutor(AgentExecutor):
    """
    Executes user queries using the RAGAgent.
    """
    def __init__(self, milvus_uri: str):
        self.agent = RAGAgent(milvus_uri=milvus_uri)
        logger.info("Initialized RAGAgentExecutor")

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        query = context.get_user_input()
        task = context.current_task
        _ = context.message.contextId if context.message else None

        if not context.message:
            raise Exception('No message provided')

        if not task:
            task = new_task(context.message)
            event_queue.enqueue_event(task)

        try:
            # Get answer from RAG agent
            answer = self.agent.answer_question(query)

            # Send the final result
            event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    contextId=task.contextId,
                    taskId=task.id,
                    lastChunk=True,
                    artifact=new_text_artifact(
                        name='current_result',
                        description='Result of request to agent.',
                        text=answer,
                    ),
                )
            )
            event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.completed),
                    final=True,
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )
        except Exception as e:
            # Handle errors by sending an error message
            error_msg = f"Error processing query: {str(e)}"
            event_queue.enqueue_event(
                TaskStatusUpdateEvent(
                    status=TaskStatus(
                        state=TaskState.failed,
                        message=new_agent_text_message(
                            error_msg,
                            task.contextId,
                            task.id,
                        ),
                    ),
                    final=True,
                    contextId=task.contextId,
                    taskId=task.id,
                )
            )

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')