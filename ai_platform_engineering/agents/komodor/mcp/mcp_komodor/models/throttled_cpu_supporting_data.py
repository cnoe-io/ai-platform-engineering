"""Model for Throttledcpusupportingdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Throttledcpusupportingdata(BaseModel):
    """Throttledcpusupportingdata model"""


class ThrottledcpusupportingdataResponse(APIResponse):
    """Response model for Throttledcpusupportingdata"""

    data: Optional[Throttledcpusupportingdata] = None


class ThrottledcpusupportingdataListResponse(APIResponse):
    """List response model for Throttledcpusupportingdata"""

    data: List[Throttledcpusupportingdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
