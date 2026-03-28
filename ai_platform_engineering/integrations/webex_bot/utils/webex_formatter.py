"""
Webex message formatting utilities.

Formats A2A events (execution plans, tool notifications, progress, errors)
into Webex-compatible Markdown. Webex supports standard Markdown natively.
"""

from typing import Dict, List, Optional

WEBEX_MAX_MESSAGE_LENGTH = 7000


def format_execution_plan(steps: List[Dict]) -> str:
    """Format an execution plan as a Markdown list with status emojis."""
    if not steps:
        return ""

    lines = ["**Execution Plan:**\n"]
    for i, step in enumerate(steps, 1):
        status = step.get("status", "pending")
        name = step.get("name", step.get("title", f"Step {i}"))

        emoji = {
            "pending": "⏳",
            "in_progress": "🔄",
            "running": "🔄",
            "completed": "✅",
            "failed": "❌",
            "skipped": "⏭️",
        }.get(status, "⏳")

        lines.append(f"{i}. {emoji} {name}")

    return "\n".join(lines)


def format_tool_notification(tool_name: str, status: str) -> str:
    """Format a tool notification message."""
    if status in ("running", "started"):
        return f"🔧 Calling **{tool_name}**..."
    elif status == "completed":
        return f"✅ **{tool_name}** completed"
    elif status == "failed":
        return f"❌ **{tool_name}** failed"
    return f"🔧 **{tool_name}** ({status})"


def format_progress_message(
    plan_text: Optional[str] = None,
    current_tool: Optional[str] = None,
    accumulated_text: Optional[str] = None,
) -> str:
    """Combine progress elements into a single update message."""
    parts = []

    if plan_text:
        parts.append(plan_text)
    if current_tool:
        parts.append(f"\n{current_tool}")
    if accumulated_text:
        preview = accumulated_text[:500]
        if len(accumulated_text) > 500:
            preview += "..."
        parts.append(f"\n---\n{preview}")

    if not parts:
        return "⏳ Working on it..."

    return "\n".join(parts)


def format_error_message(error: str) -> str:
    """Format an error message."""
    return f"❌ **Error**: {error}"


def split_long_message(text: str, max_length: int = WEBEX_MAX_MESSAGE_LENGTH) -> List[str]:
    """Split a long message into chunks that fit within Webex's message limit.

    Tries to split on paragraph boundaries, then sentence boundaries,
    then word boundaries.
    """
    if len(text) <= max_length:
        return [text]

    chunks = []
    remaining = text

    while len(remaining) > max_length:
        split_at = remaining.rfind("\n\n", 0, max_length)
        if split_at == -1 or split_at < max_length // 2:
            split_at = remaining.rfind("\n", 0, max_length)
        if split_at == -1 or split_at < max_length // 2:
            split_at = remaining.rfind(". ", 0, max_length)
            if split_at != -1:
                split_at += 1
        if split_at == -1 or split_at < max_length // 2:
            split_at = remaining.rfind(" ", 0, max_length)
        if split_at == -1 or split_at < max_length // 4:
            split_at = max_length

        chunks.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()

    if remaining:
        chunks.append(remaining)

    return chunks
