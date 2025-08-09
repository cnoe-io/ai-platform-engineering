"""Slack channel models for MCP"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class SlackChannel:
    """Represents a Slack channel"""
    id: str
    name: str
    is_private: bool = False
    is_archived: bool = False
    is_general: bool = False
    num_members: Optional[int] = None
    topic: Optional[str] = None
    purpose: Optional[str] = None
    created: Optional[datetime] = None
    creator: Optional[str] = None
    members: List[str] = field(default_factory=list)
    previous_names: List[str] = field(default_factory=list)


def channel_to_api_format(channel: SlackChannel) -> Dict[str, Any]:
    """Convert a SlackChannel object to the format expected by Slack API"""
    result = {
        "id": channel.id,
        "name": channel.name,
        "is_private": channel.is_private,
        "is_archived": channel.is_archived,
        "is_general": channel.is_general,
    }

    if channel.num_members is not None:
        result["num_members"] = channel.num_members
    if channel.topic:
        result["topic"] = channel.topic
    if channel.purpose:
        result["purpose"] = channel.purpose
    if channel.created:
        result["created"] = int(channel.created.timestamp())
    if channel.creator:
        result["creator"] = channel.creator
    if channel.members:
        result["members"] = channel.members
    if channel.previous_names:
        result["previous_names"] = channel.previous_names

    return result


def api_format_to_channel(data: Dict[str, Any]) -> SlackChannel:
    """Convert Slack API response to a SlackChannel object"""
    created = None
    if data.get("created"):
        created = datetime.fromtimestamp(data["created"])

    return SlackChannel(
        id=data.get("id", ""),
        name=data.get("name", ""),
        is_private=data.get("is_private", False),
        is_archived=data.get("is_archived", False),
        is_general=data.get("is_general", False),
        num_members=data.get("num_members"),
        topic=data.get("topic"),
        purpose=data.get("purpose"),
        created=created,
        creator=data.get("creator"),
        members=data.get("members", []),
        previous_names=data.get("previous_names", [])
    )