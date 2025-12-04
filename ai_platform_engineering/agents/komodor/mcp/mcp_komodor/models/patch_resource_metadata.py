"""Model for Patchresourcemetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Patchresourcemetadata(BaseModel):
  """Patchresourcemetadata model"""


class PatchresourcemetadataResponse(APIResponse):
  """Response model for Patchresourcemetadata"""

  data: Optional[Patchresourcemetadata] = None


class PatchresourcemetadataListResponse(APIResponse):
  """List response model for Patchresourcemetadata"""

  data: List[Patchresourcemetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
