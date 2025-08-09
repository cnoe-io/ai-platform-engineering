"""Model for Klaudiarcaresultsresponse"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Klaudiarcaresultsresponse(BaseModel):
    """Klaudiarcaresultsresponse model"""


class KlaudiarcaresultsresponseResponse(APIResponse):
    """Response model for Klaudiarcaresultsresponse"""

    data: Optional[Klaudiarcaresultsresponse] = None


class KlaudiarcaresultsresponseListResponse(APIResponse):
    """List response model for Klaudiarcaresultsresponse"""

    data: List[Klaudiarcaresultsresponse] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
