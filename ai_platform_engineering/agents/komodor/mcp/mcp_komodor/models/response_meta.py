"""Model for Responsemeta"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Responsemeta(BaseModel):
    """Responsemeta model"""


class ResponsemetaResponse(APIResponse):
    """Response model for Responsemeta"""

    data: Optional[Responsemeta] = None


class ResponsemetaListResponse(APIResponse):
    """List response model for Responsemeta"""

    data: List[Responsemeta] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
