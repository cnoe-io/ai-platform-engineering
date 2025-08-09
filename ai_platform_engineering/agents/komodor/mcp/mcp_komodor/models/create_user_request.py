"""Model for Createuserrequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Createuserrequest(BaseModel):
    """Createuserrequest model"""


class CreateuserrequestResponse(APIResponse):
    """Response model for Createuserrequest"""

    data: Optional[Createuserrequest] = None


class CreateuserrequestListResponse(APIResponse):
    """List response model for Createuserrequest"""

    data: List[Createuserrequest] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
