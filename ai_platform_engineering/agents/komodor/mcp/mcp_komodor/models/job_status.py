"""Model for Jobstatus"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Jobstatus(BaseModel):
    """The status of the job"""


class JobstatusResponse(APIResponse):
    """Response model for Jobstatus"""

    data: Optional[Jobstatus] = None


class JobstatusListResponse(APIResponse):
    """List response model for Jobstatus"""

    data: List[Jobstatus] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
