"""Model for Monitorconfiguration"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Monitorconfiguration(BaseModel):
    """Monitorconfiguration model"""


class MonitorconfigurationResponse(APIResponse):
    """Response model for Monitorconfiguration"""

    data: Optional[Monitorconfiguration] = None


class MonitorconfigurationListResponse(APIResponse):
    """List response model for Monitorconfiguration"""

    data: List[Monitorconfiguration] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
