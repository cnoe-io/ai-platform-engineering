"""Model for Actionstate"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Actionstate(BaseModel):
    """Actionstate model"""


class ActionstateResponse(APIResponse):
    """Response model for Actionstate"""

    data: Optional[Actionstate] = None


class ActionstateListResponse(APIResponse):
    """List response model for Actionstate"""

    data: List[Actionstate] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
