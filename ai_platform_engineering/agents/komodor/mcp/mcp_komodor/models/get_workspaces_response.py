"""Model for Getworkspacesresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getworkspacesresponse(BaseModel):
    """Getworkspacesresponse model"""


class GetworkspacesresponseResponse(APIResponse):
    """Response model for Getworkspacesresponse"""

    data: Optional[Getworkspacesresponse] = None


class GetworkspacesresponseListResponse(APIResponse):
    """List response model for Getworkspacesresponse"""

    data: List[Getworkspacesresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
