# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Chat API routes for conversation management and sharing.

This module provides REST endpoints for:
- Conversation CRUD
- Message management
- Conversation sharing
- User profile and preferences
"""

import logging
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from ai_platform_engineering.database.mongodb import get_mongodb, MongoDBManager
from ai_platform_engineering.database.models import (
    Conversation,
    Message,
    User,
    CreateConversationRequest,
    UpdateConversationRequest,
    AddMessageRequest,
    ShareConversationRequest,
    ShareStatus,
    ConversationListResponse,
    UpdateUserPreferencesRequest,
)
from ai_platform_engineering.services.chat_service import ChatService
from ai_platform_engineering.services.audit_service import AuditService
from ai_platform_engineering.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

# Create routers
router = APIRouter(prefix="/api/chat", tags=["chat"])
users_router = APIRouter(prefix="/api/users", tags=["users"])
notifications_router = APIRouter(prefix="/api/notifications", tags=["notifications"])


# Dependency to get services
def get_chat_service(mongodb: MongoDBManager = Depends(get_mongodb)) -> ChatService:
    """Get chat service instance with audit and notification services."""
    audit_service = AuditService(mongodb)
    notification_service = NotificationService(mongodb)
    return ChatService(mongodb, audit_service, notification_service)


def get_audit_service(mongodb: MongoDBManager = Depends(get_mongodb)) -> AuditService:
    """Get audit service instance."""
    return AuditService(mongodb)


def get_notification_service(mongodb: MongoDBManager = Depends(get_mongodb)) -> NotificationService:
    """Get notification service instance."""
    return NotificationService(mongodb)


# Dependency to get current user (mock for now, will integrate with NextAuth)
async def get_current_user() -> User:
    """Get current authenticated user.
    
    TODO: Integrate with NextAuth session
    For now, returns a mock user for development.
    """
    # In production, this will extract user from NextAuth session/JWT
    # For now, return mock user
    service = get_chat_service()
    return await service.get_or_create_user(
        email="sraradhy@cisco.com",
        name="Sri Aradhyula",
    )


# ============================================================================
# Conversation Management
# ============================================================================

@router.post("/conversations", response_model=Conversation, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    request: CreateConversationRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Create a new conversation with initial message.
    
    Args:
        request: Conversation creation request
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Created conversation
    """
    try:
        conversation = await service.create_conversation(
            user_id=current_user.id,
            request=request,
        )
        return conversation
    except Exception as e:
        logger.error(f"Failed to create conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create conversation: {str(e)}",
        )


@router.get("/conversations", response_model=ConversationListResponse)
async def list_conversations(
    page: int = 1,
    limit: int = 50,
    filter: Literal["owned", "shared", "all"] = "all",
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """List conversations for current user.
    
    Args:
        page: Page number (1-indexed)
        limit: Items per page
        filter: Filter by ownership
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        List of conversations with pagination
    """
    try:
        return await service.list_conversations(
            user_id=current_user.id,
            page=page,
            limit=limit,
            filter_type=filter,
        )
    except Exception as e:
        logger.error(f"Failed to list conversations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list conversations: {str(e)}",
        )


@router.get("/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Get conversation by ID.
    
    Args:
        conversation_id: Conversation UUID
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Conversation
        
    Raises:
        404: If conversation not found or no access
    """
    try:
        conversation = await service.get_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
        )
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found or you don't have access",
            )
        
        return conversation
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get conversation: {str(e)}",
        )


@router.put("/conversations/{conversation_id}", response_model=Conversation)
async def update_conversation(
    conversation_id: UUID,
    request: UpdateConversationRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Update conversation metadata.
    
    Args:
        conversation_id: Conversation UUID
        request: Update request
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Updated conversation
        
    Raises:
        404: If conversation not found
        403: If user is not creator
    """
    try:
        return await service.update_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            request=request,
        )
    except ValueError as e:
        if "not found" in str(e):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update conversation: {str(e)}",
        )


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Delete conversation.
    
    Args:
        conversation_id: Conversation UUID
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Success response
        
    Raises:
        404: If conversation not found
        403: If user is not creator
    """
    try:
        deleted = await service.delete_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
        )
        
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )
        
        return JSONResponse(
            content={"success": True, "message": "Conversation deleted"},
            status_code=status.HTTP_200_OK,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete conversation: {str(e)}",
        )


# ============================================================================
# Message Management
# ============================================================================

@router.post("/conversations/{conversation_id}/messages", response_model=Message, status_code=status.HTTP_201_CREATED)
async def add_message(
    conversation_id: UUID,
    request: AddMessageRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Add message to conversation.
    
    Args:
        conversation_id: Conversation UUID
        request: Message to add
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Added message
        
    Raises:
        404: If conversation not found
        403: If no access
    """
    try:
        return await service.add_message(
            conversation_id=conversation_id,
            user_id=current_user.id,
            request=request,
        )
    except ValueError as e:
        if "not found" in str(e):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to add message: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add message: {str(e)}",
        )


# ============================================================================
# Sharing Management
# ============================================================================

@router.post("/conversations/{conversation_id}/share", response_model=ShareStatus)
async def share_conversation(
    conversation_id: UUID,
    request: ShareConversationRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Share conversation with other users.
    
    Args:
        conversation_id: Conversation UUID
        request: Share request with user emails
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Share status
        
    Raises:
        404: If conversation not found
        403: If user is not creator
    """
    try:
        return await service.share_conversation(
            conversation_id=conversation_id,
            user_id=current_user.id,
            request=request,
        )
    except ValueError as e:
        if "not found" in str(e):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to share conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to share conversation: {str(e)}",
        )


@router.get("/conversations/{conversation_id}/share", response_model=ShareStatus)
async def get_share_status(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Get sharing status for a conversation.
    
    Args:
        conversation_id: Conversation UUID
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Share status
        
    Raises:
        404: If conversation not found
        403: If no access
    """
    try:
        return await service.get_share_status(
            conversation_id=conversation_id,
            user_id=current_user.id,
        )
    except ValueError as e:
        if "not found" in str(e):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get share status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get share status: {str(e)}",
        )


@router.delete("/conversations/{conversation_id}/share/{user_id}")
async def remove_share(
    conversation_id: UUID,
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Remove user's access to a conversation.
    
    Args:
        conversation_id: Conversation UUID
        user_id: User ID to remove
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Success response
        
    Raises:
        404: If conversation not found
        403: If no permission
    """
    try:
        removed = await service.remove_share(
            conversation_id=conversation_id,
            user_id=current_user.id,
            remove_user_id=user_id,
        )
        
        if not removed:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation or user not found",
            )
        
        return JSONResponse(
            content={"success": True, "message": "Access removed"},
            status_code=status.HTTP_200_OK,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to remove share: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to remove share: {str(e)}",
        )


# ============================================================================
# User Management
# ============================================================================

@users_router.get("/me", response_model=User)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
):
    """Get current user profile.
    
    Args:
        current_user: Authenticated user
        
    Returns:
        User profile
    """
    return current_user


@users_router.put("/me/preferences", response_model=User)
async def update_preferences(
    request: UpdateUserPreferencesRequest,
    current_user: User = Depends(get_current_user),
    service: ChatService = Depends(get_chat_service),
):
    """Update user preferences.
    
    Args:
        request: Preferences to update
        current_user: Authenticated user
        service: Chat service
        
    Returns:
        Updated user profile
    """
    try:
        return await service.update_user_preferences(
            user_id=current_user.id,
            preferences=request,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to update preferences: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update preferences: {str(e)}",
        )


# ============================================================================
# Notifications
# ============================================================================

@notifications_router.get("/")
async def get_notifications(
    status: Optional[Literal["unread", "read", "archived"]] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
):
    """Get notifications for current user.
    
    Args:
        status: Filter by status
        limit: Maximum number of notifications
        current_user: Authenticated user
        service: Notification service
        
    Returns:
        List of notifications
    """
    try:
        notifications = await service.get_user_notifications(
            user_id=current_user.id,
            status=status,
            limit=limit,
        )
        return JSONResponse(content={
            "notifications": [
                {**n, "_id": str(n["_id"]), "recipient_id": str(n["recipient_id"])}
                for n in notifications
            ]
        })
    except Exception as e:
        logger.error(f"Failed to get notifications: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get notifications: {str(e)}",
        )


@notifications_router.get("/unread/count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
):
    """Get count of unread notifications.
    
    Args:
        current_user: Authenticated user
        service: Notification service
        
    Returns:
        Unread count
    """
    try:
        count = await service.get_unread_count(user_id=current_user.id)
        return JSONResponse(content={"count": count})
    except Exception as e:
        logger.error(f"Failed to get unread count: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get unread count: {str(e)}",
        )


@notifications_router.put("/{notification_id}/read")
async def mark_notification_as_read(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
):
    """Mark notification as read.
    
    Args:
        notification_id: Notification UUID
        current_user: Authenticated user
        service: Notification service
        
    Returns:
        Success response
    """
    try:
        marked = await service.mark_as_read(
            notification_id=notification_id,
            user_id=current_user.id,
        )
        
        if not marked:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found",
            )
        
        return JSONResponse(content={"success": True, "message": "Notification marked as read"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to mark notification as read: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to mark notification as read: {str(e)}",
        )


@notifications_router.put("/mark-all-read")
async def mark_all_notifications_as_read(
    current_user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
):
    """Mark all notifications as read.
    
    Args:
        current_user: Authenticated user
        service: Notification service
        
    Returns:
        Success response with count
    """
    try:
        count = await service.mark_all_as_read(user_id=current_user.id)
        return JSONResponse(content={
            "success": True,
            "message": f"{count} notifications marked as read",
            "count": count,
        })
    except Exception as e:
        logger.error(f"Failed to mark all as read: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to mark all as read: {str(e)}",
        )


@notifications_router.delete("/{notification_id}")
async def delete_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notification_service),
):
    """Delete a notification.
    
    Args:
        notification_id: Notification UUID
        current_user: Authenticated user
        service: Notification service
        
    Returns:
        Success response
    """
    try:
        deleted = await service.delete_notification(
            notification_id=notification_id,
            user_id=current_user.id,
        )
        
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found",
            )
        
        return JSONResponse(content={"success": True, "message": "Notification deleted"})
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete notification: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete notification: {str(e)}",
        )
