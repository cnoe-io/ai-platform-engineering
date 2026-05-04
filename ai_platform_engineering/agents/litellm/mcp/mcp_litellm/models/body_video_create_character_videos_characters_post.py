"""Model for BodyVideoCreateCharacterVideosCharactersPost"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class BodyVideoCreateCharacterVideosCharactersPost(BaseModel):
  """BodyVideoCreateCharacterVideosCharactersPost model"""


class BodyVideoCreateCharacterVideosCharactersPostResponse(APIResponse):
  """Response model for BodyVideoCreateCharacterVideosCharactersPost"""

  data: Optional[BodyVideoCreateCharacterVideosCharactersPost] = None


class BodyVideoCreateCharacterVideosCharactersPostListResponse(APIResponse):
  """List response model for BodyVideoCreateCharacterVideosCharactersPost"""

  data: List[BodyVideoCreateCharacterVideosCharactersPost] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
