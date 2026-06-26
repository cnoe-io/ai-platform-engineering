"""Protocol definitions for Jira MCP"""

from typing import Protocol, Any

class AttachmentsOperationsProto(Protocol):
    """Protocol for attachment operations."""
    async def upload_attachment(self, issue_key: str, file_path: str) -> dict[str, Any]:
        ...

class IssueOperationsProto(Protocol):
    """Protocol for issue operations."""
    async def get_issue(self, issue_key: str) -> dict[str, Any]:
        ...

class ProjectOperationsProto(Protocol):
    """Protocol for project operations."""
    async def get_project(self, project_key: str) -> dict[str, Any]:
        ...
