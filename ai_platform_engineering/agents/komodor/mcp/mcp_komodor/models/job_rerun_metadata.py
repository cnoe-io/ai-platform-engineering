"""Model for Jobrerunmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Jobrerunmetadata(BaseModel):
  """Jobrerunmetadata model"""


class JobrerunmetadataResponse(APIResponse):
  """Response model for Jobrerunmetadata"""

  data: Optional[Jobrerunmetadata] = None


class JobrerunmetadataListResponse(APIResponse):
  """List response model for Jobrerunmetadata"""

  data: List[Jobrerunmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
