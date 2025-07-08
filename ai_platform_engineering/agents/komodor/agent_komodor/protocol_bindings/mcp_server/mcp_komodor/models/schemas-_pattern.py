"""Model for SchemasPattern"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasPattern(BaseModel):
    """SchemasPattern model"""


class SchemasPatternResponse(APIResponse):
    """Response model for SchemasPattern"""

    data: Optional[SchemasPattern] = None


class SchemasPatternListResponse(APIResponse):
    """List response model for SchemasPattern"""

    data: List[SchemasPattern] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
