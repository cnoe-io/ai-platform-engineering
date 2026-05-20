"""Model for BodyVideoCreateCharacterV1VideosCharactersPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyVideoCreateCharacterV1VideosCharactersPost(BaseModel):
  """BodyVideoCreateCharacterV1VideosCharactersPost model"""


class BodyVideoCreateCharacterV1VideosCharactersPostResponse(APIResponse):
  """Response model for BodyVideoCreateCharacterV1VideosCharactersPost"""

  data: Optional[BodyVideoCreateCharacterV1VideosCharactersPost] = None


class BodyVideoCreateCharacterV1VideosCharactersPostListResponse(APIResponse):
  """List response model for BodyVideoCreateCharacterV1VideosCharactersPost"""

  data: List[BodyVideoCreateCharacterV1VideosCharactersPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
