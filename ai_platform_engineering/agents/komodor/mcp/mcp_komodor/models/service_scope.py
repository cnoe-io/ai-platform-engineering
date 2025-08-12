"""Model for Servicescope"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Servicescope(BaseModel):
    """Servicescope model"""


class ServicescopeResponse(APIResponse):
    """Response model for Servicescope"""

    data: Optional[Servicescope] = None


class ServicescopeListResponse(APIResponse):
    """List response model for Servicescope"""

    data: List[Servicescope] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
