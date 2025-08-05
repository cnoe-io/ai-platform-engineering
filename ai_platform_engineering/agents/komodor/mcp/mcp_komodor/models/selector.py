"""Model for Selector"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Selector(BaseModel):
    """Selector model"""


class SelectorResponse(APIResponse):
    """Response model for Selector"""

    data: Optional[Selector] = None


class SelectorListResponse(APIResponse):
    """List response model for Selector"""

    data: List[Selector] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
