"""Slack message models for MCP"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SlackUser:
    """Represents a Slack user"""
    id: str
    name: str
    real_name: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    is_bot: bool = False
    is_admin: bool = False
    is_owner: bool = False
    is_primary_owner: bool = False
    is_restricted: bool = False
    is_ultra_restricted: bool = False


@dataclass
class SlackMessage:
    """Represents a Slack message"""
    ts: str
    text: str
    user: Optional[str] = None
    channel: Optional[str] = None
    team: Optional[str] = None
    type: str = "message"
    subtype: Optional[str] = None
    thread_ts: Optional[str] = None
    reply_count: Optional[int] = None
    reply_users_count: Optional[int] = None
    latest_reply: Optional[str] = None
    reply_users: List[str] = field(default_factory=list)
    reactions: List[Dict[str, Any]] = field(default_factory=list)
    attachments: List[Dict[str, Any]] = field(default_factory=list)
    blocks: List[Dict[str, Any]] = field(default_factory=list)


def message_to_api_format(msg: SlackMessage) -> Dict[str, Any]:
    """Convert a SlackMessage object to the format expected by Slack API"""
    result = {
        "text": msg.text,
        "ts": msg.ts,
        "type": msg.type,
    }

    if msg.user:
        result["user"] = msg.user
    if msg.channel:
        result["channel"] = msg.channel
    if msg.team:
        result["team"] = msg.team
    if msg.subtype:
        result["subtype"] = msg.subtype
    if msg.thread_ts:
        result["thread_ts"] = msg.thread_ts
    if msg.reply_count is not None:
        result["reply_count"] = msg.reply_count
    if msg.reply_users_count is not None:
        result["reply_users_count"] = msg.reply_users_count
    if msg.latest_reply:
        result["latest_reply"] = msg.latest_reply
    if msg.reply_users:
        result["reply_users"] = msg.reply_users
    if msg.reactions:
        result["reactions"] = msg.reactions
    if msg.attachments:
        result["attachments"] = msg.attachments
    if msg.blocks:
        result["blocks"] = msg.blocks

    return result


def api_format_to_message(data: Dict[str, Any]) -> SlackMessage:
    """Convert Slack API response to a SlackMessage object"""
    return SlackMessage(
        ts=data.get("ts", ""),
        text=data.get("text", ""),
        user=data.get("user"),
        channel=data.get("channel"),
        team=data.get("team"),
        type=data.get("type", "message"),
        subtype=data.get("subtype"),
        thread_ts=data.get("thread_ts"),
        reply_count=data.get("reply_count"),
        reply_users_count=data.get("reply_users_count"),
        latest_reply=data.get("latest_reply"),
        reply_users=data.get("reply_users", []),
        reactions=data.get("reactions", []),
        attachments=data.get("attachments", []),
        blocks=data.get("blocks", [])
    )