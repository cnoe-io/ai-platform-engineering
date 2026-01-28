# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Database models for MongoDB collections.

This module defines Pydantic models for:
- Users (authentication, preferences)
- Conversations (chat history, messages, sharing)
- Messages (user/assistant messages with metadata)
"""

from datetime import datetime
from typing import List, Optional, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, EmailStr


class UserPreferences(BaseModel):
    """User preferences stored in MongoDB."""
    theme: str = "minimal"
    font_family: str = "system"
    default_agents: List[str] = Field(default_factory=lambda: ["argocd", "aws"])
    notifications_enabled: bool = True


class User(BaseModel):
    """User model for MongoDB users collection."""
    id: UUID = Field(default_factory=uuid4, alias="_id")
    email: EmailStr
    name: str
    avatar_url: Optional[str] = None
    preferences: UserPreferences = Field(default_factory=UserPreferences)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_login: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        populate_by_name = True  # Allow both _id and id
        json_encoders = {
            UUID: str,
            datetime: lambda v: v.isoformat(),
        }


class MessageFeedback(BaseModel):
    """Feedback for an assistant message."""
    rating: Literal["positive", "negative"]
    comment: Optional[str] = None
    submitted_at: datetime = Field(default_factory=datetime.utcnow)


class Message(BaseModel):
    """Message in a conversation."""
    id: UUID = Field(default_factory=uuid4)
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    turn_id: Optional[str] = None
    is_final: bool = False
    feedback: Optional[MessageFeedback] = None
    
    # Note: A2A events are NOT persisted (too large for MongoDB)
    # events: List[A2AEvent] = []  # Excluded from persistence


class SharedUser(BaseModel):
    """User who has access to a shared conversation."""
    user_id: UUID
    user_email: EmailStr
    shared_at: datetime = Field(default_factory=datetime.utcnow)
    shared_by: UUID  # ID of user who shared
    permissions: List[Literal["read", "write", "share"]] = Field(default_factory=lambda: ["read"])


class Conversation(BaseModel):
    """Conversation model for MongoDB conversations collection."""
    id: UUID = Field(default_factory=uuid4, alias="_id")
    title: str = "New Conversation"
    created_by: UUID  # User ID
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Access control
    shared_with: List[SharedUser] = Field(default_factory=list)
    visibility: Literal["private", "team", "public"] = "private"
    
    # Chat data
    messages: List[Message] = Field(default_factory=list)
    
    # Metadata
    tags: List[str] = Field(default_factory=list)
    total_messages: int = 0
    last_message_at: Optional[datetime] = None
    
    class Config:
        populate_by_name = True  # Allow both _id and id
        json_encoders = {
            UUID: str,
            datetime: lambda v: v.isoformat(),
        }


# ============================================================================
# Request/Response Models (API DTOs)
# ============================================================================

class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    title: Optional[str] = None
    message: str  # Initial user message


class UpdateConversationRequest(BaseModel):
    """Request to update conversation metadata."""
    title: Optional[str] = None
    tags: Optional[List[str]] = None


class AddMessageRequest(BaseModel):
    """Request to add a message to a conversation."""
    role: Literal["user", "assistant"]
    content: str
    turn_id: Optional[str] = None
    is_final: bool = False


class ShareConversationRequest(BaseModel):
    """Request to share a conversation with users."""
    user_emails: List[EmailStr]
    permissions: List[Literal["read", "write", "share"]] = Field(
        default_factory=lambda: ["read"]
    )


class ShareStatus(BaseModel):
    """Status of conversation sharing."""
    created_by: User
    shared_with: List[SharedUser]
    visibility: str


class ConversationListResponse(BaseModel):
    """Response for listing conversations."""
    conversations: List[Conversation]
    total: int
    page: int
    limit: int


class UpdateUserPreferencesRequest(BaseModel):
    """Request to update user preferences."""
    theme: Optional[str] = None
    font_family: Optional[str] = None
    default_agents: Optional[List[str]] = None
    notifications_enabled: Optional[bool] = None
