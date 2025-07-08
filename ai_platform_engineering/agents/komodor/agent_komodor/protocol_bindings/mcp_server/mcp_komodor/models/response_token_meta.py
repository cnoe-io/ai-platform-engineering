"""Model for Responsetokenmeta"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Responsetokenmeta(BaseModel):
    """Responsetokenmeta model"""


class ResponsetokenmetaResponse(APIResponse):
    """Response model for Responsetokenmeta"""

    data: Optional[Responsetokenmeta] = None


class ResponsetokenmetaListResponse(APIResponse):
    """List response model for Responsetokenmeta"""

    data: List[Responsetokenmeta] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
