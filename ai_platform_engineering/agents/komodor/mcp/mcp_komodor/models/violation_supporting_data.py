"""Model for Violationsupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Violationsupportingdata(BaseModel):
    """Violationsupportingdata model"""


class ViolationsupportingdataResponse(APIResponse):
    """Response model for Violationsupportingdata"""

    data: Optional[Violationsupportingdata] = None


class ViolationsupportingdataListResponse(APIResponse):
    """List response model for Violationsupportingdata"""

    data: List[Violationsupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
