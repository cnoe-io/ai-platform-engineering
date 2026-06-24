"""Model for BodyImageEditApiImagesEditsPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyImageEditApiImagesEditsPost(BaseModel):
  """BodyImageEditApiImagesEditsPost model"""


class BodyImageEditApiImagesEditsPostResponse(APIResponse):
  """Response model for BodyImageEditApiImagesEditsPost"""

  data: Optional[BodyImageEditApiImagesEditsPost] = None


class BodyImageEditApiImagesEditsPostListResponse(APIResponse):
  """List response model for BodyImageEditApiImagesEditsPost"""

  data: List[BodyImageEditApiImagesEditsPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
