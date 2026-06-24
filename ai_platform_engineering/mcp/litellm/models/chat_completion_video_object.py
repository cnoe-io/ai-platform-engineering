"""Model for Chatcompletionvideoobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionvideoobject(BaseModel):
  """Chatcompletionvideoobject model"""


class ChatcompletionvideoobjectResponse(APIResponse):
  """Response model for Chatcompletionvideoobject"""

  data: Optional[Chatcompletionvideoobject] = None


class ChatcompletionvideoobjectListResponse(APIResponse):
  """List response model for Chatcompletionvideoobject"""

  data: List[Chatcompletionvideoobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
