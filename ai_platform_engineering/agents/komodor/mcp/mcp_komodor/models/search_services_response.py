"""Model for Searchservicesresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Searchservicesresponse(BaseModel):
    """Searchservicesresponse model"""


class SearchservicesresponseResponse(APIResponse):
    """Response model for Searchservicesresponse"""

    data: Optional[Searchservicesresponse] = None


class SearchservicesresponseListResponse(APIResponse):
    """List response model for Searchservicesresponse"""

    data: List[Searchservicesresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
