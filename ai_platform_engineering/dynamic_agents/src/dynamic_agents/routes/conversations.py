"""Conversations endpoint for Dynamic Agents.

Provides access to conversation state stored in the LangGraph checkpointer:
interrupt state, files, and clear operations.

Messages are served by the Next.js layer directly from MongoDB.
"""

import logging
import re
from datetime import datetime, timezone
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from pymongo.database import Database

from dynamic_agents.auth.access import can_access_conversation
from dynamic_agents.auth.auth import UserContext, get_user_context
from dynamic_agents.config import get_settings
from dynamic_agents.models import ApiResponse
from dynamic_agents.services.gridfs_store import MongoDBGridFSStore
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service
from dynamic_agents.services.runtime_cache import get_runtime_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/conversations", tags=["conversations"])

_UPLOAD_PREFIX = "/uploads"
_MAX_UPLOAD_FILES = 10
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_ALLOWED_UPLOAD_EXTENSIONS = {
    ".csv",
    ".htm",
    ".html",
    ".json",
    ".jsonl",
    ".log",
    ".markdown",
    ".md",
    ".rst",
    ".text",
    ".tsv",
    ".txt",
    ".vtt",
    ".xml",
    ".yaml",
    ".yml",
}


def _get_gridfs_store(db: Database) -> MongoDBGridFSStore:
    """Get a GridFS store instance for the given database."""
    settings = get_settings()
    return MongoDBGridFSStore(db=db, bucket_name=settings.gridfs_bucket_name)


def _create_file_data(content: str, *, uploaded_by: str, original_name: str, size_bytes: int) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "content": content.split("\n"),
        "created_at": now,
        "modified_at": now,
        "uploaded_by": uploaded_by,
        "original_name": original_name,
        "size_bytes": size_bytes,
        "source": "chat_upload",
    }


def _safe_upload_filename(filename: str | None) -> str:
    raw_name = PurePosixPath(filename or "").name
    cleaned = _SAFE_FILENAME_RE.sub("_", raw_name).strip("._-")
    return (cleaned or "upload.txt")[:160]


def _validate_upload_extension(filename: str) -> None:
    suffix = PurePosixPath(filename).suffix.lower()
    if suffix not in _ALLOWED_UPLOAD_EXTENSIONS:
        allowed = ", ".join(sorted(_ALLOWED_UPLOAD_EXTENSIONS))
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Allowed extensions: {allowed}")


def _dedupe_upload_path(store: MongoDBGridFSStore, namespace: tuple[str, str, str], filename: str) -> str:
    path = f"{_UPLOAD_PREFIX}/{filename}"
    if store.get(namespace, path) is None:
        return path

    posix_name = PurePosixPath(filename)
    suffix = posix_name.suffix
    stem = posix_name.stem or "upload"
    for index in range(2, 1000):
        candidate = f"{_UPLOAD_PREFIX}/{stem}-{index}{suffix}"
        if store.get(namespace, candidate) is None:
            return candidate
    raise HTTPException(status_code=409, detail=f"Too many files named like {filename}")


class InterruptData(BaseModel):
    """Data for a pending HITL interrupt (discriminated by type)."""

    type: str = "form_input"  # "form_input" or "tool_approval"
    interrupt_id: str
    # form_input fields
    prompt: str = ""
    fields: list[dict] = []
    # tool_approval fields
    tool_name: str | None = None
    tool_args: dict | None = None
    allowed_decisions: list[str] | None = None


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


class UploadedFileInfo(BaseModel):
    """Metadata for a file uploaded into the conversation filesystem."""

    path: str
    original_name: str
    size_bytes: int


class FileUploadResponse(BaseModel):
    """Response containing uploaded conversation files."""

    conversation_id: str
    agent_id: str
    files: list[UploadedFileInfo]


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
    """Get list of file paths for a conversation from GridFS store.

    Returns the list of files stored by the agent during this conversation.
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

    # 4. Query GridFS store directly (no runtime needed)
    store = _get_gridfs_store(db)
    namespace = (agent_id, conversation_id, "filesystem")
    items = store.search(namespace, limit=1000)
    file_paths = sorted(item.key for item in items)

    logger.debug(f"Retrieved {len(file_paths)} files for conversation {conversation_id}")

    return ConversationFilesListResponse(
        conversation_id=conversation_id,
        agent_id=agent_id,
        files=file_paths,
    )


@router.post("/{conversation_id}/files/upload", response_model=FileUploadResponse)
async def upload_conversation_files(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    files: list[UploadFile] = File(..., description="Text files to upload into the conversation filesystem"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> FileUploadResponse:
    """Upload text files into the GridFS-backed conversation filesystem.

    Files are stored under ``/uploads`` in the same namespace used by
    deepagents' StoreBackend: ``(agent_id, conversation_id, "filesystem")``.
    That makes uploaded files visible to the main agent and subagents through
    normal filesystem tools like read_file and grep.
    """
    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required")
    if len(files) > _MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"Too many files. Maximum is {_MAX_UPLOAD_FILES}")

    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if mongo._client is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    db = mongo._db
    if db is None:
        raise HTTPException(status_code=503, detail="Database not connected")

    conversation = db["conversations"].find_one({"_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if not can_access_conversation(conversation, user):
        raise HTTPException(status_code=403, detail="Access denied")

    settings = get_settings()
    store = _get_gridfs_store(db)
    namespace = (agent_id, conversation_id, "filesystem")
    uploaded: list[UploadedFileInfo] = []

    for upload in files:
        original_name = upload.filename or "upload.txt"
        safe_name = _safe_upload_filename(original_name)
        _validate_upload_extension(safe_name)

        raw_content = await upload.read()
        size_bytes = len(raw_content)
        if size_bytes > settings.upload_file_max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"{original_name} exceeds max upload size of {settings.upload_file_max_bytes} bytes",
            )

        try:
            content = raw_content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=415, detail=f"{original_name} is not valid UTF-8 text") from exc

        if "\x00" in content:
            raise HTTPException(status_code=415, detail=f"{original_name} appears to be binary")

        path = _dedupe_upload_path(store, namespace, safe_name)
        store.put(
            namespace,
            path,
            _create_file_data(
                content,
                uploaded_by=user.email,
                original_name=original_name,
                size_bytes=size_bytes,
            ),
        )
        uploaded.append(UploadedFileInfo(path=path, original_name=original_name, size_bytes=size_bytes))

    logger.info(
        "Uploaded %d file(s) to conversation %s for agent %s by %s",
        len(uploaded),
        conversation_id,
        agent_id,
        user.email,
    )

    return FileUploadResponse(
        conversation_id=conversation_id,
        agent_id=agent_id,
        files=uploaded,
    )


@router.get("/{conversation_id}/files/content", response_model=FileContentResponse)
async def get_conversation_file_content(
    conversation_id: str,
    agent_id: str = Query(..., description="Dynamic agent ID"),
    path: str = Query(..., description="File path to retrieve"),
    user: UserContext = Depends(get_user_context),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> FileContentResponse:
    """Get content of a single file from GridFS store.

    Returns the content of a specific file stored by the agent.
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

    # 4. Query GridFS store directly
    store = _get_gridfs_store(db)
    namespace = (agent_id, conversation_id, "filesystem")
    item = store.get(namespace, path)

    if item is None:
        raise HTTPException(status_code=404, detail="File not found")

    # 5. Extract content from value
    value = item.value
    raw_content = value.get("content", "")
    content = "\n".join(raw_content) if isinstance(raw_content, list) else str(raw_content)

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
    """Delete a file from GridFS store.

    Removes the file from the GridFS-backed store for this conversation.
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

    # 4. Delete from GridFS store
    store = _get_gridfs_store(db)
    namespace = (agent_id, conversation_id, "filesystem")

    # Verify file exists first
    item = store.get(namespace, path)
    if item is None:
        raise HTTPException(status_code=404, detail="File not found")

    store.delete(namespace, path)

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
    settings = get_settings()
    checkpoints_coll = db[settings.checkpoint_collection]
    writes_coll = db[settings.checkpoint_writes_collection]

    # Verify conversation exists
    conversation = conversations_coll.find_one({"_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete checkpoint data
    checkpoints_result = checkpoints_coll.delete_many({"thread_id": conversation_id})
    writes_result = writes_coll.delete_many({"thread_id": conversation_id})

    # Delete GridFS files for this conversation
    agent_id = conversation.get("agent_id", "")
    store = _get_gridfs_store(db)
    files_deleted = 0
    if agent_id:
        files_deleted = store.delete_by_namespace((agent_id, conversation_id, "filesystem"))

    # Log the action for audit
    logger.info(
        f"Admin {user.email} cleared conversation {conversation_id}: "
        f"deleted {checkpoints_result.deleted_count} checkpoints, "
        f"{writes_result.deleted_count} writes, {files_deleted} files"
    )

    return ApiResponse(
        success=True,
        data={
            "conversation_id": conversation_id,
            "checkpoints_deleted": checkpoints_result.deleted_count,
            "writes_deleted": writes_result.deleted_count,
            "files_deleted": files_deleted,
        },
    )
