"""Model for Rolepolicy"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Rolepolicy(BaseModel):
    """Rolepolicy model"""


class RolepolicyResponse(APIResponse):
    """Response model for Rolepolicy"""

    data: Optional[Rolepolicy] = None


class RolepolicyListResponse(APIResponse):
    """List response model for Rolepolicy"""

    data: List[Rolepolicy] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
