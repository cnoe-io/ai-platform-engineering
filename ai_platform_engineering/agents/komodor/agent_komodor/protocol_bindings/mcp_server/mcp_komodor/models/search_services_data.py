"""Model for Searchservicesdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchservicesdata(BaseModel):
    """Searchservicesdata model"""


class SearchservicesdataResponse(APIResponse):
    """Response model for Searchservicesdata"""

    data: Optional[Searchservicesdata] = None


class SearchservicesdataListResponse(APIResponse):
    """List response model for Searchservicesdata"""

    data: List[Searchservicesdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
