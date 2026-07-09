"""Model for SchemasSelectortype"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasSelectortype(BaseModel):
  """SchemasSelectortype model"""


class SchemasSelectortypeResponse(APIResponse):
  """Response model for SchemasSelectortype"""

  data: Optional[SchemasSelectortype] = None


class SchemasSelectortypeListResponse(APIResponse):
  """List response model for SchemasSelectortype"""

  data: List[SchemasSelectortype] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
