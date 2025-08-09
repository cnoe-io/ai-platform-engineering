"""Model for Searchjobsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchjobsresponse(BaseModel):
    """Searchjobsresponse model"""


class SearchjobsresponseResponse(APIResponse):
    """Response model for Searchjobsresponse"""

    data: Optional[Searchjobsresponse] = None


class SearchjobsresponseListResponse(APIResponse):
    """List response model for Searchjobsresponse"""

    data: List[Searchjobsresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
