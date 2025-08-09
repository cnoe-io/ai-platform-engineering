"""Model for Fielderror"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Fielderror(BaseModel):
    """Fielderror model"""


class FielderrorResponse(APIResponse):
    """Response model for Fielderror"""

    data: Optional[Fielderror] = None


class FielderrorListResponse(APIResponse):
    """List response model for Fielderror"""

    data: List[Fielderror] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
