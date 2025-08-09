"""Model for Getupdateviolationresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Getupdateviolationresponse(BaseModel):
    """Getupdateviolationresponse model"""


class GetupdateviolationresponseResponse(APIResponse):
    """Response model for Getupdateviolationresponse"""

    data: Optional[Getupdateviolationresponse] = None


class GetupdateviolationresponseListResponse(APIResponse):
    """List response model for Getupdateviolationresponse"""

    data: List[Getupdateviolationresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
