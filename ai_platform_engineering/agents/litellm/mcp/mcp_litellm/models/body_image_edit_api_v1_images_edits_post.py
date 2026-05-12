"""Model for BodyImageEditApiV1ImagesEditsPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyImageEditApiV1ImagesEditsPost(BaseModel):
  """BodyImageEditApiV1ImagesEditsPost model"""


class BodyImageEditApiV1ImagesEditsPostResponse(APIResponse):
  """Response model for BodyImageEditApiV1ImagesEditsPost"""

  data: Optional[BodyImageEditApiV1ImagesEditsPost] = None


class BodyImageEditApiV1ImagesEditsPostListResponse(APIResponse):
  """List response model for BodyImageEditApiV1ImagesEditsPost"""

  data: List[BodyImageEditApiV1ImagesEditsPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
