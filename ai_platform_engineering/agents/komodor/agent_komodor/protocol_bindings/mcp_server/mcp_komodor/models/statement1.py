"""Model for Statement1"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Statement1(BaseModel):
    """Statement1 model"""


class Statement1Response(APIResponse):
    """Response model for Statement1"""

    data: Optional[Statement1] = None


class Statement1ListResponse(APIResponse):
    """List response model for Statement1"""

    data: List[Statement1] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
