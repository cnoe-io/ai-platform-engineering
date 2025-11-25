"""Model for Helmreleaseinfo"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Helmreleaseinfo(BaseModel):
  """Helmreleaseinfo model"""


class HelmreleaseinfoResponse(APIResponse):
  """Response model for Helmreleaseinfo"""

  data: Optional[Helmreleaseinfo] = None


class HelmreleaseinfoListResponse(APIResponse):
  """List response model for Helmreleaseinfo"""

  data: List[Helmreleaseinfo] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
