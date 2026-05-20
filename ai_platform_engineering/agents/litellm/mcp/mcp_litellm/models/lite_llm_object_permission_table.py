"""Model for LitellmObjectpermissiontable"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmObjectpermissiontable(BaseModel):
  """Represents a LiteLLM_ObjectPermissionTable record"""


class LitellmObjectpermissiontableResponse(APIResponse):
  """Response model for LitellmObjectpermissiontable"""

  data: Optional[LitellmObjectpermissiontable] = None


class LitellmObjectpermissiontableListResponse(APIResponse):
  """List response model for LitellmObjectpermissiontable"""

  data: List[LitellmObjectpermissiontable] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
