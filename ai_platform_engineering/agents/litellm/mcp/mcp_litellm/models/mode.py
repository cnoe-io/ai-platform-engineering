"""Model for Mode"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Mode(BaseModel):
  """Mode model"""


class ModeResponse(APIResponse):
  """Response model for Mode"""

  data: Optional[Mode] = None


class ModeListResponse(APIResponse):
  """List response model for Mode"""

  data: List[Mode] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
