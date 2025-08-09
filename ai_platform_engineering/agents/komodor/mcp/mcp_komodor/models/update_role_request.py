"""Model for Updaterolerequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updaterolerequest(BaseModel):
    """Updaterolerequest model"""


class UpdaterolerequestResponse(APIResponse):
    """Response model for Updaterolerequest"""

    data: Optional[Updaterolerequest] = None


class UpdaterolerequestListResponse(APIResponse):
    """List response model for Updaterolerequest"""

    data: List[Updaterolerequest] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
