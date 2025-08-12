"""Model for Customeventresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Customeventresponse(BaseModel):
    """Customeventresponse model"""


class CustomeventresponseResponse(APIResponse):
    """Response model for Customeventresponse"""

    data: Optional[Customeventresponse] = None


class CustomeventresponseListResponse(APIResponse):
    """List response model for Customeventresponse"""

    data: List[Customeventresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
