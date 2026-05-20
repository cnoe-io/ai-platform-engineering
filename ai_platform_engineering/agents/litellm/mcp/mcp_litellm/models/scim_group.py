"""Model for Scimgroup"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scimgroup(BaseModel):
  """Scimgroup model"""


class ScimgroupResponse(APIResponse):
  """Response model for Scimgroup"""

  data: Optional[Scimgroup] = None


class ScimgroupListResponse(APIResponse):
  """List response model for Scimgroup"""

  data: List[Scimgroup] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
