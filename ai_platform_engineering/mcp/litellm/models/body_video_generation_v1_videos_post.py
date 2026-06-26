"""Model for BodyVideoGenerationV1VideosPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyVideoGenerationV1VideosPost(BaseModel):
  """BodyVideoGenerationV1VideosPost model"""


class BodyVideoGenerationV1VideosPostResponse(APIResponse):
  """Response model for BodyVideoGenerationV1VideosPost"""

  data: Optional[BodyVideoGenerationV1VideosPost] = None


class BodyVideoGenerationV1VideosPostListResponse(APIResponse):
  """List response model for BodyVideoGenerationV1VideosPost"""

  data: List[BodyVideoGenerationV1VideosPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
