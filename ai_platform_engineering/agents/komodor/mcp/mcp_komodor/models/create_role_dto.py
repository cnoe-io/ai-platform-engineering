"""Model for Createroledto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createroledto(BaseModel):
    """Createroledto model"""


class CreateroledtoResponse(APIResponse):
    """Response model for Createroledto"""

    data: Optional[Createroledto] = None


class CreateroledtoListResponse(APIResponse):
    """List response model for Createroledto"""

    data: List[Createroledto] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
