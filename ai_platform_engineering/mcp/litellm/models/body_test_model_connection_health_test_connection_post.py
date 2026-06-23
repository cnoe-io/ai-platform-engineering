"""Model for BodyTestModelConnectionHealthTestConnectionPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyTestModelConnectionHealthTestConnectionPost(BaseModel):
  """BodyTestModelConnectionHealthTestConnectionPost model"""


class BodyTestModelConnectionHealthTestConnectionPostResponse(APIResponse):
  """Response model for BodyTestModelConnectionHealthTestConnectionPost"""

  data: Optional[BodyTestModelConnectionHealthTestConnectionPost] = None


class BodyTestModelConnectionHealthTestConnectionPostListResponse(APIResponse):
  """List response model for BodyTestModelConnectionHealthTestConnectionPost"""

  data: List[BodyTestModelConnectionHealthTestConnectionPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
