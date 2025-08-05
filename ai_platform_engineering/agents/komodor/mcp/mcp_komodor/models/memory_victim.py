"""Model for Memoryvictim"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Memoryvictim(BaseModel):
    """Memoryvictim model"""


class MemoryvictimResponse(APIResponse):
    """Response model for Memoryvictim"""

    data: Optional[Memoryvictim] = None


class MemoryvictimListResponse(APIResponse):
    """List response model for Memoryvictim"""

    data: List[Memoryvictim] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
