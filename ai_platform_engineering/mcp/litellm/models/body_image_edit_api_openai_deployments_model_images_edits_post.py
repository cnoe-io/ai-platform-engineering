"""Model for BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost(BaseModel):
  """BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost model"""


class BodyImageEditApiOpenaiDeploymentsModelImagesEditsPostResponse(APIResponse):
  """Response model for BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost"""

  data: Optional[BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost] = None


class BodyImageEditApiOpenaiDeploymentsModelImagesEditsPostListResponse(APIResponse):
  """List response model for BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost"""

  data: List[BodyImageEditApiOpenaiDeploymentsModelImagesEditsPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
