"""Model for Keymetricwithmetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keymetricwithmetadata(BaseModel):
  """Base class for metrics with additional metadata"""


class KeymetricwithmetadataResponse(APIResponse):
  """Response model for Keymetricwithmetadata"""

  data: Optional[Keymetricwithmetadata] = None


class KeymetricwithmetadataListResponse(APIResponse):
  """List response model for Keymetricwithmetadata"""

  data: List[Keymetricwithmetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
