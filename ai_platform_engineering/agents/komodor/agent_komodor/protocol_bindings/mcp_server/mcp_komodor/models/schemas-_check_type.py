"""Model for SchemasChecktype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasChecktype(BaseModel):
    """SchemasChecktype model"""


class SchemasChecktypeResponse(APIResponse):
    """Response model for SchemasChecktype"""

    data: Optional[SchemasChecktype] = None


class SchemasChecktypeListResponse(APIResponse):
    """List response model for SchemasChecktype"""

    data: List[SchemasChecktype] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
