"""Model for Servicekind"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Servicekind(BaseModel):
    """The kind of the service"""


class ServicekindResponse(APIResponse):
    """Response model for Servicekind"""

    data: Optional[Servicekind] = None


class ServicekindListResponse(APIResponse):
    """List response model for Servicekind"""

    data: List[Servicekind] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
