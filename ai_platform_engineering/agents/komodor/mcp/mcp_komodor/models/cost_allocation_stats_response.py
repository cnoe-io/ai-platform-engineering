"""Model for Costallocationstatsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Costallocationstatsresponse(BaseModel):
    """Costallocationstatsresponse model"""


class CostallocationstatsresponseResponse(APIResponse):
    """Response model for Costallocationstatsresponse"""

    data: Optional[Costallocationstatsresponse] = None


class CostallocationstatsresponseListResponse(APIResponse):
    """List response model for Costallocationstatsresponse"""

    data: List[Costallocationstatsresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
