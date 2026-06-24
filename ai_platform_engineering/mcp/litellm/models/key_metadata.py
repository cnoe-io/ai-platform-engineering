"""Model for Keymetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Keymetadata(BaseModel):
  """Metadata for a key"""


class KeymetadataResponse(APIResponse):
  """Response model for Keymetadata"""

  data: Optional[Keymetadata] = None


class KeymetadataListResponse(APIResponse):
  """List response model for Keymetadata"""

  data: List[Keymetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
