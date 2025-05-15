# agent_slack/slack_mcp/tool_registry.py
# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""
Registry of Slack MCP tools for the Agent Slack module.
"""

from agent_slack.slack_mcp.tools import channels, messages, files, users

TOOL_REGISTRY = [
    # Channel tools
    {
        "name": "list_channels",
        "description": "List channels in the workspace",
        "function": channels.list_channels,
        "parameters": {
            "limit": {"type": "integer", "description": "Max channels to return"},
            "cursor": {"type": "string", "description": "Pagination cursor"},
            "exclude_archived": {"type": "boolean", "description": "Exclude archived channels"},
        },
    },
    {
        "name": "get_channel_info",
        "description": "Get detailed information about a specific channel",
        "function": channels.get_channel_info,
        "parameters": {"channel_id": {"type": "string", "description": "ID of the channel"}},
    },
    {
        "name": "join_channel",
        "description": "Join a public channel",
        "function": channels.join_channel,
        "parameters": {"channel_id": {"type": "string", "description": "ID of the channel"}},
    },
    {
        "name": "leave_channel",
        "description": "Leave a channel",
        "function": channels.leave_channel,
        "parameters": {"channel_id": {"type": "string", "description": "ID of the channel"}},
    },
    # Message tools
    {
        "name": "list_messages",
        "description": "List messages in a channel",
        "function": messages.list_messages,
        "parameters": {
            "channel_id": {"type": "string", "description": "ID of the channel"},
            "limit": {"type": "integer", "description": "Max messages to return"},
            "cursor": {"type": "string", "description": "Pagination cursor"},
            "latest": {"type": "string", "description": "End of time range (timestamp)"},
            "oldest": {"type": "string", "description": "Start of time range (timestamp)"},
        },
    },
    {
        "name": "send_message",
        "description": "Send a message to a channel",
        "function": messages.send_message,
        "parameters": {
            "channel_id": {"type": "string", "description": "Channel ID"},
            "text": {"type": "string", "description": "Message text"},
            "thread_ts": {"type": "string", "description": "Thread timestamp"},
            "blocks": {"type": "array", "description": "Blocks for rich formatting"},
        },
    },
    {
        "name": "update_message",
        "description": "Update an existing message",
        "function": messages.update_message,
        "parameters": {
            "channel_id": {"type": "string", "description": "Channel containing the message"},
            "ts": {"type": "string", "description": "Timestamp of message"},
            "text": {"type": "string", "description": "New text"},
            "blocks": {"type": "array", "description": "New blocks"},
        },
    },
    {
        "name": "delete_message",
        "description": "Delete a message",
        "function": messages.delete_message,
        "parameters": {
            "channel_id": {"type": "string", "description": "Channel containing the message"},
            "ts": {"type": "string", "description": "Timestamp of the message"},
        },
    },
    {
        "name": "add_reaction",
        "description": "Add a reaction to a message",
        "function": messages.add_reaction,
        "parameters": {
            "channel_id": {"type": "string", "description": "Channel containing the message"},
            "ts": {"type": "string", "description": "Timestamp of the message"},
            "reaction": {"type": "string", "description": "Emoji reaction name"},
        },
    },
    {
        "name": "remove_reaction",
        "description": "Remove a reaction from a message",
        "function": messages.remove_reaction,
        "parameters": {
            "channel_id": {"type": "string", "description": "Channel containing the message"},
            "ts": {"type": "string", "description": "Timestamp of the message"},
            "reaction": {"type": "string", "description": "Emoji reaction name"},
        },
    },
    # File tools
    {
        "name": "list_files",
        "description": "List files in the workspace or in a channel",
        "function": files.list_files,
        "parameters": {
            "channel_id": {"type": "string", "description": "Optional channel ID"},
            "user_id": {"type": "string", "description": "Optional user ID"},
            "limit": {"type": "integer", "description": "Max files to return"},
            "cursor": {"type": "string", "description": "Pagination cursor"},
        },
    },
    {
        "name": "upload_file",
        "description": "Upload a file to Slack",
        "function": files.upload_file,
        "parameters": {
            "file_content": {"type": "string", "description": "File content as string"},
            "filename": {"type": "string", "description": "Name of the file"},
            "filetype": {"type": "string", "description": "Type of the file"},
            "title": {"type": "string", "description": "Title of the file"},
            "channel_id": {"type": "string", "description": "Optional channel ID"},
            "initial_comment": {"type": "string", "description": "Optional comment"},
            "thread_ts": {"type": "string", "description": "Thread timestamp"},
        },
    },
    {
        "name": "get_file_info",
        "description": "Get information about a specific file",
        "function": files.get_file_info,
        "parameters": {"file_id": {"type": "string", "description": "ID of the file"}},
    },
    {
        "name": "delete_file",
        "description": "Delete a file",
        "function": files.delete_file,
        "parameters": {"file_id": {"type": "string", "description": "ID of the file"}},
    },
    # User tools
    {
        "name": "list_users",
        "description": "List users in the workspace",
        "function": users.list_users,
        "parameters": {
            "limit": {"type": "integer", "description": "Max users to return"},
            "cursor": {"type": "string", "description": "Pagination cursor"},
        },
    },
    {
        "name": "get_user_info",
        "description": "Get detailed information about a specific user",
        "function": users.get_user_info,
        "parameters": {"user_id": {"type": "string", "description": "ID of the user"}},
    },
    {
        "name": "set_user_status",
        "description": "Set status for the authenticated user",
        "function": users.set_user_status,
        "parameters": {
            "status_text": {"type": "string", "description": "Status text"},
            "status_emoji": {"type": "string", "description": "Status emoji"},
            "expiration": {"type": "integer", "description": "Unix timestamp for expiry"},
        },
    },
]
