"""Model for BodyVideoGenerationVideosPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyVideoGenerationVideosPost(BaseModel):
  """BodyVideoGenerationVideosPost model"""


class BodyVideoGenerationVideosPostResponse(APIResponse):
  """Response model for BodyVideoGenerationVideosPost"""

  data: Optional[BodyVideoGenerationVideosPost] = None


class BodyVideoGenerationVideosPostListResponse(APIResponse):
  """List response model for BodyVideoGenerationVideosPost"""

  data: List[BodyVideoGenerationVideosPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
