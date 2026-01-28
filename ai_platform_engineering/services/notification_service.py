# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Notification service for user events.

This module provides:
- Share notification creation
- Notification delivery (email, in-app)
- Notification preferences management
"""

import logging
from datetime import datetime
from typing import List, Optional, Literal
from uuid import UUID, uuid4

from ai_platform_engineering.database.mongodb import MongoDBManager
from ai_platform_engineering.database.models import User

logger = logging.getLogger(__name__)


class NotificationService:
    """Service for managing user notifications.
    
    Supports:
    - Conversation sharing notifications
    - In-app notifications
    - Email notifications (future)
    """
    
    def __init__(self, mongodb: MongoDBManager):
        """Initialize notification service.
        
        Args:
            mongodb: MongoDB manager instance
        """
        self.mongodb = mongodb
    
    async def create_share_notification(
        self,
        recipient_id: UUID,
        shared_by: User,
        conversation_id: UUID,
        conversation_title: str,
        permissions: List[str],
    ) -> str:
        """Create notification for conversation sharing.
        
        Args:
            recipient_id: User ID receiving the notification
            shared_by: User who shared the conversation
            conversation_id: Conversation that was shared
            conversation_title: Title of conversation
            permissions: Permissions granted
            
        Returns:
            Notification ID
        """
        notifications = self.mongodb.get_collection("notifications")
        
        notification = {
            "_id": uuid4(),
            "recipient_id": recipient_id,
            "type": "conversation_shared",
            "status": "unread",
            "created_at": datetime.utcnow(),
            "data": {
                "shared_by": {
                    "user_id": shared_by.id,
                    "name": shared_by.name,
                    "email": shared_by.email,
                    "avatar_url": shared_by.avatar_url,
                },
                "conversation": {
                    "id": conversation_id,
                    "title": conversation_title,
                },
                "permissions": permissions,
            },
            "message": f"{shared_by.name} shared a conversation with you: {conversation_title}",
            "link": f"/chat/{conversation_id}",
        }
        
        await notifications.insert_one(notification)
        
        logger.info(
            f"Created share notification for user {recipient_id} from {shared_by.email}"
        )
        
        # TODO: Send email notification if user has email notifications enabled
        # await self._send_email_notification(recipient_id, notification)
        
        return str(notification["_id"])
    
    async def get_user_notifications(
        self,
        user_id: UUID,
        status: Optional[Literal["unread", "read", "archived"]] = None,
        limit: int = 50,
    ) -> List[dict]:
        """Get notifications for a user.
        
        Args:
            user_id: User ID
            status: Filter by status
            limit: Maximum number of notifications
            
        Returns:
            List of notifications
        """
        notifications = self.mongodb.get_collection("notifications")
        
        query = {"recipient_id": user_id}
        if status:
            query["status"] = status
        
        cursor = notifications.find(query).sort("created_at", -1).limit(limit)
        
        notifs = []
        async for notif in cursor:
            notifs.append(notif)
        
        return notifs
    
    async def mark_as_read(
        self,
        notification_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Mark notification as read.
        
        Args:
            notification_id: Notification ID
            user_id: User ID (for authorization)
            
        Returns:
            True if marked, False if not found
        """
        notifications = self.mongodb.get_collection("notifications")
        
        result = await notifications.update_one(
            {"_id": notification_id, "recipient_id": user_id},
            {"$set": {"status": "read", "read_at": datetime.utcnow()}},
        )
        
        return result.modified_count > 0
    
    async def mark_all_as_read(
        self,
        user_id: UUID,
    ) -> int:
        """Mark all notifications as read for a user.
        
        Args:
            user_id: User ID
            
        Returns:
            Number of notifications marked as read
        """
        notifications = self.mongodb.get_collection("notifications")
        
        result = await notifications.update_many(
            {"recipient_id": user_id, "status": "unread"},
            {"$set": {"status": "read", "read_at": datetime.utcnow()}},
        )
        
        return result.modified_count
    
    async def delete_notification(
        self,
        notification_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Delete a notification.
        
        Args:
            notification_id: Notification ID
            user_id: User ID (for authorization)
            
        Returns:
            True if deleted, False if not found
        """
        notifications = self.mongodb.get_collection("notifications")
        
        result = await notifications.delete_one(
            {"_id": notification_id, "recipient_id": user_id}
        )
        
        return result.deleted_count > 0
    
    async def get_unread_count(
        self,
        user_id: UUID,
    ) -> int:
        """Get count of unread notifications.
        
        Args:
            user_id: User ID
            
        Returns:
            Count of unread notifications
        """
        notifications = self.mongodb.get_collection("notifications")
        
        count = await notifications.count_documents(
            {"recipient_id": user_id, "status": "unread"}
        )
        
        return count
    
    # TODO: Future implementation
    async def _send_email_notification(
        self,
        user_id: UUID,
        notification: dict,
    ):
        """Send email notification (future implementation).
        
        Args:
            user_id: Recipient user ID
            notification: Notification data
        """
        # Check user's email notification preferences
        # Send email via SMTP or email service (SendGrid, SES, etc.)
        pass
