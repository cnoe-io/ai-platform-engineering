"""Model for BodyCreateFileFilesPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyCreateFileFilesPost(BaseModel):
  """BodyCreateFileFilesPost model"""


class BodyCreateFileFilesPostResponse(APIResponse):
  """Response model for BodyCreateFileFilesPost"""

  data: Optional[BodyCreateFileFilesPost] = None


class BodyCreateFileFilesPostListResponse(APIResponse):
  """List response model for BodyCreateFileFilesPost"""

  data: List[BodyCreateFileFilesPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
