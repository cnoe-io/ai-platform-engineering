# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

from typing import List, Optional
from datetime import datetime

from .models import Message, MessageType


class ConversationState:
    """Manages the conversation state for the AWS EKS Agent."""
    
    def __init__(self):
        """Initialize the conversation state."""
        self.messages: List[Message] = []
        self.session_id: Optional[str] = None
        self.created_at: datetime = datetime.now()
    
    def add_user_message(self, content: str, metadata: Optional[dict] = None) -> Message:
        """Add a user message to the conversation.
        
        Args:
            content: The message content
            metadata: Optional metadata for the message
            
        Returns:
            The created message
        """
        message = Message(
            type=MessageType.USER,
            content=content,
            timestamp=datetime.now().isoformat(),
            metadata=metadata or {}
        )
        self.messages.append(message)
        return message
    
    def add_assistant_message(self, content: str, metadata: Optional[dict] = None) -> Message:
        """Add an assistant message to the conversation.
        
        Args:
            content: The message content
            metadata: Optional metadata for the message
            
        Returns:
            The created message
        """
        message = Message(
            type=MessageType.ASSISTANT,
            content=content,
            timestamp=datetime.now().isoformat(),
            metadata=metadata or {}
        )
        self.messages.append(message)
        return message
    
    def add_system_message(self, content: str, metadata: Optional[dict] = None) -> Message:
        """Add a system message to the conversation.
        
        Args:
            content: The message content
            metadata: Optional metadata for the message
            
        Returns:
            The created message
        """
        message = Message(
            type=MessageType.SYSTEM,
            content=content,
            timestamp=datetime.now().isoformat(),
            metadata=metadata or {}
        )
        self.messages.append(message)
        return message
    
    def get_last_message(self, message_type: Optional[MessageType] = None) -> Optional[Message]:
        """Get the last message of a specific type.
        
        Args:
            message_type: Optional filter by message type
            
        Returns:
            The last message or None if not found
        """
        if not self.messages:
            return None
            
        if message_type is None:
            return self.messages[-1]
        
        for message in reversed(self.messages):
            if message.type == message_type:
                return message
        
        return None
    
    def get_messages_by_type(self, message_type: MessageType) -> List[Message]:
        """Get all messages of a specific type.
        
        Args:
            message_type: The message type to filter by
            
        Returns:
            List of messages matching the type
        """
        return [msg for msg in self.messages if msg.type == message_type]
    
    def get_conversation_summary(self) -> dict:
        """Get a summary of the conversation.
        
        Returns:
            Dictionary with conversation statistics
        """
        user_messages = len(self.get_messages_by_type(MessageType.USER))
        assistant_messages = len(self.get_messages_by_type(MessageType.ASSISTANT))
        system_messages = len(self.get_messages_by_type(MessageType.SYSTEM))
        
        return {
            "total_messages": len(self.messages),
            "user_messages": user_messages,
            "assistant_messages": assistant_messages,
            "system_messages": system_messages,
            "session_id": self.session_id,
            "created_at": self.created_at.isoformat(),
            "duration_minutes": (datetime.now() - self.created_at).total_seconds() / 60
        }
    
    def reset(self):
        """Reset the conversation state."""
        self.messages.clear()
        self.session_id = None
        self.created_at = datetime.now()
    
    def set_session_id(self, session_id: str):
        """Set the session ID for the conversation.
        
        Args:
            session_id: The session identifier
        """
        self.session_id = session_id
