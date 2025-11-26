"""Model for Runkubectlcommandmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Runkubectlcommandmetadata(BaseModel):
  """Runkubectlcommandmetadata model"""


class RunkubectlcommandmetadataResponse(APIResponse):
  """Response model for Runkubectlcommandmetadata"""

  data: Optional[Runkubectlcommandmetadata] = None


class RunkubectlcommandmetadataListResponse(APIResponse):
  """List response model for Runkubectlcommandmetadata"""

  data: List[Runkubectlcommandmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
