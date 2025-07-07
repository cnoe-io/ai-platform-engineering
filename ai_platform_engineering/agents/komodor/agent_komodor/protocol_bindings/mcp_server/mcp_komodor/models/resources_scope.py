"""Model for Resourcesscope"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Resourcesscope(BaseModel):
    """Resourcesscope model"""


class ResourcesscopeResponse(APIResponse):
    """Response model for Resourcesscope"""

    data: Optional[Resourcesscope] = None


class ResourcesscopeListResponse(APIResponse):
    """List response model for Resourcesscope"""

    data: List[Resourcesscope] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
