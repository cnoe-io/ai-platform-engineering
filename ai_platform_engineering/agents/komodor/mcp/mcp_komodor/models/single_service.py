"""Model for Singleservice"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Singleservice(BaseModel):
    """Singleservice model"""


class SingleserviceResponse(APIResponse):
    """Response model for Singleservice"""

    data: Optional[Singleservice] = None


class SingleserviceListResponse(APIResponse):
    """List response model for Singleservice"""

    data: List[Singleservice] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
