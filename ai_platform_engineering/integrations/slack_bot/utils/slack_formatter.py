# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Block Kit Formatting Utilities
Formats A2A responses and plans into rich Slack messages
"""

from typing import List, Dict, Any, Optional


# Maps A2A plan step statuses to Slack task_update statuses
STATUS_MAP_A2A_TO_SLACK = {
    "pending": "pending",
    "in_progress": "in_progress",
    "completed": "complete",
    "failed": "error",
}


def _format_step_title(step: Dict[str, Any]) -> str:
    """Format step title with agent name prefix like the UI does."""
    title = step.get("title", "")
    agent = step.get("agent", "")
    if agent and agent != "Supervisor":
        return f"[{agent}] {title}"
    return title


def build_task_update_chunks(
    steps: List[Dict[str, Any]],
    step_details: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Convert A2A plan steps to Slack task_update chunk format.

    Args:
        steps: List of plan step dicts with step_id, title, status, order.
        step_details: Optional map of step_id -> details text to include.
    """
    chunks = []
    for step in sorted(steps, key=lambda s: s.get("order", 0)):
        chunk = {
            "type": "task_update",
            "id": step["step_id"],
            "title": _format_step_title(step),
            "status": STATUS_MAP_A2A_TO_SLACK.get(step.get("status", "pending"), "pending"),
        }
        if step_details:
            details = step_details.get(step["step_id"])
            if details:
                chunk["details"] = details
        chunks.append(chunk)
    return chunks


def build_single_task_update(
    step_id: str,
    title: str,
    status: str,
    details: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a single task_update chunk for appendStream."""
    chunk = {
        "type": "task_update",
        "id": step_id,
        "title": title,
        "status": STATUS_MAP_A2A_TO_SLACK.get(status, "pending"),
    }
    if details:
        chunk["details"] = details
    return chunk


def split_text_into_blocks(text: str, max_length: int = 3000) -> List[str]:
    """Split text into chunks that fit within Slack's block text limit."""
    if len(text) <= max_length:
        return [text]

    chunks = []
    current_chunk = ""

    paragraphs = text.split("\n\n")

    for paragraph in paragraphs:
        if len(paragraph) > max_length:
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""

            lines = paragraph.split("\n")
            for line in lines:
                if len(line) > max_length:
                    if current_chunk:
                        chunks.append(current_chunk.strip())
                    chunks.append(line[: max_length - 50] + "\n\n_[Line truncated due to length]_")
                    current_chunk = ""
                elif len(current_chunk) + len(line) + 1 > max_length:
                    chunks.append(current_chunk.strip())
                    current_chunk = line
                else:
                    current_chunk += ("\n" + line) if current_chunk else line

        elif len(current_chunk) + len(paragraph) + 2 > max_length:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = paragraph
        else:
            current_chunk += ("\n\n" + paragraph) if current_chunk else paragraph

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


def format_message_part(part: Dict[str, Any]) -> str:
    """Format a single message part (text, file, or data)."""
    kind = part.get("kind", "text")

    if kind == "text":
        return part.get("text", "")
    elif kind == "file":
        file_info = part.get("file", {})
        name = file_info.get("name", "file")
        uri = file_info.get("uri", "")
        if uri:
            return f"<{uri}|{name}>"
        return f"{name}"
    elif kind == "data":
        return f"```{part.get('data', {})}```"

    return ""


def format_error_message(error_message: str) -> List[Dict[str, Any]]:
    """Format an error message as Slack blocks."""
    full_error_text = f"*Error*\n{error_message}"

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": full_error_text,
            },
        }
    ]

    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "_You can try asking again or rephrase your question._",
                }
            ],
        }
    )

    return blocks


