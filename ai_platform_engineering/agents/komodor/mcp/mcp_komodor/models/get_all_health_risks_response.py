"""Model for Getallhealthrisksresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getallhealthrisksresponse(BaseModel):
    """Getallhealthrisksresponse model"""


class GetallhealthrisksresponseResponse(APIResponse):
    """Response model for Getallhealthrisksresponse"""

    data: Optional[Getallhealthrisksresponse] = None


class GetallhealthrisksresponseListResponse(APIResponse):
    """List response model for Getallhealthrisksresponse"""

    data: List[Getallhealthrisksresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
