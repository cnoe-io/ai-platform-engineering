# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import logging
import uuid
from typing_extensions import override

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    Message as A2AMessage,
    Task as A2ATask,
    TaskStatusUpdateEvent as A2ATaskStatusUpdateEvent,
    TaskArtifactUpdateEvent as A2ATaskArtifactUpdateEvent,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact
from cnoe_agent_utils.tracing import extract_trace_id_from_context

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
  AIPlatformEngineerA2ABinding
)

logger = logging.getLogger(__name__)

class AIPlatformEngineerA2AExecutor(AgentExecutor):
    """AI Platform Engineer A2A Executor."""

    def __init__(self):
        self.agent = AIPlatformEngineerA2ABinding()

    async def _safe_enqueue_event(self, event_queue: EventQueue, event) -> None:
        """Safely enqueue an event, handling closed queue gracefully."""
        try:
            await event_queue.enqueue_event(event)
        except Exception as e:
            # Check if the error is related to queue being closed
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                logger.warning(f"Queue is closed, cannot enqueue event: {type(event).__name__}")
                # Don't re-raise the exception for closed queue - this is expected during shutdown
            else:
                logger.error(f"Failed to enqueue event {type(event).__name__}: {e}")
                raise

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
            await self._safe_enqueue_event(event_queue, task)

        # Extract trace_id from A2A context (or generate if root)
        trace_id = extract_trace_id_from_context(context)
        
        # Enhanced trace_id extraction - check multiple locations
        if not trace_id and context and context.message:
            # Try additional extraction methods for evaluation requests
            logger.info("🔍 Platform Engineer Executor: No trace_id from extract_trace_id_from_context, checking alternatives")
            
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

        try:
            # invoke the underlying agent, using streaming results
            async for event in self.agent.stream(query, context_id, trace_id):
                # Handle typed A2A events directly
                if isinstance(event, (A2ATaskArtifactUpdateEvent, A2ATaskStatusUpdateEvent)):
                    logger.info(f"Executor: Enqueuing streamed A2A event: {type(event).__name__}")
                    await self._safe_enqueue_event(event_queue, event)
                    continue
                elif isinstance(event, A2AMessage):
                    logger.info("Executor: Converting A2A Message to TaskStatusUpdateEvent (working)")
                    text_content = ""
                    parts = getattr(event, "parts", None)
                    if parts:
                        texts = []
                        for part in parts:
                            root = getattr(part, "root", None)
                            txt = getattr(root, "text", None) if root is not None else None
                            if txt:
                                texts.append(txt)
                        text_content = " ".join(texts)
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskStatusUpdateEvent(
                            status=TaskStatus(
                                state=TaskState.working,
                                message=new_agent_text_message(
                                    text_content or "(streamed message)",
                                    task.contextId,
                                    task.id,
                                ),
                            ),
                            final=False,
                            contextId=task.contextId,
                            taskId=task.id,
                        )
                    )
                    continue
                elif isinstance(event, A2ATask):
                    logger.info("Executor: Received A2A Task event; enqueuing.")
                    await self._safe_enqueue_event(event_queue, event)
                    continue
                if event['is_task_complete']:
                  logger.info("Task complete event received. Enqueuing TaskArtifactUpdateEvent and TaskStatusUpdateEvent.")
                  await self._safe_enqueue_event(
                    event_queue,
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
                  await self._safe_enqueue_event(
                    event_queue,
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
                  await self._safe_enqueue_event(
                    event_queue,
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
                  await self._safe_enqueue_event(
                    event_queue,
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
        except Exception as e:
            logger.error(f"Error during agent execution: {e}")
            # Try to enqueue a failure status if the queue is still open
            try:
                await self._safe_enqueue_event(
                    event_queue,
                    TaskStatusUpdateEvent(
                        status=TaskStatus(
                            state=TaskState.failed,
                            message=new_agent_text_message(
                                f"Agent execution failed: {str(e)}",
                                task.contextId,
                                task.id,
                            ),
                        ),
                        final=True,
                        contextId=task.contextId,
                        taskId=task.id,
                    )
                )
            except Exception as enqueue_error:
                logger.error(f"Failed to enqueue error status: {enqueue_error}")
            raise

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')
