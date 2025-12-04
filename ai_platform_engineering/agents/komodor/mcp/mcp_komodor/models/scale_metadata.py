"""Model for Scalemetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scalemetadata(BaseModel):
  """Scalemetadata model"""


class ScalemetadataResponse(APIResponse):
  """Response model for Scalemetadata"""

  data: Optional[Scalemetadata] = None


class ScalemetadataListResponse(APIResponse):
  """List response model for Scalemetadata"""

  data: List[Scalemetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
