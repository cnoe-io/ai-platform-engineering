"""Model for Effectivepermission"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Effectivepermission(BaseModel):
    """Effectivepermission model"""


class EffectivepermissionResponse(APIResponse):
    """Response model for Effectivepermission"""

    data: Optional[Effectivepermission] = None


class EffectivepermissionListResponse(APIResponse):
    """List response model for Effectivepermission"""

    data: List[Effectivepermission] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
