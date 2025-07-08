"""Model for Createclusterdto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createclusterdto(BaseModel):
    """Createclusterdto model"""


class CreateclusterdtoResponse(APIResponse):
    """Response model for Createclusterdto"""

    data: Optional[Createclusterdto] = None


class CreateclusterdtoListResponse(APIResponse):
    """List response model for Createclusterdto"""

    data: List[Createclusterdto] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
