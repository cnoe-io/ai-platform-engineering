"""Model for Searcheventsdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searcheventsdata(BaseModel):
    """Searcheventsdata model"""


class SearcheventsdataResponse(APIResponse):
    """Response model for Searcheventsdata"""

    data: Optional[Searcheventsdata] = None


class SearcheventsdataListResponse(APIResponse):
    """List response model for Searcheventsdata"""

    data: List[Searcheventsdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
