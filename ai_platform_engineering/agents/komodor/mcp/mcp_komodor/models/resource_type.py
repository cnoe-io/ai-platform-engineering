"""Model for Resourcetype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Resourcetype(BaseModel):
    """Resourcetype model"""


class ResourcetypeResponse(APIResponse):
    """Response model for Resourcetype"""

    data: Optional[Resourcetype] = None


class ResourcetypeListResponse(APIResponse):
    """List response model for Resourcetype"""

    data: List[Resourcetype] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
