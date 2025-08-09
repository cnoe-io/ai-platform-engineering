"""Model for Getviolationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getviolationresponse(BaseModel):
    """Getviolationresponse model"""


class GetviolationresponseResponse(APIResponse):
    """Response model for Getviolationresponse"""

    data: Optional[Getviolationresponse] = None


class GetviolationresponseListResponse(APIResponse):
    """List response model for Getviolationresponse"""

    data: List[Getviolationresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
