"""Model for BodyCreateFileV1FilesPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyCreateFileV1FilesPost(BaseModel):
  """BodyCreateFileV1FilesPost model"""


class BodyCreateFileV1FilesPostResponse(APIResponse):
  """Response model for BodyCreateFileV1FilesPost"""

  data: Optional[BodyCreateFileV1FilesPost] = None


class BodyCreateFileV1FilesPostListResponse(APIResponse):
  """List response model for BodyCreateFileV1FilesPost"""

  data: List[BodyCreateFileV1FilesPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
