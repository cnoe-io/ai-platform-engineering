"""Model for Updatemonitordto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatemonitordto(BaseModel):
    """Updatemonitordto model"""


class UpdatemonitordtoResponse(APIResponse):
    """Response model for Updatemonitordto"""

    data: Optional[Updatemonitordto] = None


class UpdatemonitordtoListResponse(APIResponse):
    """List response model for Updatemonitordto"""

    data: List[Updatemonitordto] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
