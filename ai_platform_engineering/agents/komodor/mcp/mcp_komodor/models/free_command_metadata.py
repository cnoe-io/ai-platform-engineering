"""Model for Freecommandmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Freecommandmetadata(BaseModel):
    """Freecommandmetadata model"""


class FreecommandmetadataResponse(APIResponse):
    """Response model for Freecommandmetadata"""

    data: Optional[Freecommandmetadata] = None


class FreecommandmetadataListResponse(APIResponse):
    """List response model for Freecommandmetadata"""

    data: List[Freecommandmetadata] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
