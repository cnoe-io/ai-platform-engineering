"""Model for Eventsissuetype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Eventsissuetype(BaseModel):
    """The type of the event"""


class EventsissuetypeResponse(APIResponse):
    """Response model for Eventsissuetype"""

    data: Optional[Eventsissuetype] = None


class EventsissuetypeListResponse(APIResponse):
    """List response model for Eventsissuetype"""

    data: List[Eventsissuetype] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
