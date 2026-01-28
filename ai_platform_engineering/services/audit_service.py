# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Audit service for tracking security-sensitive actions.

This module provides:
- Audit log recording for sharing actions
- Query audit history
- Compliance and security monitoring
"""

import logging
from datetime import datetime
from typing import List, Optional, Literal
from uuid import UUID, uuid4

from ai_platform_engineering.database.mongodb import MongoDBManager

logger = logging.getLogger(__name__)


class AuditService:
    """Service for recording and querying audit logs.
    
    Audit logs track security-sensitive actions such as:
    - Conversation sharing
    - Access removal
    - Permission changes
    - User authentication
    """
    
    def __init__(self, mongodb: MongoDBManager):
        """Initialize audit service.
        
        Args:
            mongodb: MongoDB manager instance
        """
        self.mongodb = mongodb
    
    async def log_share_action(
        self,
        action: Literal["share", "unshare", "update_permissions"],
        actor_id: UUID,
        actor_email: str,
        conversation_id: UUID,
        target_user_id: Optional[UUID] = None,
        target_user_email: Optional[str] = None,
        permissions: Optional[List[str]] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """Log a conversation sharing action.
        
        Args:
            action: Type of action performed
            actor_id: User ID who performed the action
            actor_email: Email of user who performed the action
            conversation_id: Conversation being shared
            target_user_id: User ID being granted/removed access
            target_user_email: Email of user being granted/removed access
            permissions: Permissions granted (for share action)
            metadata: Additional context
            
        Returns:
            Audit log ID
        """
        audit_logs = self.mongodb.get_collection("audit_logs")
        
        log_entry = {
            "_id": uuid4(),
            "timestamp": datetime.utcnow(),
            "action_type": "conversation_sharing",
            "action": action,
            "actor": {
                "user_id": actor_id,
                "email": actor_email,
            },
            "resource": {
                "type": "conversation",
                "id": conversation_id,
            },
            "target_user": {
                "user_id": target_user_id,
                "email": target_user_email,
            } if target_user_id else None,
            "permissions": permissions,
            "metadata": metadata or {},
            "ip_address": metadata.get("ip_address") if metadata else None,
            "user_agent": metadata.get("user_agent") if metadata else None,
        }
        
        await audit_logs.insert_one(log_entry)
        
        logger.info(
            f"Audit log created: {action} by {actor_email} on conversation {conversation_id}"
        )
        
        return str(log_entry["_id"])
    
    async def log_access_attempt(
        self,
        success: bool,
        user_id: UUID,
        user_email: str,
        conversation_id: UUID,
        reason: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """Log a conversation access attempt.
        
        Args:
            success: Whether access was granted
            user_id: User attempting access
            user_email: Email of user attempting access
            conversation_id: Conversation being accessed
            reason: Reason for denial (if unsuccessful)
            metadata: Additional context
            
        Returns:
            Audit log ID
        """
        audit_logs = self.mongodb.get_collection("audit_logs")
        
        log_entry = {
            "_id": uuid4(),
            "timestamp": datetime.utcnow(),
            "action_type": "access_attempt",
            "action": "access" if success else "access_denied",
            "actor": {
                "user_id": user_id,
                "email": user_email,
            },
            "resource": {
                "type": "conversation",
                "id": conversation_id,
            },
            "success": success,
            "reason": reason,
            "metadata": metadata or {},
            "ip_address": metadata.get("ip_address") if metadata else None,
            "user_agent": metadata.get("user_agent") if metadata else None,
        }
        
        await audit_logs.insert_one(log_entry)
        
        if not success:
            logger.warning(
                f"Access denied: {user_email} attempted to access conversation {conversation_id}"
            )
        
        return str(log_entry["_id"])
    
    async def get_conversation_audit_history(
        self,
        conversation_id: UUID,
        limit: int = 100,
    ) -> List[dict]:
        """Get audit history for a conversation.
        
        Args:
            conversation_id: Conversation ID
            limit: Maximum number of logs to return
            
        Returns:
            List of audit log entries
        """
        audit_logs = self.mongodb.get_collection("audit_logs")
        
        cursor = audit_logs.find(
            {"resource.id": conversation_id}
        ).sort("timestamp", -1).limit(limit)
        
        logs = []
        async for log in cursor:
            logs.append(log)
        
        return logs
    
    async def get_user_audit_history(
        self,
        user_id: UUID,
        limit: int = 100,
    ) -> List[dict]:
        """Get audit history for a user's actions.
        
        Args:
            user_id: User ID
            limit: Maximum number of logs to return
            
        Returns:
            List of audit log entries
        """
        audit_logs = self.mongodb.get_collection("audit_logs")
        
        cursor = audit_logs.find(
            {"actor.user_id": user_id}
        ).sort("timestamp", -1).limit(limit)
        
        logs = []
        async for log in cursor:
            logs.append(log)
        
        return logs
    
    async def get_security_events(
        self,
        event_type: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 1000,
    ) -> List[dict]:
        """Get security events for monitoring.
        
        Args:
            event_type: Filter by event type (e.g., "access_denied")
            start_date: Start date for time range
            end_date: End date for time range
            limit: Maximum number of logs to return
            
        Returns:
            List of security event logs
        """
        audit_logs = self.mongodb.get_collection("audit_logs")
        
        query = {}
        
        if event_type:
            query["action"] = event_type
        
        if start_date or end_date:
            query["timestamp"] = {}
            if start_date:
                query["timestamp"]["$gte"] = start_date
            if end_date:
                query["timestamp"]["$lte"] = end_date
        
        cursor = audit_logs.find(query).sort("timestamp", -1).limit(limit)
        
        logs = []
        async for log in cursor:
            logs.append(log)
        
        return logs
