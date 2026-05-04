"""Model for LitellmObjectpermissionbase"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class LitellmObjectpermissionbase(BaseModel):
  """LitellmObjectpermissionbase model"""


class LitellmObjectpermissionbaseResponse(APIResponse):
  """Response model for LitellmObjectpermissionbase"""

  data: Optional[LitellmObjectpermissionbase] = None


class LitellmObjectpermissionbaseListResponse(APIResponse):
  """List response model for LitellmObjectpermissionbase"""

  data: List[LitellmObjectpermissionbase] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
