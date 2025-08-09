"""Model for Impactgrouptype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Impactgrouptype(BaseModel):
    """Impactgrouptype model"""


class ImpactgrouptypeResponse(APIResponse):
    """Response model for Impactgrouptype"""

    data: Optional[Impactgrouptype] = None


class ImpactgrouptypeListResponse(APIResponse):
    """List response model for Impactgrouptype"""

    data: List[Impactgrouptype] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
