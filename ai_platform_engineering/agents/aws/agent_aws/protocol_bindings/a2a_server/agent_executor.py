# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
from typing import Dict, Any, AsyncGenerator
from typing_extensions import override

from agent_aws.protocol_bindings.a2a_server.agent import AWSEKSAgent
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


class AWSEKSAgentExecutor(AgentExecutor):
    """A2A Agent Executor for AWS EKS Agent."""
    
    SUPPORTED_CONTENT_TYPES = ["text/plain"]
    
    def __init__(self):
        """Initialize the AWS EKS Agent Executor."""
        self.agent = AWSEKSAgent()
        logger.info("AWS EKS Agent Executor initialized")
    
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
            # Use the run_sync method from the A2A wrapper
            content = self.agent.run_sync(query)
            
            await event_queue.enqueue_event(
                TaskArtifactUpdateEvent(
                    append=False,
                    contextId=task.contextId,
                    taskId=task.id,
                    lastChunk=True,
                    artifact=new_text_artifact(
                        name='current_result',
                        description='Result of request to agent.',
                        text=content
                    )
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
