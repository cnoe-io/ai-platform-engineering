"""Chat endpoint for Dynamic Agents with SSE streaming."""

import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from dynamic_agents.middleware.auth import UserContext, get_current_user
from dynamic_agents.models import ChatRequest, DynamicAgentConfig, VisibilityType
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


def _can_use_agent(agent: DynamicAgentConfig, user: UserContext) -> bool:
    """Check if user can use the agent."""
    # Admin can use all agents
    if user.is_admin:
        return True

    # Disabled agents cannot be used
    if not agent.enabled:
        return False

    # Owner can use their own
    if agent.owner_id == user.email:
        return True

    # Global is available to all
    if agent.visibility == VisibilityType.GLOBAL:
        return True

    # Team visibility requires group membership
    if agent.visibility == VisibilityType.TEAM:
        if agent.shared_with_teams:
            return any(team in user.groups for team in agent.shared_with_teams)

    return False


async def _generate_sse_events(
    agent_config: DynamicAgentConfig,
    mcp_servers: list,
    message: str,
    session_id: str,
    user_id: str,
    trace_id: str | None = None,
    mongo: MongoDBService | None = None,
) -> AsyncGenerator[str, None]:
    """Generate SSE events from agent streaming."""
    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    if mongo:
        cache.set_mongo_service(mongo)

    try:
        # Get or create runtime
        runtime = await cache.get_or_create(agent_config, mcp_servers, session_id)

        # Stream response with trace_id for Langfuse tracing
        async for event in runtime.stream(message, session_id, user_id, trace_id):
            event_type = event.get("type", "event")
            event_data = event.get("data", "")

            # Format as SSE
            if isinstance(event_data, dict):
                data = json.dumps(event_data)
            else:
                data = str(event_data)

            yield f"event: {event_type}\ndata: {data}\n\n"

        # Send done event
        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        logger.exception(f"Error streaming from agent '{agent_config.name}'")
        error_data = json.dumps({"error": str(e)})
        yield f"event: error\ndata: {error_data}\n\n"


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """Stream a chat response from a dynamic agent.

    Uses Server-Sent Events (SSE) for real-time streaming.

    Events:
    - content: Streaming text chunks
    - tool_start: Tool invocation started
    - tool_end: Tool invocation completed
    - error: Error occurred
    - done: Streaming complete
    """
    # Get agent config
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access
    if not _can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get MCP servers for this agent
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    logger.info(
        f"Chat request: agent={agent.name}, user={user.email}, "
        f"session={request.conversation_id}, servers={len(mcp_servers)}, "
        f"trace_id={request.trace_id or 'auto'}"
    )

    return StreamingResponse(
        _generate_sse_events(
            agent_config=agent,
            mcp_servers=mcp_servers,
            message=request.message,
            session_id=request.conversation_id,
            user_id=user.email,
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
    # Get agent config
    agent = mongo.get_agent(request.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check access
    if not _can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get MCP servers for this agent
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    logger.info(
        f"Invoke request: agent={agent.name}, user={user.email}, "
        f"session={request.conversation_id}, trace_id={request.trace_id or 'auto'}"
    )

    # Collect all content from streaming
    cache = get_runtime_cache()

    # Set MongoDB service for subagent resolution
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(agent, mcp_servers, request.conversation_id)

    content_parts = []
    tool_calls = []
    trace_id = None

    async for event in runtime.stream(request.message, request.conversation_id, user.email, request.trace_id):
        event_type = event.get("type", "")
        event_data = event.get("data", "")

        if event_type == "content":
            content_parts.append(str(event_data))
        elif event_type == "tool_start":
            tool_calls.append(event_data)
        elif event_type == "final_result":
            # Extract trace_id from final_result metadata
            artifact = event_data.get("artifact", {}) if isinstance(event_data, dict) else {}
            metadata = artifact.get("metadata", {})
            trace_id = metadata.get("trace_id")

    return {
        "success": True,
        "content": "".join(content_parts),
        "tool_calls": tool_calls,
        "agent_id": agent.id,
        "conversation_id": request.conversation_id,
        "trace_id": trace_id,
    }
