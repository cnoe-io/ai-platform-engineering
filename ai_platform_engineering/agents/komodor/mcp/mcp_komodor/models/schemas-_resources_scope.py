"""Model for SchemasResourcesscope"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class SchemasResourcesscope(BaseModel):
  """SchemasResourcesscope model"""


class SchemasResourcesscopeResponse(APIResponse):
  """Response model for SchemasResourcesscope"""

  data: Optional[SchemasResourcesscope] = None


class SchemasResourcesscopeListResponse(APIResponse):
  """List response model for SchemasResourcesscope"""

  data: List[SchemasResourcesscope] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
