"""Model for Createpolicydto"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createpolicydto(BaseModel):
    """Createpolicydto model"""


class CreatepolicydtoResponse(APIResponse):
    """Response model for Createpolicydto"""

    data: Optional[Createpolicydto] = None


class CreatepolicydtoListResponse(APIResponse):
    """List response model for Createpolicydto"""

    data: List[Createpolicydto] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
