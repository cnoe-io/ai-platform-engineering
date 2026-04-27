"""Conversations endpoint for Dynamic Agents.

Provides access to conversation history stored in the LangGraph checkpointer.
Metadata (ownership, sharing) is stored in the `conversations` collection,
while messages are stored in the `checkpoints_conversation` collection.
"""

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from dynamic_agents.auth.access import can_access_conversation
from dynamic_agents.auth.auth import UserContext, get_user_context
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


class ConversationFilesListResponse(BaseModel):
    """Response containing list of file paths from checkpointer."""

    conversation_id: str
    agent_id: str
    files: list[str]


class FileContentResponse(BaseModel):
    """Response containing content of a single file."""

    conversation_id: str
    path: str
    content: str


@router.get("/{conversation_id}/messages", response_model=ConversationMessagesResponse)
async def get_conversation_messages(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ConversationMessagesResponse:
    """Get messages for a conversation from the LangGraph checkpointer.

    This endpoint retrieves the full message history for a conversation,
    including any pending HITL interrupt state.

    Access control is handled by `can_access_conversation()` in auth/access.py.

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

    # 4. Get MCP servers for the agent and its subagents (needed to create runtime)
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    # 5. Get or create runtime to access checkpointer
    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user=user,
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
                ts = datetime.fromisoformat(additional_kwargs["timestamp"])
                timestamp = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
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

    logger.debug(
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


class InterruptStateResponse(BaseModel):
    """Response containing only the HITL interrupt state (no messages)."""

    conversation_id: str
    agent_id: str
    has_pending_interrupt: bool = False
    interrupt_data: InterruptData | None = None


@router.get("/{conversation_id}/interrupt-state", response_model=InterruptStateResponse)
async def get_interrupt_state(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> InterruptStateResponse:
    """Get HITL interrupt state for a conversation (lightweight, no messages).

    This is a lightweight endpoint that only checks if there's a pending
    human-in-the-loop interrupt. It does NOT fetch messages - use the
    standard /api/chat/conversations/{id}/messages endpoint for that.

    Used by the UI to restore HITL forms after page refresh while loading
    messages from the MongoDB messages collection.
    """
    # 1. Verify agent exists
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Check conversation exists and user has access
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    conversation = conversations_coll.find_one({"_id": conversation_id})

    if not conversation:
        # Conversation doesn't exist yet - no interrupt possible
        return InterruptStateResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            has_pending_interrupt=False,
        )

    # 3. Check access
    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. Get MCP servers for the agent and its subagents (needed to create runtime)
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    # 5. Get or create runtime to access checkpointer
    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user=user,
    )

    # 6. Check for pending interrupt only (no message extraction)
    if not runtime._graph:
        return InterruptStateResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            has_pending_interrupt=False,
        )

    interrupt_data = await runtime.has_pending_interrupt(conversation_id)
    has_pending_interrupt = interrupt_data is not None

    logger.debug(
        f"Checked interrupt state for conversation {conversation_id}: has_pending_interrupt={has_pending_interrupt}"
    )

    return InterruptStateResponse(
        conversation_id=conversation_id,
        agent_id=agent_id,
        has_pending_interrupt=has_pending_interrupt,
        interrupt_data=InterruptData(**interrupt_data) if interrupt_data else None,
    )


@router.get("/{conversation_id}/files/list", response_model=ConversationFilesListResponse)
async def get_conversation_files_list(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ConversationFilesListResponse:
    """Get list of file paths for a conversation from the LangGraph checkpointer.

    Returns the list of files in the agent's in-memory filesystem.
    Access control is handled by `can_access_conversation()` in auth/access.py.
    """
    # 1. Verify agent exists
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Check conversation ownership
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    conversation = conversations_coll.find_one({"_id": conversation_id})

    if not conversation:
        return ConversationFilesListResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            files=[],
        )

    # 3. Check access
    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. Get or create runtime to access checkpointer
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user=user,
    )

    # 5. Get state from checkpointer
    if not runtime._graph:
        return ConversationFilesListResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            files=[],
        )

    config = {"configurable": {"thread_id": conversation_id}}

    try:
        state = await runtime._graph.aget_state(config)
    except Exception as e:
        logger.error(f"Failed to get state for conversation {conversation_id}: {e}")
        return ConversationFilesListResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            files=[],
        )

    if not state or not state.values:
        return ConversationFilesListResponse(
            conversation_id=conversation_id,
            agent_id=agent_id,
            files=[],
        )

    # 6. Extract file paths from state
    files_dict = state.values.get("files", {})
    file_paths = sorted(files_dict.keys()) if isinstance(files_dict, dict) else []

    logger.debug(f"Retrieved {len(file_paths)} files for conversation {conversation_id}")

    return ConversationFilesListResponse(
        conversation_id=conversation_id,
        agent_id=agent_id,
        files=file_paths,
    )


@router.get("/{conversation_id}/files/content", response_model=FileContentResponse)
async def get_conversation_file_content(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    path: str = Query(..., description="File path to retrieve"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> FileContentResponse:
    """Get content of a single file from the LangGraph checkpointer.

    Returns the content of a specific file from the agent's in-memory filesystem.
    Access control is handled by `can_access_conversation()` in auth/access.py.
    """
    # 1. Verify agent exists
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Check conversation ownership
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    conversation = conversations_coll.find_one({"_id": conversation_id})

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 3. Check access
    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. Get or create runtime to access checkpointer
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user=user,
    )

    # 5. Get state from checkpointer
    if not runtime._graph:
        raise HTTPException(status_code=404, detail="File not found")

    config = {"configurable": {"thread_id": conversation_id}}

    try:
        state = await runtime._graph.aget_state(config)
    except Exception as e:
        logger.error(f"Failed to get state for conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve file")

    if not state or not state.values:
        raise HTTPException(status_code=404, detail="File not found")

    # 6. Get file content from state
    # files is dict[str, FileData] where FileData is a TypedDict with content: list[str]
    files_dict = state.values.get("files", {})
    if not isinstance(files_dict, dict) or path not in files_dict:
        raise HTTPException(status_code=404, detail="File not found")

    file_data = files_dict[path]

    # FileData is a TypedDict: {"content": list[str], "created_at": str, "modified_at": str}
    # content is list of lines - join them with newlines
    if isinstance(file_data, dict) and "content" in file_data:
        lines = file_data["content"]
        content = "\n".join(lines) if isinstance(lines, list) else str(lines)
    else:
        # Fallback: assume it's already a string
        content = str(file_data)

    logger.debug(f"Retrieved file {path} for conversation {conversation_id}")

    return FileContentResponse(
        conversation_id=conversation_id,
        path=path,
        content=content,
    )


@router.delete("/{conversation_id}/files/content", response_model=ApiResponse)
async def delete_conversation_file(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    path: str = Query(..., description="File path to delete"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Delete a file from the agent's in-memory filesystem.

    Uses LangGraph's aupdate_state with a None value to trigger deletion
    via the files reducer. The file is removed from the checkpoint state.

    Access control is handled by `can_access_conversation()` in auth/access.py.
    """
    # 1. Verify agent exists
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Check conversation ownership
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    conversation = conversations_coll.find_one({"_id": conversation_id})

    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # 3. Check access
    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    # 4. Get or create runtime to access checkpointer
    mcp_servers = mongo.get_agent_mcp_servers(agent)

    cache = get_runtime_cache()
    cache.set_mongo_service(mongo)

    runtime = await cache.get_or_create(
        agent,
        mcp_servers,
        conversation_id,
        user=user,
    )

    # 5. Get state and verify file exists
    if not runtime._graph:
        raise HTTPException(status_code=404, detail="File not found")

    config = {"configurable": {"thread_id": conversation_id}}

    try:
        state = await runtime._graph.aget_state(config)
    except Exception as e:
        logger.error(f"Failed to get state for conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to access conversation state")

    if not state or not state.values:
        raise HTTPException(status_code=404, detail="File not found")

    files_dict = state.values.get("files", {})
    if not isinstance(files_dict, dict) or path not in files_dict:
        raise HTTPException(status_code=404, detail="File not found")

    # 6. Delete file using aupdate_state with None value
    # The files reducer treats None as a deletion marker
    try:
        await runtime._graph.aupdate_state(
            config,
            {"files": {path: None}},
        )
    except Exception as e:
        logger.error(f"Failed to delete file {path} from conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete file")

    logger.info(f"Deleted file {path} from conversation {conversation_id}")

    return ApiResponse(success=True, data={"deleted": path})


@router.post("/{conversation_id}/metadata")
async def ensure_conversation_metadata(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    user: UserContext = Depends(get_user_context),
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
                "created_at": now,
                "metadata": {
                    "client_type": "api",
                    "agent_name": agent.name,
                    "total_messages": 0,
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
            "$set": {
                "updated_at": now,
                "agent_id": agent_id,
            },
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
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    """Clear checkpoint data for a conversation (admin only).

    This removes all messages from the LangGraph checkpointer collections
    but keeps the conversation metadata record.

    The action is logged for audit purposes.

    Requires admin role (checked via X-User-Context from gateway).
    """
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversations_coll = db["conversations"]
    checkpoints_coll = db["checkpoints_conversation"]
    writes_coll = db["checkpoint_writes_conversation"]

    # Verify conversation exists
    conversation = conversations_coll.find_one({"_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete checkpoint data
    checkpoints_result = checkpoints_coll.delete_many({"thread_id": conversation_id})
    writes_result = writes_coll.delete_many({"thread_id": conversation_id})

    # Log the action for audit
    logger.info(
        f"Admin {user.email} cleared conversation {conversation_id}: "
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
