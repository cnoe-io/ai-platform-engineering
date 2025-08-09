"""Model for Getmonitorsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getmonitorsresponse(BaseModel):
    """Getmonitorsresponse model"""


class GetmonitorsresponseResponse(APIResponse):
    """Response model for Getmonitorsresponse"""

    data: Optional[Getmonitorsresponse] = None


class GetmonitorsresponseListResponse(APIResponse):
    """List response model for Getmonitorsresponse"""

    data: List[Getmonitorsresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
