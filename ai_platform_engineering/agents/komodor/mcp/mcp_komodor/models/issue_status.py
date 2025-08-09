"""Model for Issuestatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Issuestatus(BaseModel):
    """The status of the event. Open indicates the event is ongoing, closed indicates the event has been resolved or finished."""


class IssuestatusResponse(APIResponse):
    """Response model for Issuestatus"""

    data: Optional[Issuestatus] = None


class IssuestatusListResponse(APIResponse):
    """List response model for Issuestatus"""

    data: List[Issuestatus] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
