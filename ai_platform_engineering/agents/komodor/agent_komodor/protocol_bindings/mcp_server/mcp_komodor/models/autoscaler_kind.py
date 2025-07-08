"""Model for Autoscalerkind"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Autoscalerkind(BaseModel):
    """Autoscalerkind model"""


class AutoscalerkindResponse(APIResponse):
    """Response model for Autoscalerkind"""

    data: Optional[Autoscalerkind] = None


class AutoscalerkindListResponse(APIResponse):
    """List response model for Autoscalerkind"""

    data: List[Autoscalerkind] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
