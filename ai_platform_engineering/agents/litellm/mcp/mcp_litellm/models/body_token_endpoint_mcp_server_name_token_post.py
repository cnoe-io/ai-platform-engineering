"""Model for BodyTokenEndpointMcpServerNameTokenPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyTokenEndpointMcpServerNameTokenPost(BaseModel):
  """BodyTokenEndpointMcpServerNameTokenPost model"""


class BodyTokenEndpointMcpServerNameTokenPostResponse(APIResponse):
  """Response model for BodyTokenEndpointMcpServerNameTokenPost"""

  data: Optional[BodyTokenEndpointMcpServerNameTokenPost] = None


class BodyTokenEndpointMcpServerNameTokenPostListResponse(APIResponse):
  """List response model for BodyTokenEndpointMcpServerNameTokenPost"""

  data: List[BodyTokenEndpointMcpServerNameTokenPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
