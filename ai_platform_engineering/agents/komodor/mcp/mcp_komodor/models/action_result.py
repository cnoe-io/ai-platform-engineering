"""Model for Actionresult"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Actionresult(BaseModel):
    """Actionresult model"""


class ActionresultResponse(APIResponse):
    """Response model for Actionresult"""

    data: Optional[Actionresult] = None


class ActionresultListResponse(APIResponse):
    """List response model for Actionresult"""

    data: List[Actionresult] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
