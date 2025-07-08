"""Model for Klaudiarcarequest"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Klaudiarcarequest(BaseModel):
    """Klaudiarcarequest model"""


class KlaudiarcarequestResponse(APIResponse):
    """Response model for Klaudiarcarequest"""

    data: Optional[Klaudiarcarequest] = None


class KlaudiarcarequestListResponse(APIResponse):
    """List response model for Klaudiarcarequest"""

    data: List[Klaudiarcarequest] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
