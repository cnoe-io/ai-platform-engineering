# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Integration tests for chat sharing functionality.

Tests:
- Share conversation with users
- Access validation for shared conversations
- Remove share access
- Audit logging for sharing actions
- Notifications for shared conversations
"""

import pytest
import asyncio
from uuid import uuid4
from datetime import datetime

from ai_platform_engineering.database.mongodb import MongoDBManager
from ai_platform_engineering.services.chat_service import ChatService
from ai_platform_engineering.services.audit_service import AuditService
from ai_platform_engineering.services.notification_service import NotificationService
from ai_platform_engineering.database.models import (
    CreateConversationRequest,
    ShareConversationRequest,
)


@pytest.fixture
async def mongodb_manager():
    """Create MongoDB manager for testing."""
    manager = MongoDBManager(
        connection_string="mongodb://admin:changeme@localhost:27017",
        database_name="caipe_test",
    )
    await manager.connect()
    yield manager
    
    # Cleanup: Drop test database
    await manager.client.drop_database("caipe_test")
    await manager.disconnect()


@pytest.fixture
async def services(mongodb_manager):
    """Create service instances for testing."""
    audit_service = AuditService(mongodb_manager)
    notification_service = NotificationService(mongodb_manager)
    chat_service = ChatService(mongodb_manager, audit_service, notification_service)
    
    return {
        "chat": chat_service,
        "audit": audit_service,
        "notification": notification_service,
    }


@pytest.fixture
async def test_users(services):
    """Create test users."""
    chat_service = services["chat"]
    
    # Create creator
    creator = await chat_service.get_or_create_user(
        email="creator@test.com",
        name="Creator User",
    )
    
    # Create collaborators
    collaborator1 = await chat_service.get_or_create_user(
        email="collaborator1@test.com",
        name="Collaborator One",
    )
    
    collaborator2 = await chat_service.get_or_create_user(
        email="collaborator2@test.com",
        name="Collaborator Two",
    )
    
    return {
        "creator": creator,
        "collaborator1": collaborator1,
        "collaborator2": collaborator2,
    }


@pytest.mark.asyncio
async def test_share_conversation_success(services, test_users):
    """Test successfully sharing a conversation."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Test Conversation",
            message="Hello, this is a test",
        ),
    )
    
    # Share with collaborator
    share_request = ShareConversationRequest(
        user_emails=["collaborator1@test.com"],
        permissions=["read"],
    )
    
    share_status = await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=share_request,
    )
    
    # Verify share status
    assert len(share_status.shared_with) == 1
    assert share_status.shared_with[0].user_email == "collaborator1@test.com"
    assert share_status.shared_with[0].permissions == ["read"]
    
    # Verify collaborator can access
    accessed_conv = await chat_service.get_conversation(
        conversation_id=conversation.id,
        user_id=collaborator1.id,
    )
    assert accessed_conv is not None
    assert accessed_conv.id == conversation.id


@pytest.mark.asyncio
async def test_share_with_multiple_users(services, test_users):
    """Test sharing with multiple users at once."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    
    # Create conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Multi-share Test",
            message="Sharing with multiple users",
        ),
    )
    
    # Share with both collaborators
    share_request = ShareConversationRequest(
        user_emails=["collaborator1@test.com", "collaborator2@test.com"],
        permissions=["read"],
    )
    
    share_status = await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=share_request,
    )
    
    # Verify both users have access
    assert len(share_status.shared_with) == 2
    emails = [u.user_email for u in share_status.shared_with]
    assert "collaborator1@test.com" in emails
    assert "collaborator2@test.com" in emails


@pytest.mark.asyncio
async def test_share_conversation_not_creator(services, test_users):
    """Test that non-creator cannot share conversation."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Test Conversation",
            message="Hello",
        ),
    )
    
    # Try to share as non-creator
    share_request = ShareConversationRequest(
        user_emails=["collaborator2@test.com"],
        permissions=["read"],
    )
    
    with pytest.raises(ValueError, match="Only conversation creator can share"):
        await chat_service.share_conversation(
            conversation_id=conversation.id,
            user_id=collaborator1.id,
            request=share_request,
        )


@pytest.mark.asyncio
async def test_access_denied_for_non_shared_user(services, test_users):
    """Test that non-shared user cannot access conversation."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    collaborator2 = test_users["collaborator2"]
    
    # Create conversation and share with collaborator1 only
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Private Conversation",
            message="Shared with one user only",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    # Verify collaborator2 cannot access
    accessed_conv = await chat_service.get_conversation(
        conversation_id=conversation.id,
        user_id=collaborator2.id,
    )
    assert accessed_conv is None


@pytest.mark.asyncio
async def test_remove_share_by_creator(services, test_users):
    """Test creator removing share access."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create and share conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Test Conversation",
            message="Hello",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    # Remove share
    removed = await chat_service.remove_share(
        conversation_id=conversation.id,
        user_id=creator.id,
        remove_user_id=collaborator1.id,
    )
    assert removed is True
    
    # Verify collaborator can no longer access
    accessed_conv = await chat_service.get_conversation(
        conversation_id=conversation.id,
        user_id=collaborator1.id,
    )
    assert accessed_conv is None


@pytest.mark.asyncio
async def test_remove_share_by_self(services, test_users):
    """Test user removing their own access."""
    chat_service = services["chat"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create and share conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Test Conversation",
            message="Hello",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    # Collaborator removes their own access
    removed = await chat_service.remove_share(
        conversation_id=conversation.id,
        user_id=collaborator1.id,
        remove_user_id=collaborator1.id,
    )
    assert removed is True
    
    # Verify they can no longer access
    accessed_conv = await chat_service.get_conversation(
        conversation_id=conversation.id,
        user_id=collaborator1.id,
    )
    assert accessed_conv is None


@pytest.mark.asyncio
async def test_audit_log_for_share_action(services, test_users):
    """Test audit logging for share actions."""
    chat_service = services["chat"]
    audit_service = services["audit"]
    creator = test_users["creator"]
    
    # Create and share conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Audit Test",
            message="Testing audit logs",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
        metadata={"ip_address": "127.0.0.1"},
    )
    
    # Check audit logs
    audit_logs = await audit_service.get_conversation_audit_history(
        conversation_id=conversation.id
    )
    
    assert len(audit_logs) > 0
    share_log = audit_logs[0]
    assert share_log["action"] == "share"
    assert share_log["actor"]["email"] == "creator@test.com"
    assert share_log["target_user"]["email"] == "collaborator1@test.com"
    assert share_log["permissions"] == ["read"]


@pytest.mark.asyncio
async def test_audit_log_for_unshare_action(services, test_users):
    """Test audit logging for unshare actions."""
    chat_service = services["chat"]
    audit_service = services["audit"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create, share, and unshare conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Unshare Audit Test",
            message="Testing unshare audit logs",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    await chat_service.remove_share(
        conversation_id=conversation.id,
        user_id=creator.id,
        remove_user_id=collaborator1.id,
        metadata={"ip_address": "127.0.0.1"},
    )
    
    # Check audit logs
    audit_logs = await audit_service.get_conversation_audit_history(
        conversation_id=conversation.id
    )
    
    # Should have both share and unshare logs
    assert len(audit_logs) >= 2
    unshare_log = audit_logs[0]  # Most recent
    assert unshare_log["action"] == "unshare"
    assert unshare_log["actor"]["email"] == "creator@test.com"
    assert unshare_log["target_user"]["email"] == "collaborator1@test.com"


@pytest.mark.asyncio
async def test_notification_for_share(services, test_users):
    """Test notification creation when sharing conversation."""
    chat_service = services["chat"]
    notification_service = services["notification"]
    creator = test_users["creator"]
    collaborator1 = test_users["collaborator1"]
    
    # Create and share conversation
    conversation = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(
            title="Notification Test",
            message="Testing notifications",
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conversation.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    # Check notifications for collaborator
    notifications = await notification_service.get_user_notifications(
        user_id=collaborator1.id,
        status="unread",
    )
    
    assert len(notifications) > 0
    notif = notifications[0]
    assert notif["type"] == "conversation_shared"
    assert notif["data"]["shared_by"]["email"] == "creator@test.com"
    assert notif["data"]["conversation"]["id"] == conversation.id
    assert notif["status"] == "unread"


@pytest.mark.asyncio
async def test_get_user_audit_history(services, test_users):
    """Test getting audit history for a user's actions."""
    chat_service = services["chat"]
    audit_service = services["audit"]
    creator = test_users["creator"]
    
    # Perform multiple actions
    conv1 = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(title="Conv 1", message="Test 1"),
    )
    
    conv2 = await chat_service.create_conversation(
        user_id=creator.id,
        request=CreateConversationRequest(title="Conv 2", message="Test 2"),
    )
    
    await chat_service.share_conversation(
        conversation_id=conv1.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator1@test.com"],
            permissions=["read"],
        ),
    )
    
    await chat_service.share_conversation(
        conversation_id=conv2.id,
        user_id=creator.id,
        request=ShareConversationRequest(
            user_emails=["collaborator2@test.com"],
            permissions=["read"],
        ),
    )
    
    # Get audit history for creator
    audit_logs = await audit_service.get_user_audit_history(
        user_id=creator.id,
        limit=100,
    )
    
    # Should have logs for both share actions
    assert len(audit_logs) >= 2
    share_actions = [log for log in audit_logs if log["action"] == "share"]
    assert len(share_actions) == 2


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
