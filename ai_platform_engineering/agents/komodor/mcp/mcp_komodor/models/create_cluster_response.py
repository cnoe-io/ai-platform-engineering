"""Model for Createclusterresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createclusterresponse(BaseModel):
    """Createclusterresponse model"""


class CreateclusterresponseResponse(APIResponse):
    """Response model for Createclusterresponse"""

    data: Optional[Createclusterresponse] = None


class CreateclusterresponseListResponse(APIResponse):
    """List response model for Createclusterresponse"""

    data: List[Createclusterresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
