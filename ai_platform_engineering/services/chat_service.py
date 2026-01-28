# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Chat service with business logic for conversations and sharing.

This module provides:
- Conversation CRUD operations
- Message management
- Sharing and access control
- User creation and lookup
"""

import logging
from datetime import datetime
from typing import List, Optional, Literal
from uuid import UUID

from pymongo.errors import DuplicateKeyError

from ai_platform_engineering.database.mongodb import MongoDBManager
from ai_platform_engineering.database.models import (
    User,
    UserPreferences,
    Conversation,
    Message,
    SharedUser,
    CreateConversationRequest,
    UpdateConversationRequest,
    AddMessageRequest,
    ShareConversationRequest,
    ShareStatus,
    ConversationListResponse,
    UpdateUserPreferencesRequest,
)

logger = logging.getLogger(__name__)


class ChatService:
    """Service for managing chat conversations and users.
    
    Provides:
    - User creation and lookup
    - Conversation CRUD
    - Message management
    - Sharing and access control
    """
    
    def __init__(self, mongodb: MongoDBManager):
        """Initialize chat service.
        
        Args:
            mongodb: MongoDB manager instance
        """
        self.mongodb = mongodb
    
    # ========================================================================
    # User Management
    # ========================================================================
    
    async def get_or_create_user(
        self,
        email: str,
        name: str,
        avatar_url: Optional[str] = None,
    ) -> User:
        """Get user by email or create if doesn't exist.
        
        Called on every login to ensure user exists in database.
        Updates last_login timestamp.
        
        Args:
            email: User email (from SSO)
            name: User name (from SSO)
            avatar_url: User avatar URL (from SSO)
            
        Returns:
            User object
        """
        users = self.mongodb.users
        
        # Try to find existing user
        user_doc = await users.find_one({"email": email})
        
        if user_doc:
            # Update last_login
            await users.update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"last_login": datetime.utcnow()}}
            )
            return User(**user_doc)
        
        # Create new user
        user = User(
            email=email,
            name=name,
            avatar_url=avatar_url,
            preferences=UserPreferences(),
        )
        
        try:
            await users.insert_one(user.model_dump(by_alias=True))
            logger.info(f"Created new user: {email}")
            return user
        except DuplicateKeyError:
            # Race condition - another request created user
            user_doc = await users.find_one({"email": email})
            return User(**user_doc)
    
    async def get_user_by_id(self, user_id: UUID) -> Optional[User]:
        """Get user by ID.
        
        Args:
            user_id: User UUID
            
        Returns:
            User object or None if not found
        """
        users = self.mongodb.users
        user_doc = await users.find_one({"_id": user_id})
        return User(**user_doc) if user_doc else None
    
    async def get_user_by_email(self, email: str) -> Optional[User]:
        """Get user by email.
        
        Args:
            email: User email
            
        Returns:
            User object or None if not found
        """
        users = self.mongodb.users
        user_doc = await users.find_one({"email": email})
        return User(**user_doc) if user_doc else None
    
    async def update_user_preferences(
        self,
        user_id: UUID,
        preferences: UpdateUserPreferencesRequest,
    ) -> User:
        """Update user preferences.
        
        Args:
            user_id: User UUID
            preferences: Preferences to update
            
        Returns:
            Updated user object
            
        Raises:
            ValueError: If user not found
        """
        users = self.mongodb.users
        
        # Build update dict (only include fields that are set)
        update_dict = {}
        if preferences.theme is not None:
            update_dict["preferences.theme"] = preferences.theme
        if preferences.font_family is not None:
            update_dict["preferences.font_family"] = preferences.font_family
        if preferences.default_agents is not None:
            update_dict["preferences.default_agents"] = preferences.default_agents
        if preferences.notifications_enabled is not None:
            update_dict["preferences.notifications_enabled"] = preferences.notifications_enabled
        
        result = await users.find_one_and_update(
            {"_id": user_id},
            {"$set": update_dict},
            return_document=True,
        )
        
        if not result:
            raise ValueError(f"User not found: {user_id}")
        
        return User(**result)
    
    # ========================================================================
    # Conversation Management
    # ========================================================================
    
    async def create_conversation(
        self,
        user_id: UUID,
        request: CreateConversationRequest,
    ) -> Conversation:
        """Create a new conversation with initial message.
        
        Args:
            user_id: User ID (creator)
            request: Conversation creation request
            
        Returns:
            Created conversation
        """
        conversations = self.mongodb.conversations
        
        # Create initial message
        message = Message(
            role="user",
            content=request.message,
            turn_id=f"turn-{int(datetime.utcnow().timestamp() * 1000)}",
        )
        
        # Create conversation
        conversation = Conversation(
            title=request.title or request.message[:50],  # Use first 50 chars as title
            created_by=user_id,
            messages=[message],
            total_messages=1,
            last_message_at=message.timestamp,
        )
        
        await conversations.insert_one(conversation.model_dump(by_alias=True))
        logger.info(f"Created conversation {conversation.id} for user {user_id}")
        
        return conversation
    
    async def get_conversation(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> Optional[Conversation]:
        """Get conversation by ID with access validation.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (for access check)
            
        Returns:
            Conversation or None if not found or no access
        """
        conversations = self.mongodb.conversations
        conv_doc = await conversations.find_one({"_id": conversation_id})
        
        if not conv_doc:
            return None
        
        conversation = Conversation(**conv_doc)
        
        # Validate access
        if not await self._can_access_conversation(user_id, conversation):
            logger.warning(
                f"User {user_id} attempted to access conversation {conversation_id} without permission"
            )
            return None
        
        return conversation
    
    async def list_conversations(
        self,
        user_id: UUID,
        page: int = 1,
        limit: int = 50,
        filter_type: Literal["owned", "shared", "all"] = "all",
    ) -> ConversationListResponse:
        """List conversations for a user.
        
        Args:
            user_id: User ID
            page: Page number (1-indexed)
            limit: Items per page
            filter_type: Filter by ownership ("owned", "shared", "all")
            
        Returns:
            List of conversations with pagination info
        """
        conversations = self.mongodb.conversations
        
        # Build query based on filter
        if filter_type == "owned":
            query = {"created_by": user_id}
        elif filter_type == "shared":
            query = {"shared_with.user_id": user_id}
        else:  # all
            query = {"$or": [
                {"created_by": user_id},
                {"shared_with.user_id": user_id},
            ]}
        
        # Count total
        total = await conversations.count_documents(query)
        
        # Get paginated results
        skip = (page - 1) * limit
        cursor = conversations.find(query).sort("updated_at", -1).skip(skip).limit(limit)
        
        conv_list = []
        async for doc in cursor:
            conv_list.append(Conversation(**doc))
        
        return ConversationListResponse(
            conversations=conv_list,
            total=total,
            page=page,
            limit=limit,
        )
    
    async def update_conversation(
        self,
        conversation_id: UUID,
        user_id: UUID,
        request: UpdateConversationRequest,
    ) -> Conversation:
        """Update conversation metadata.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (must be creator)
            request: Update request
            
        Returns:
            Updated conversation
            
        Raises:
            ValueError: If conversation not found or no permission
        """
        conversations = self.mongodb.conversations
        
        # Verify user is creator
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            raise ValueError(f"Conversation not found: {conversation_id}")
        
        if conv_doc["created_by"] != user_id:
            raise ValueError("Only conversation creator can update metadata")
        
        # Build update dict
        update_dict = {"updated_at": datetime.utcnow()}
        if request.title is not None:
            update_dict["title"] = request.title
        if request.tags is not None:
            update_dict["tags"] = request.tags
        
        result = await conversations.find_one_and_update(
            {"_id": conversation_id},
            {"$set": update_dict},
            return_document=True,
        )
        
        return Conversation(**result)
    
    async def delete_conversation(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Delete conversation.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (must be creator)
            
        Returns:
            True if deleted, False if not found
            
        Raises:
            ValueError: If user is not creator
        """
        conversations = self.mongodb.conversations
        
        # Verify user is creator
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            return False
        
        if conv_doc["created_by"] != user_id:
            raise ValueError("Only conversation creator can delete")
        
        result = await conversations.delete_one({"_id": conversation_id})
        
        if result.deleted_count > 0:
            logger.info(f"Deleted conversation {conversation_id}")
            return True
        
        return False
    
    # ========================================================================
    # Message Management
    # ========================================================================
    
    async def add_message(
        self,
        conversation_id: UUID,
        user_id: UUID,
        request: AddMessageRequest,
    ) -> Message:
        """Add message to conversation.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (for access check)
            request: Message to add
            
        Returns:
            Added message
            
        Raises:
            ValueError: If conversation not found or no access
        """
        conversations = self.mongodb.conversations
        
        # Verify access
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            raise ValueError(f"Conversation not found: {conversation_id}")
        
        conversation = Conversation(**conv_doc)
        if not await self._can_access_conversation(user_id, conversation):
            raise ValueError("No permission to add messages to this conversation")
        
        # Create message
        message = Message(
            role=request.role,
            content=request.content,
            turn_id=request.turn_id,
            is_final=request.is_final,
        )
        
        # Update conversation
        await conversations.update_one(
            {"_id": conversation_id},
            {
                "$push": {"messages": message.model_dump()},
                "$set": {
                    "updated_at": datetime.utcnow(),
                    "last_message_at": message.timestamp,
                },
                "$inc": {"total_messages": 1},
            },
        )
        
        return message
    
    # ========================================================================
    # Sharing and Access Control
    # ========================================================================
    
    async def share_conversation(
        self,
        conversation_id: UUID,
        user_id: UUID,
        request: ShareConversationRequest,
    ) -> ShareStatus:
        """Share conversation with other users.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (must be creator)
            request: Share request with user emails
            
        Returns:
            Share status
            
        Raises:
            ValueError: If conversation not found or user not creator
        """
        conversations = self.mongodb.conversations
        
        # Verify user is creator
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            raise ValueError(f"Conversation not found: {conversation_id}")
        
        if conv_doc["created_by"] != user_id:
            raise ValueError("Only conversation creator can share")
        
        # Look up users by email
        shared_users = []
        for email in request.user_emails:
            user = await self.get_user_by_email(email)
            if not user:
                logger.warning(f"User not found for email: {email}, skipping")
                continue
            
            # Don't share with self
            if user.id == user_id:
                continue
            
            shared_user = SharedUser(
                user_id=user.id,
                user_email=user.email,
                shared_by=user_id,
                permissions=request.permissions,
            )
            shared_users.append(shared_user)
        
        # Update conversation (add to shared_with, avoid duplicates)
        await conversations.update_one(
            {"_id": conversation_id},
            {
                "$addToSet": {
                    "shared_with": {
                        "$each": [u.model_dump() for u in shared_users]
                    }
                },
                "$set": {"updated_at": datetime.utcnow()},
            },
        )
        
        logger.info(
            f"Shared conversation {conversation_id} with {len(shared_users)} users"
        )
        
        # Return updated share status
        return await self.get_share_status(conversation_id, user_id)
    
    async def get_share_status(
        self,
        conversation_id: UUID,
        user_id: UUID,
    ) -> ShareStatus:
        """Get sharing status for a conversation.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (for access check)
            
        Returns:
            Share status
            
        Raises:
            ValueError: If conversation not found or no access
        """
        conversations = self.mongodb.conversations
        
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            raise ValueError(f"Conversation not found: {conversation_id}")
        
        conversation = Conversation(**conv_doc)
        if not await self._can_access_conversation(user_id, conversation):
            raise ValueError("No permission to view share status")
        
        # Get creator info
        creator = await self.get_user_by_id(conversation.created_by)
        
        return ShareStatus(
            created_by=creator,
            shared_with=conversation.shared_with,
            visibility=conversation.visibility,
        )
    
    async def remove_share(
        self,
        conversation_id: UUID,
        user_id: UUID,
        remove_user_id: UUID,
    ) -> bool:
        """Remove user's access to a conversation.
        
        Args:
            conversation_id: Conversation UUID
            user_id: User ID (must be creator or removing self)
            remove_user_id: User ID to remove
            
        Returns:
            True if removed, False if not found
            
        Raises:
            ValueError: If no permission
        """
        conversations = self.mongodb.conversations
        
        # Verify user is creator or removing self
        conv_doc = await conversations.find_one({"_id": conversation_id})
        if not conv_doc:
            return False
        
        is_creator = conv_doc["created_by"] == user_id
        is_removing_self = user_id == remove_user_id
        
        if not (is_creator or is_removing_self):
            raise ValueError("Only creator can remove others, or users can remove themselves")
        
        # Remove from shared_with array
        result = await conversations.update_one(
            {"_id": conversation_id},
            {
                "$pull": {"shared_with": {"user_id": remove_user_id}},
                "$set": {"updated_at": datetime.utcnow()},
            },
        )
        
        if result.modified_count > 0:
            logger.info(f"Removed user {remove_user_id} from conversation {conversation_id}")
            return True
        
        return False
    
    async def _can_access_conversation(
        self,
        user_id: UUID,
        conversation: Conversation,
    ) -> bool:
        """Check if user can access conversation.
        
        Args:
            user_id: User ID
            conversation: Conversation object
            
        Returns:
            True if user has access
        """
        # Creator always has access
        if conversation.created_by == user_id:
            return True
        
        # Check if user is in shared_with list
        for shared_user in conversation.shared_with:
            if shared_user.user_id == user_id:
                return True
        
        return False
