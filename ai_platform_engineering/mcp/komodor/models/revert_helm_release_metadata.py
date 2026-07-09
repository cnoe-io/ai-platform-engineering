"""Model for Reverthelmreleasemetadata"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Reverthelmreleasemetadata(BaseModel):
  """Reverthelmreleasemetadata model"""


class ReverthelmreleasemetadataResponse(APIResponse):
  """Response model for Reverthelmreleasemetadata"""

  data: Optional[Reverthelmreleasemetadata] = None


class ReverthelmreleasemetadataListResponse(APIResponse):
  """List response model for Reverthelmreleasemetadata"""

  data: List[Reverthelmreleasemetadata] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
