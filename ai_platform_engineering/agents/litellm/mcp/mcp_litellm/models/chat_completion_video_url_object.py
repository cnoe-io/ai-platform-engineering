"""Model for Chatcompletionvideourlobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionvideourlobject(BaseModel):
  """Chatcompletionvideourlobject model"""


class ChatcompletionvideourlobjectResponse(APIResponse):
  """Response model for Chatcompletionvideourlobject"""

  data: Optional[Chatcompletionvideourlobject] = None


class ChatcompletionvideourlobjectListResponse(APIResponse):
  """List response model for Chatcompletionvideourlobject"""

  data: List[Chatcompletionvideourlobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
