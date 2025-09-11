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

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
  AIPlatformEngineerA2ABinding
)

class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

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
            if not task:
                raise Exception("Failed to create a new task from the provided message.")
            await event_queue.enqueue_event(task)
        # Debug logging to understand message structure
        logger.info(f"🔍 Platform Engineer Executor: Debugging message structure")
        logger.info(f"🔍 Platform Engineer Executor: context.message type: {type(context.message)}")
        if context.message:
            logger.info(f"🔍 Platform Engineer Executor: context.message.metadata: {getattr(context.message, 'metadata', 'NO_METADATA')}")
            logger.info(f"🔍 Platform Engineer Executor: context.message attributes: {dir(context.message)}")
        
        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)
        
        # Enhanced trace_id extraction - check multiple locations
        if not trace_id and context and context.message:
            # Try additional extraction methods for evaluation requests
            logger.info(f"🔍 Platform Engineer Executor: No trace_id from extract_trace_id_from_context, checking alternatives")
            
            # Check if there's metadata in the message
            if hasattr(context.message, 'metadata') and context.message.metadata:
                if isinstance(context.message.metadata, dict):
                    trace_id = context.message.metadata.get('trace_id')
                    if trace_id:
                        logger.info(f"🔍 Platform Engineer Executor: Found trace_id in message.metadata: {trace_id}")
            
            # Check if there's a params object with metadata
            if not trace_id and hasattr(context, 'params') and context.params:
                if hasattr(context.params, 'metadata') and context.params.metadata:
                    if isinstance(context.params.metadata, dict):
                        trace_id = context.params.metadata.get('trace_id')
                        if trace_id:
                            logger.info(f"🔍 Platform Engineer Executor: Found trace_id in params.metadata: {trace_id}")
        
        if not trace_id:
            # Platform engineer is the ROOT supervisor - generate trace_id
            # Langfuse requires 32 lowercase hex chars (no dashes)
            trace_id = str(uuid.uuid4()).replace('-', '').lower()
            logger.info(f"🔍 Platform Engineer Executor: Generated ROOT trace_id: {trace_id}")
        else:
            logger.info(f"🔍 Platform Engineer Executor: Using trace_id from context: {trace_id}")

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
