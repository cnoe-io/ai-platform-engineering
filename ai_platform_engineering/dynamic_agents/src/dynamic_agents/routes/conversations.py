"""Conversations endpoint for Dynamic Agents.

Provides access to conversation history stored in the LangGraph checkpointer.
Metadata (ownership, sharing) is stored in the `conversations` collection,
while messages are stored in the `conversation_checkpoints` collection.
"""

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dynamic_agents.auth.access import can_access_conversation
from dynamic_agents.auth.auth import UserContext, get_current_user, require_admin
from dynamic_agents.models import ApiResponse
from dynamic_agents.services.agent_runtime import get_runtime_cache
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationMessage(BaseModel):
    """Message from conversation history."""

    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime | None = None


class InterruptData(BaseModel):
    """Data for a pending HITL interrupt."""

    interrupt_id: str
    prompt: str
    fields: list[dict]


class ConversationMessagesResponse(BaseModel):
    """Response containing conversation messages from checkpointer."""

    conversation_id: str
    agent_id: str
    messages: list[ConversationMessage]
    has_pending_interrupt: bool = False
    interrupt_data: InterruptData | None = None


@router.get("/{conversation_id}/messages", response_model=ConversationMessagesResponse)
async def get_conversation_messages(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ConversationMessagesResponse:
    """Get messages for a conversation from the LangGraph checkpointer.

    This endpoint retrieves the full message history for a conversation,
    including any pending HITL interrupt state.

    Access control:
    - User must own the conversation, or
    - User must be admin, or
    - Conversation must be shared with user (TODO)

    Messages are extracted from the LangGraph checkpoint state.
    Only HumanMessage and AIMessage are returned (tool messages filtered out).
    """
    # 1. Verify agent exists and user can access it
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Check conversation ownership via conversations collection
    # The conversations collection is in the same database
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    conversation = conversations_coll.find_one({"_id": conversation_id})

    if not conversation:
        # Conversation doesn't exist in metadata collection
        # This could be a new conversation that hasn't been persisted yet
        # Return empty messages
        logger.info(f"Conversation {conversation_id} not found in metadata collection, returning empty messages")
        return ConversationMessagesResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            messages=[],
            has_pending_interrupt=False,
        )

    # 3. Check access
    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. Get MCP servers for the agent (needed to create runtime)
    server_ids = list(agent.allowed_tools.keys())
    mcp_servers = mongo.get_servers_by_ids(server_ids) if server_ids else []

    # 5. Get or create runtime to access checkpointer
    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user_email=user.email,
        user_name=user.name,
        user_groups=user.groups,
    )

    # 6. Get state from checkpointer
    if not runtime._graph:
        logger.warning(f"Runtime graph not initialized for conversation {conversation_id}")
        return ConversationMessagesResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            messages=[],
            has_pending_interrupt=False,
        )

    config = {"configurable": {"thread_id": conversation_id}}

    try:
        state = await runtime._graph.aget_state(config)
    except Exception as e:
        logger.error(f"Failed to get state for conversation {conversation_id}: {e}")
        return ConversationMessagesResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            messages=[],
            has_pending_interrupt=False,
        )

    if not state or not state.values:
        logger.info(f"No checkpoint state found for conversation {conversation_id}")
        return ConversationMessagesResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            messages=[],
            has_pending_interrupt=False,
        )

    # 7. Extract messages from state
    raw_messages = state.values.get("messages", [])
    messages: list[ConversationMessage] = []

    for msg in raw_messages:
        msg_type = type(msg).__name__

        # Filter to HumanMessage and AIMessage only
        if "HumanMessage" in msg_type:
            role = "user"
        elif "AIMessage" in msg_type:
            role = "assistant"
        else:
            # Skip ToolMessage, SystemMessage, etc.
            continue

        # Extract content
        content = getattr(msg, "content", "")
        if isinstance(content, list):
            # Handle multimodal content (extract text parts)
            content = "".join(block.get("text", "") if isinstance(block, dict) else str(block) for block in content)

        # Extract timestamp from additional_kwargs if available
        timestamp = None
        additional_kwargs = getattr(msg, "additional_kwargs", {})
        if "timestamp" in additional_kwargs:
            try:
                timestamp = datetime.fromisoformat(additional_kwargs["timestamp"])
            except (ValueError, TypeError):
                pass

        # Use message ID or generate one
        msg_id = getattr(msg, "id", None) or f"msg-{len(messages)}"

        messages.append(
            ConversationMessage(
                id=msg_id,
                role=role,
                content=content,
                timestamp=timestamp,
            )
        )

    # 8. Check for pending interrupt
    interrupt_data = await runtime.has_pending_interrupt(conversation_id)
    has_pending_interrupt = interrupt_data is not None

    logger.info(
        f"Retrieved {len(messages)} messages for conversation {conversation_id}, "
        f"has_pending_interrupt={has_pending_interrupt}"
    )

    return ConversationMessagesResponse(
        conversation_id=conversation_id,
        agent_id=agent_id,
        messages=messages,
        has_pending_interrupt=has_pending_interrupt,
        interrupt_data=InterruptData(**interrupt_data) if interrupt_data else None,
    )


@router.post("/{conversation_id}/metadata")
async def ensure_conversation_metadata(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Ensure conversation metadata exists in the conversations collection.

    This is called when starting a new conversation to create the metadata
    record that makes the conversation appear in the sidebar.

    Uses upsert to avoid duplicates - if the conversation already exists,
    only updated_at is modified.
    """
    # Verify agent exists
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Upsert conversation metadata
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]

    now = datetime.now(timezone.utc)

    result = conversations_coll.update_one(
        {"_id": conversation_id},
        {
            "$setOnInsert": {
                "_id": conversation_id,
                "title": f"Chat with {agent.name}",
                "owner_id": user.email,
                "agent_id": agent_id,
                "created_at": now,
                "metadata": {
                    "agent_name": agent.name,
                    "agent_version": "1.0",
                },
                "sharing": {
                    "is_public": False,
                    "shared_with": [],
                    "shared_with_teams": [],
                    "share_link_enabled": False,
                },
                "tags": [],
                "is_archived": False,
                "is_pinned": False,
            },
            "$set": {"updated_at": now},
        },
        upsert=True,
    )

    created = result.upserted_id is not None
    logger.info(
        f"Conversation metadata {'created' if created else 'updated'}: "
        f"conversation_id={conversation_id}, agent_id={agent_id}, user={user.email}"
    )

    return {
        "success": True,
        "conversation_id": conversation_id,
        "created": created,
    }


# =============================================================================
# Admin Endpoints
# =============================================================================


@router.post("/{conversation_id}/clear", response_model=ApiResponse)
async def clear_conversation_checkpoints(
    conversation_id: str,
    admin: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Clear checkpoint data for a conversation (admin only).

    This removes all messages from the LangGraph checkpointer collections
    but keeps the conversation metadata record.

    The action is logged for audit purposes.
    """
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    checkpoints_coll = db["conversation_checkpoints"]
    writes_coll = db["conversation_checkpoint_writes"]

    # Verify conversation exists
    conversation = conversations_coll.find_one({"_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete checkpoint data
    checkpoints_result = checkpoints_coll.delete_many({"thread_id": conversation_id})
    writes_result = writes_coll.delete_many({"thread_id": conversation_id})

    # Log the action for audit
    logger.info(
        f"Admin {admin.email} cleared conversation {conversation_id}: "
        f"deleted {checkpoints_result.deleted_count} checkpoints, "
        f"{writes_result.deleted_count} writes"
    )

    return ApiResponse(
        success=True,
        data={
            "conversation_id": conversation_id,
            "checkpoints_deleted": checkpoints_result.deleted_count,
            "writes_deleted": writes_result.deleted_count,
        },
    )
