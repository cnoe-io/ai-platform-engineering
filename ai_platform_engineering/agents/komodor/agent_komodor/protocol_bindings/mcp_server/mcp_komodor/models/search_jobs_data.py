"""Model for Searchjobsdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchjobsdata(BaseModel):
    """Searchjobsdata model"""


class SearchjobsdataResponse(APIResponse):
    """Response model for Searchjobsdata"""

    data: Optional[Searchjobsdata] = None


class SearchjobsdataListResponse(APIResponse):
    """List response model for Searchjobsdata"""

    data: List[Searchjobsdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
