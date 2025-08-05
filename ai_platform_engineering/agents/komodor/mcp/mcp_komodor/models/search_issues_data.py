"""Model for Searchissuesdata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchissuesdata(BaseModel):
    """Searchissuesdata model"""


class SearchissuesdataResponse(APIResponse):
    """Response model for Searchissuesdata"""

    data: Optional[Searchissuesdata] = None


class SearchissuesdataListResponse(APIResponse):
    """List response model for Searchissuesdata"""

    data: List[Searchissuesdata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
