"""Model for Updatepolicyrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Updatepolicyrequest(BaseModel):
    """Updatepolicyrequest model"""


class UpdatepolicyrequestResponse(APIResponse):
    """Response model for Updatepolicyrequest"""

    data: Optional[Updatepolicyrequest] = None


class UpdatepolicyrequestListResponse(APIResponse):
    """List response model for Updatepolicyrequest"""

    data: List[Updatepolicyrequest] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
