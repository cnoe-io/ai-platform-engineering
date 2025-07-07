"""Model for Paginationparams"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Paginationparams(BaseModel):
    """Paginationparams model"""


class PaginationparamsResponse(APIResponse):
    """Response model for Paginationparams"""

    data: Optional[Paginationparams] = None


class PaginationparamsListResponse(APIResponse):
    """List response model for Paginationparams"""

    data: List[Paginationparams] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
