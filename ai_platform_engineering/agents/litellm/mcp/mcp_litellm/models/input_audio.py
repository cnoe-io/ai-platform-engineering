"""Model for Inputaudio"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Inputaudio(BaseModel):
  """Inputaudio model"""


class InputaudioResponse(APIResponse):
  """Response model for Inputaudio"""

  data: Optional[Inputaudio] = None


class InputaudioListResponse(APIResponse):
  """List response model for Inputaudio"""

  data: List[Inputaudio] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
