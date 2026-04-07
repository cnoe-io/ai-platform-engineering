"""Chat endpoint for Dynamic Agents with SSE streaming."""

import logging
from typing import AsyncGenerator

from ai_platform_engineering.utils.agui import AGUIEventType, emit_run_error, format_sse_event
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dynamic_agents.auth.access import can_use_agent
from dynamic_agents.auth.auth import get_current_user
from dynamic_agents.log_config import conversation_id_var
from dynamic_agents.models import ChatRequest, DynamicAgentConfig, UserContext
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class RestartRuntimeRequest(BaseModel):
    """Request body for restarting agent runtime."""

    agent_id: str
    session_id: str


class ResumeStreamRequest(BaseModel):
    """Request body for resuming an interrupted stream."""

    agent_id: str
    conversation_id: str
    form_data: str  # JSON string of form values, or rejection message
    trace_id: str | None = None


async def _generate_sse_events(
    agent_config: DynamicAgentConfig,
    mcp_servers: list,
    message: str,
    session_id: str,
    user: UserContext,
    trace_id: str | None = None,
    mongo: MongoDBService | None = None,
) -> AsyncGenerator[str, None]:
    """Generate AG-UI SSE events from agent streaming."""
    # Set conversation context for logging
    conversation_id_var.set(session_id)

    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    if mongo:
        cache.set_mongo_service(mongo)

    try:
        # Get or create runtime with user context
        runtime = await cache.get_or_create(
            agent_config,
            mcp_servers,
            session_id,
            user=user,
        )

        # Stream response with trace_id for Langfuse tracing
        async for event in runtime.stream(message, session_id, user.email, trace_id):
            yield format_sse_event(event)

    except Exception as e:
        logger.exception(f"Error streaming from agent '{agent_config.name}'")
        yield format_sse_event(emit_run_error(message=str(e)))


@router.post("/start-stream")
async def chat_start_stream(
    request: ChatRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """Start streaming a chat response from a dynamic agent.

    Uses Server-Sent Events (SSE) for real-time streaming with AG-UI events.

    Events (AG-UI standard):
    - RUN_STARTED: Stream begins
    - TEXT_MESSAGE_START/CONTENT/END: Streaming text chunks
    - TOOL_CALL_START: Tool invocation started
    - CUSTOM(TOOL_ARGS): Tool arguments payload
    - TOOL_CALL_END: Tool invocation completed
    - CUSTOM(INPUT_REQUIRED): Agent requests user input via form (HITL)
    - CUSTOM(NAMESPACE_CONTEXT): Subagent correlation metadata
    - RUN_FINISHED: Stream ends successfully
    - RUN_ERROR: Unrecoverable error

    If the agent calls request_user_input, streaming will end with a
    CUSTOM(INPUT_REQUIRED) event. Use /resume-stream to continue after user input.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access
    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get MCP servers for this agent
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    logger.info(
        f"[chat] Starting chat request: "
        f"agent='{agent.name}', user={user.email}, "
        f"provider={agent.model_provider}, model={agent.model_id}, "
        f"mcp_servers={len(mcp_servers)}, "
        f"trace_id={request.trace_id or 'auto'}"
    )

    return StreamingResponse(
        _generate_sse_events(
            agent_config=agent,
            mcp_servers=mcp_servers,
            message=request.message,
            session_id=request.conversation_id,
            user=user,
            trace_id=request.trace_id,
            mongo=mongo,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


async def _generate_resume_sse_events(
    agent_config: DynamicAgentConfig,
    mcp_servers: list,
    session_id: str,
    user: UserContext,
    form_data: str,
    trace_id: str | None = None,
    mongo: MongoDBService | None = None,
) -> AsyncGenerator[str, None]:
    """Generate AG-UI SSE events from agent resume streaming."""
    # Set conversation context for logging
    conversation_id_var.set(session_id)

    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    if mongo:
        cache.set_mongo_service(mongo)

    try:
        # Get or create runtime with user context
        runtime = await cache.get_or_create(
            agent_config,
            mcp_servers,
            session_id,
            user=user,
        )

        # Resume streaming with form data
        async for event in runtime.resume(session_id, user.email, form_data, trace_id):
            yield format_sse_event(event)

    except Exception as e:
        logger.exception(f"Error resuming stream for agent '{agent_config.name}'")
        yield format_sse_event(emit_run_error(message=str(e)))


@router.post("/resume-stream")
async def chat_resume_stream(
    request: ResumeStreamRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """Resume an interrupted stream after user provides form input.

    Called after the agent emitted a CUSTOM(INPUT_REQUIRED) event. The form_data
    should be a JSON string of the form values, or a rejection message
    if the user dismissed the form.

    Events (AG-UI standard):
    - RUN_STARTED: Stream begins
    - TEXT_MESSAGE_START/CONTENT/END: Streaming text chunks
    - TOOL_CALL_START / TOOL_CALL_END: Tool invocations
    - CUSTOM(INPUT_REQUIRED): Agent requests more user input (can repeat)
    - RUN_FINISHED: Stream ends successfully
    - RUN_ERROR: Unrecoverable error
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access
    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get MCP servers for this agent
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    logger.info(
        f"[chat] Resuming stream: agent='{agent.name}', user={user.email}, trace_id={request.trace_id or 'auto'}"
    )

    return StreamingResponse(
        _generate_resume_sse_events(
            agent_config=agent,
            mcp_servers=mcp_servers,
            session_id=request.conversation_id,
            user=user,
            form_data=request.form_data,
            trace_id=request.trace_id,
            mongo=mongo,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )


@router.post("/invoke")
async def chat_invoke(
    request: ChatRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Non-streaming chat invocation (for simple integrations).

    Returns the complete response after processing.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access
    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get MCP servers for this agent
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    logger.info(f"Invoke request: agent={agent.name}, user={user.email}, trace_id={request.trace_id or 'auto'}")

    # Collect all content from streaming
    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        request.conversation_id,
        user=user,
    )

    content_parts: list[str] = []
    tool_calls: list[dict] = []

    async for event in runtime.stream(request.message, request.conversation_id, user.email, request.trace_id):
        event_type = event.type

        if event_type == AGUIEventType.TEXT_MESSAGE_CONTENT:
            content_parts.append(event.delta)  # type: ignore[attr-defined]
        elif event_type == AGUIEventType.TOOL_CALL_START:
            tool_calls.append(
                {
                    "tool_call_id": event.tool_call_id,  # type: ignore[attr-defined]
                    "tool_name": event.tool_call_name,  # type: ignore[attr-defined]
                }
            )

    return {
        "success": True,
        "content": "".join(content_parts),
        "tool_calls": tool_calls,
        "agent_id": agent.id,
        "conversation_id": request.conversation_id,
        "trace_id": request.trace_id,
    }


@router.post("/restart-runtime")
async def restart_runtime(
    request: RestartRuntimeRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Restart the agent runtime by invalidating the cache.

    This forces the agent to reconnect to MCP servers on the next message.
    Useful when MCP servers come back online after being unavailable.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.session_id)

    # Get agent config to verify access
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access - only users who can use the agent can restart it
    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Invalidate the runtime cache
    cache = get_runtime_cache()
    invalidated = await cache.invalidate(request.agent_id, request.session_id)

    logger.info(f"Runtime restart requested: agent={agent.name}, user={user.email}, invalidated={invalidated}")

    return {
        "success": True,
        "invalidated": invalidated,
        "agent_id": request.agent_id,
        "session_id": request.session_id,
    }


class CancelStreamRequest(BaseModel):
    """Request body for cancelling an active stream."""

    agent_id: str
    session_id: str


@router.post("/cancel")
async def cancel_stream(
    request: CancelStreamRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Cancel an active streaming request.

    This sets a cancellation flag that causes the stream to exit gracefully
    at the next chunk boundary. The stream will close without emitting
    further events.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.session_id)

    logger.info(
        f"[cancel] Cancel request received: agent={request.agent_id}, session={request.session_id}, user={user.email}"
    )

    # Get agent config to verify access
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access - only users who can use the agent can cancel it
    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Cancel the stream via the runtime cache
    cache = get_runtime_cache()
    cancelled = cache.cancel_stream(request.agent_id, request.session_id)

    logger.info(f"[cancel] Cancel result: agent={agent.name}, user={user.email}, cancelled={cancelled}")

    return {
        "success": True,
        "cancelled": cancelled,
        "agent_id": request.agent_id,
        "session_id": request.session_id,
    }
