"""Model for Statementresource"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Statementresource(BaseModel):
    """Statementresource model"""


class StatementresourceResponse(APIResponse):
    """Response model for Statementresource"""

    data: Optional[Statementresource] = None


class StatementresourceListResponse(APIResponse):
    """List response model for Statementresource"""

    data: List[Statementresource] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
