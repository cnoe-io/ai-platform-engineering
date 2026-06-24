"""Model for Scalemetadatadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Scalemetadatadata(BaseModel):
  """Scalemetadatadata model"""


class ScalemetadatadataResponse(APIResponse):
  """Response model for Scalemetadatadata"""

  data: Optional[Scalemetadatadata] = None


class ScalemetadatadataListResponse(APIResponse):
  """List response model for Scalemetadatadata"""

  data: List[Scalemetadatadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
