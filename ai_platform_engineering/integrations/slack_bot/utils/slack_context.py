# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Thread Context Utilities

Handles fetching and building conversation context from Slack threads:
- Fetch thread history
- Get user display names
- Build formatted conversation context for AI
- Extract message text from events
"""

import os
from typing import List, Dict, Any
from loguru import logger

APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))


def fetch_thread_history(app, channel_id: str, thread_ts: str) -> List[Dict[str, Any]]:
    """Fetch all messages from a Slack thread."""
    try:
        result = app.client.conversations_replies(
            channel=channel_id, ts=thread_ts, limit=100
        )
        return result.get("messages", [])
    except Exception as e:
        logger.warning(f"Error fetching thread history: {e}")
        return []


def get_user_display_name(app, user_id: str) -> str:
    """Get display name for a user."""
    try:
        result = app.client.users_info(user=user_id)
        user = result.get("user", {})
        return (
            user.get("profile", {}).get("display_name")
            or user.get("real_name")
            or user.get("name")
            or f"User {user_id}"
        )
    except Exception as e:
        logger.warning(f"Error fetching user info: {e}")
        return f"User {user_id}"


def build_thread_context(
    app, channel_id: str, thread_ts: str, current_message: str, bot_user_id: str
) -> str:
    """Build formatted conversation context from a thread."""
    messages = fetch_thread_history(app, channel_id, thread_ts)

    if not messages:
        return current_message

    conversation_lines = ["Previous conversation:"]
    conversation_lines.append("---")

    for msg in messages:
        full_text = extract_message_text(msg)

        if not full_text.strip():
            continue

        user_id = msg.get("user")
        bot_id = msg.get("bot_id")

        if bot_id or (user_id and user_id == bot_user_id):
            speaker = APP_NAME
        elif user_id:
            speaker = get_user_display_name(app, user_id)
        else:
            speaker = "Unknown"

        conversation_lines.append(f"{speaker}: {full_text}")

    conversation_lines.append("---")
    conversation_lines.append(f"Current question: {current_message}")

    return "\n".join(conversation_lines)


def extract_message_text(event: Dict[str, Any]) -> str:
    """Extract comprehensive message text from a Slack event."""
    content_parts = []

    text = event.get("text", "")
    if text.strip():
        content_parts.append(text)

    if event.get("blocks"):
        for block in event.get("blocks", []):
            if block.get("type") == "section" and block.get("text"):
                block_text = block["text"].get("text", "")
                if block_text and block_text not in content_parts:
                    content_parts.append(block_text)
            elif block.get("type") == "context":
                for element in block.get("elements", []):
                    if element.get("type") == "mrkdwn":
                        elem_text = element.get("text", "")
                        if elem_text and elem_text not in content_parts:
                            content_parts.append(elem_text)
            elif block.get("type") == "header" and block.get("text"):
                header_text = block["text"].get("text", "")
                if header_text and header_text not in content_parts:
                    content_parts.append(f"**{header_text}**")

    if event.get("attachments"):
        for attachment in event.get("attachments", []):
            if attachment.get("title"):
                content_parts.append(f"Title: {attachment['title']}")
            if attachment.get("text"):
                content_parts.append(attachment["text"])
            if attachment.get("pretext"):
                content_parts.append(attachment["pretext"])
            if attachment.get("fields"):
                for field in attachment["fields"]:
                    field_title = field.get("title", "")
                    field_value = field.get("value", "")
                    if field_title or field_value:
                        content_parts.append(f"{field_title}: {field_value}")

    return "\n".join(content_parts).strip()
