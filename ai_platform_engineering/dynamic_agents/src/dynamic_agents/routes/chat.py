"""Chat endpoint for Dynamic Agents with SSE streaming."""

import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from dynamic_agents.auth.auth import get_user_context
from dynamic_agents.log_config import conversation_id_var
from dynamic_agents.models import ChatRequest, ClientContext, DynamicAgentConfig, UserContext
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.stream_encoders import StreamEncoder, get_encoder
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class RestartRuntimeRequest(BaseModel):
    """Request body for restarting agent runtime."""

    agent_id: str
    conversation_id: str


class ResumeStreamRequest(BaseModel):
    """Request body for resuming an interrupted stream."""

    agent_id: str
    conversation_id: str
    form_data: str  # JSON string of form values, or rejection message
    protocol: str = Field("custom", pattern=r"^(custom|agui)$")
    trace_id: str | None = None


async def _generate_sse_events(
    agent_config: DynamicAgentConfig,
    mcp_servers: list,
    message: str,
    session_id: str,
    user: UserContext,
    encoder: StreamEncoder,
    trace_id: str | None = None,
    mongo: MongoDBService | None = None,
    client_context: ClientContext | None = None,
) -> AsyncGenerator[str, None]:
    """Generate SSE events from agent streaming.

    The encoder handles all protocol-specific formatting. This function
    only orchestrates the runtime lifecycle and error handling.
    """
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
            client_context=client_context,
        )

        # Stream response with trace_id for Langfuse tracing
        async for frame in runtime.stream(message, session_id, user.email, trace_id, encoder):
            yield frame

    except Exception as e:
        logger.exception(f"Error streaming from agent '{agent_config.name}'")
        for frame in encoder.on_run_error(str(e)):
            yield frame


@router.post("/stream/start")
async def chat_start_stream(
    request: ChatRequest,
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """Start streaming a chat response from a dynamic agent.

    Uses Server-Sent Events (SSE) for real-time streaming.

    Body field ``protocol`` selects the wire format:
        - "custom" (default): legacy SSE event types
        - "agui": AG-UI protocol

    Events depend on the selected protocol. With protocol=custom:
    - content: Streaming text chunks
    - tool_start: Tool invocation started
    - tool_end: Tool invocation completed
    - input_required: Agent requests user input via form (HITL)
    - warning: Non-fatal issue
    - error: Unrecoverable error
    - done: Streaming complete

    If the agent calls request_user_input, streaming will end with an
    input_required event. Use /stream/resume to continue after user input.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config (access control is handled by the gateway)
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get MCP servers for this agent and its subagents
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    logger.info(
        f"[chat] Starting chat request: "
        f"agent='{agent.name}', user={user.email}, "
        f"provider={agent.model.provider}, model={agent.model.id}, "
        f"mcp_servers={len(mcp_servers)}, "
        f"protocol={request.protocol}, "
        f"trace_id={request.trace_id or 'auto'}"
    )

    encoder = get_encoder(request.protocol)

    return StreamingResponse(
        _generate_sse_events(
            agent_config=agent,
            mcp_servers=mcp_servers,
            message=request.message,
            session_id=request.conversation_id,
            user=user,
            encoder=encoder,
            trace_id=request.trace_id,
            mongo=mongo,
            client_context=request.client_context,
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
    encoder: StreamEncoder,
    trace_id: str | None = None,
    mongo: MongoDBService | None = None,
) -> AsyncGenerator[str, None]:
    """Generate SSE events from agent resume streaming.

    The encoder handles all protocol-specific formatting.
    """
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
        async for frame in runtime.resume(session_id, user.email, form_data, trace_id, encoder):
            yield frame

    except Exception as e:
        logger.exception(f"Error resuming stream for agent '{agent_config.name}'")
        for frame in encoder.on_run_error(str(e)):
            yield frame


@router.post("/stream/resume")
async def chat_resume_stream(
    request: ResumeStreamRequest,
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """Resume an interrupted stream after user provides form input.

    Called after the agent emitted an input_required event. The form_data
    should be a JSON string of the form values, or a rejection message
    if the user dismissed the form.

    Body field ``protocol`` selects the wire format:
        - "custom" (default): legacy SSE event types
        - "agui": AG-UI protocol

    Events depend on the selected protocol. See /stream/start for details.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config (access control is handled by the gateway)
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get MCP servers for this agent and its subagents
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    logger.info(
        f"[chat] Resuming stream: agent='{agent.name}', user={user.email}, "
        f"protocol={request.protocol}, trace_id={request.trace_id or 'auto'}"
    )

    encoder = get_encoder(request.protocol)

    return StreamingResponse(
        _generate_resume_sse_events(
            agent_config=agent,
            mcp_servers=mcp_servers,
            session_id=request.conversation_id,
            user=user,
            form_data=request.form_data,
            encoder=encoder,
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
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Non-streaming chat invocation (for simple integrations).

    Returns the complete response after processing.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config (access control is handled by the gateway)
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get MCP servers for this agent and its subagents
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    logger.info(f"Invoke request: agent={agent.name}, user={user.email}, trace_id={request.trace_id or 'auto'}")

    # Collect all content from streaming
    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    cache.set_mongo_service(mongo)

    try:
        runtime = await cache.get_or_create(
            agent,
            mcp_servers,
            request.conversation_id,
            user=user,
            client_context=request.client_context,
        )

        # Use custom encoder for invoke — we just need accumulated content
        encoder = get_encoder("custom")

        async for _frame in runtime.stream(
            request.message, request.conversation_id, user.email, request.trace_id, encoder
        ):
            pass  # Frames are SSE strings, we don't need them for invoke

        return {
            "success": True,
            "content": encoder.get_accumulated_content(),
            "agent_id": agent.id,
            "conversation_id": request.conversation_id,
            "trace_id": request.trace_id,
        }

    except Exception:
        logger.exception(f"Error invoking agent '{agent.name}'")
        return {
            "success": False,
            "error": "An internal error occurred while invoking the agent.",
            "agent_id": agent.id,
            "conversation_id": request.conversation_id,
            "trace_id": request.trace_id,
        }


@router.post("/restart-runtime")
async def restart_runtime(
    request: RestartRuntimeRequest,
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Restart the agent runtime by invalidating the cache.

    This forces the agent to reconnect to MCP servers on the next message.
    Useful when MCP servers come back online after being unavailable.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    # Get agent config to verify it exists (access control is handled by the gateway)
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Invalidate the runtime cache
    cache = get_runtime_cache()
    invalidated = await cache.invalidate(request.agent_id, request.conversation_id)

    logger.info(f"Runtime restart requested: agent={agent.name}, user={user.email}, invalidated={invalidated}")

    return {
        "success": True,
        "invalidated": invalidated,
        "agent_id": request.agent_id,
        "conversation_id": request.conversation_id,
    }


class CancelStreamRequest(BaseModel):
    """Request body for cancelling an active stream."""

    agent_id: str
    conversation_id: str


@router.post("/stream/cancel")
async def cancel_stream(
    request: CancelStreamRequest,
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Cancel an active streaming request.

    This sets a cancellation flag that causes the stream to exit gracefully
    at the next chunk boundary. The stream will close without emitting
    further events.
    """
    # Set conversation context for logging
    conversation_id_var.set(request.conversation_id)

    logger.info(
        f"[cancel] Cancel request received: agent={request.agent_id}, conv={request.conversation_id}, user={user.email}"
    )

    # Get agent config to verify it exists (access control is handled by the gateway)
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Cancel the stream via the runtime cache
    cache = get_runtime_cache()
    cancelled = cache.cancel_stream(request.agent_id, request.conversation_id)

    logger.info(f"[cancel] Cancel result: agent={agent.name}, user={user.email}, cancelled={cancelled}")

    return {
        "success": True,
        "cancelled": cancelled,
        "agent_id": request.agent_id,
        "conversation_id": request.conversation_id,
    }
