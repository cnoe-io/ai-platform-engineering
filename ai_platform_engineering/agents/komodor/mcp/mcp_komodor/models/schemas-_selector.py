"""Model for SchemasSelector"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasSelector(BaseModel):
    """SchemasSelector model"""


class SchemasSelectorResponse(APIResponse):
    """Response model for SchemasSelector"""

    data: Optional[SchemasSelector] = None


class SchemasSelectorListResponse(APIResponse):
    """List response model for SchemasSelector"""

    data: List[SchemasSelector] = Field(default_factory=list)
    pagination: Optional[PaginationInfo] = None
