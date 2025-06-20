# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

import time
import logging
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

from ai_platform_engineering.mas.platform_engineer.protocol_bindings.a2a.agent import (
  AIPlatformEngineerA2ABinding
)
from ai_platform_engineering.utils.tracing import PhoenixTracing, get_current_trace_id

logger = logging.getLogger(__name__)

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
        message_id = context.message.messageId if context.message else None

        if not context.message:
          raise Exception('No message provided')

        if not task:
          task = new_task(context.message)
          await event_queue.enqueue_event(task)

        # Initialize tracing if not already done
        PhoenixTracing.initialize()
        tracer = PhoenixTracing.get_tracer()
        
        # Create root span for the entire user request
        start_time = time.time()
        with tracer.start_as_current_span("user_request") as root_span:
            # Add comprehensive attributes to root span
            root_span.set_attribute("user.query", query[:500])  # Truncate long queries
            root_span.set_attribute("request.id", message_id or "unknown")
            root_span.set_attribute("context.id", context_id or "unknown")
            root_span.set_attribute("task.id", task.id)
            root_span.set_attribute("agent.type", "platform_engineer")
            root_span.set_attribute("trace.id", get_current_trace_id() or "unknown")
            
            logger.info(f"Starting user request trace: {query[:100]}...")
            
            try:
                # Track events for streaming progress
                event_count = 0
                working_events = 0
                
                # invoke the underlying agent, using streaming results
                async for event in self.agent.stream(query, context_id):
                    event_count += 1
                    
                    if event['is_task_complete']:
                        # Final completion event
                        root_span.set_attribute("completion.status", "success")
                        root_span.set_attribute("completion.content_length", len(event['content']))
                        root_span.set_attribute("events.total", event_count)
                        root_span.set_attribute("events.working", working_events)
                        
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
                        logger.info(f"Request completed successfully with {event_count} events")
                        
                    elif event['require_user_input']:
                        # Input required event
                        root_span.set_attribute("completion.status", "input_required")
                        root_span.set_attribute("completion.message", event['content'][:200])
                        
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
                        # Working/progress event
                        working_events += 1
                        root_span.add_event(
                            f"progress_update_{working_events}",
                            attributes={"content": event['content'][:100]}
                        )
                        
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
                # Handle errors and add to span
                root_span.set_attribute("completion.status", "error")
                root_span.set_attribute("error.type", type(e).__name__)
                root_span.set_attribute("error.message", str(e))
                root_span.record_exception(e)
                logger.error(f"Request failed with error: {e}")
                raise
                
            finally:
                # Record final timing
                duration_ms = (time.time() - start_time) * 1000
                root_span.set_attribute("duration_ms", duration_ms)
                logger.info(f"Request completed in {duration_ms:.2f}ms")

    @override
    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise Exception('cancel not supported')
