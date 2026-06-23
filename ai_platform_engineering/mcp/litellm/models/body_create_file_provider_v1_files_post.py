"""Model for BodyCreateFileProviderV1FilesPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyCreateFileProviderV1FilesPost(BaseModel):
  """BodyCreateFileProviderV1FilesPost model"""


class BodyCreateFileProviderV1FilesPostResponse(APIResponse):
  """Response model for BodyCreateFileProviderV1FilesPost"""

  data: Optional[BodyCreateFileProviderV1FilesPost] = None


class BodyCreateFileProviderV1FilesPostListResponse(APIResponse):
  """List response model for BodyCreateFileProviderV1FilesPost"""

  data: List[BodyCreateFileProviderV1FilesPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
