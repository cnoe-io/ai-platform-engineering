"""Model for Issuesprops"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Issuesprops(BaseModel):
    """Issuesprops model"""


class IssuespropsResponse(APIResponse):
    """Response model for Issuesprops"""

    data: Optional[Issuesprops] = None


class IssuespropsListResponse(APIResponse):
    """List response model for Issuesprops"""

    data: List[Issuesprops] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
