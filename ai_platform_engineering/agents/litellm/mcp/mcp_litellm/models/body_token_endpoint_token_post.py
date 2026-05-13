"""Model for BodyTokenEndpointTokenPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyTokenEndpointTokenPost(BaseModel):
  """BodyTokenEndpointTokenPost model"""


class BodyTokenEndpointTokenPostResponse(APIResponse):
  """Response model for BodyTokenEndpointTokenPost"""

  data: Optional[BodyTokenEndpointTokenPost] = None


class BodyTokenEndpointTokenPostListResponse(APIResponse):
  """List response model for BodyTokenEndpointTokenPost"""

  data: List[BodyTokenEndpointTokenPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
