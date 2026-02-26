# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Slack Block Kit Formatting Utilities
Formats A2A responses and plans into rich Slack messages
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field


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


def convert_markdown_to_slack(text: str) -> str:
    """Convert markdown formatting to Slack mrkdwn format."""
    from markdown_to_mrkdwn import SlackMarkdownConverter

    converter = SlackMarkdownConverter()
    return converter.convert(text)


def format_message_part(part: Dict[str, Any]) -> str:
    """Format a single message part (text, file, or data)."""
    kind = part.get("kind", "text")

    if kind == "text":
        text = part.get("text", "")
        return convert_markdown_to_slack(text)
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


def extract_todos_from_metadata(metadata: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Extract todo list from A2A metadata."""
    if not metadata:
        return []

    todos = metadata.get("todos", [])
    if not todos:
        todos = metadata.get("plan", [])
    if not todos:
        todos = metadata.get("steps", [])

    return todos if isinstance(todos, list) else []


@dataclass
class ExecutionStep:
    """Represents a step in the execution plan"""

    name: str
    status: str = "pending"
    description: Optional[str] = None


@dataclass
class ExecutionPlan:
    """Tracks execution plan state for streaming updates"""

    steps: List[ExecutionStep] = field(default_factory=list)

    def add_step(self, name: str, status: str = "pending", description: str = None) -> None:
        for step in self.steps:
            if step.name == name:
                step.status = status
                if description:
                    step.description = description
                return
        self.steps.append(ExecutionStep(name=name, status=status, description=description))

    def update_step(self, name: str, status: str) -> None:
        for step in self.steps:
            if step.name == name:
                step.status = status
                return
        self.add_step(name, status)

    def start_step(self, name: str) -> None:
        self.update_step(name, "running")

    def complete_step(self, name: str) -> None:
        self.update_step(name, "completed")

    def fail_step(self, name: str) -> None:
        self.update_step(name, "failed")

    def get_step(self, name: str) -> Optional[ExecutionStep]:
        for step in self.steps:
            if step.name == name:
                return step
        return None


def get_status_icon(status: str) -> str:
    """Get the status icon for an execution step"""
    icons = {
        "pending": "⬜",
        "running": "⏳",
        "completed": "✅",
        "failed": "❌",
    }
    return icons.get(status, "⬜")


def format_execution_plan(plan: ExecutionPlan) -> str:
    """Format an execution plan as text for display."""
    if not plan.steps:
        return ""

    lines = ["━━━━━━━━━━━━━━━━━━━━", "*Execution Plan*"]
    for step in plan.steps:
        icon = get_status_icon(step.status)
        lines.append(f"{icon} {step.name}")

    return "\n".join(lines)


def format_execution_plan_from_steps(steps: List[Dict[str, Any]]) -> str:
    """Format execution plan from a list of step dictionaries."""
    plan = ExecutionPlan()
    for step in steps:
        plan.add_step(
            name=step.get("name", step.get("content", "Unknown")),
            status=step.get("status", "pending"),
            description=step.get("description"),
        )
    return format_execution_plan(plan)
