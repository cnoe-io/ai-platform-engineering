"""
Jira search result models.

This module provides Pydantic models for Jira search (JQL) results.
"""

import logging
from typing import Any, Optional

from pydantic import Field, model_validator

from ..base import BaseModel
from .issue import JiraIssue

logger = logging.getLogger(__name__)


class JiraSearchResult(BaseModel):
    """
    Model representing a Jira search (JQL) result.
    """

    total: int = 0
    start_at: int = 0
    max_results: int = 0
    issues: list[JiraIssue] = Field(default_factory=list)
    is_last: bool = True
    next_page_token: Optional[str] = None

    @classmethod
    def from_api_response(
        cls, data: dict[str, Any], **kwargs: Any
    ) -> "JiraSearchResult":
        """
        Create a JiraSearchResult from a Jira API response.

        Args:
            data: The search result data from the Jira API
            **kwargs: Additional arguments to pass to the constructor

        Returns:
            A JiraSearchResult instance
        """
        if not data:
            return cls()

        if not isinstance(data, dict):
            logger.debug("Received non-dictionary data, returning default instance")
            return cls()

        issues = []
        issues_data = data.get("issues", [])
        if isinstance(issues_data, list):
            for issue_data in issues_data:
                if issue_data:
                    requested_fields = kwargs.get("requested_fields")
                    issues.append(
                        JiraIssue.from_api_response(
                            issue_data, requested_fields=requested_fields
                        )
                    )

        raw_total = data.get("total")
        raw_start_at = data.get("startAt")
        raw_max_results = data.get("maxResults")
        raw_is_last = data.get("isLast")
        raw_next_page_token = data.get("nextPageToken")

        try:
            total = int(raw_total) if raw_total is not None else -1
        except (ValueError, TypeError):
            total = -1

        try:
            start_at = int(raw_start_at) if raw_start_at is not None else -1
        except (ValueError, TypeError):
            start_at = -1

        try:
            max_results = int(raw_max_results) if raw_max_results is not None else -1
        except (ValueError, TypeError):
            max_results = -1

        is_last = bool(raw_is_last) if raw_is_last is not None else True
        next_page_token = str(raw_next_page_token) if raw_next_page_token is not None else None

        return cls(
            total=total,
            start_at=start_at,
            max_results=max_results,
            issues=issues,
            is_last=is_last,
            next_page_token=next_page_token,
        )

    @model_validator(mode="after")
    def validate_search_result(self) -> "JiraSearchResult":
        """
        Validate the search result.

        This validator ensures that pagination values are sensible and
        consistent with the number of issues returned.

        Returns:
            The validated JiraSearchResult instance
        """
        return self

    def to_simplified_dict(self) -> dict[str, Any]:
        """Convert to simplified dictionary with pagination hints for LLM context."""
        result = {
            "total": self.total,
            "returned": len(self.issues),
            "start_at": self.start_at,
            "is_last": self.is_last,
            "issues": [issue.to_simplified_dict() for issue in self.issues],
        }

        # Add pagination hint if there are more results
        if self.total > 0 and not self.is_last:
            remaining = self.total - (self.start_at + len(self.issues))
            result["pagination_hint"] = (
                f"Showing {len(self.issues)} of {self.total} results. "
                f"{remaining} more available. Use start_at={self.start_at + len(self.issues)} to get next page."
            )

        return result
