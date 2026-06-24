"""Model for Chatcompletionimageobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionimageobject(BaseModel):
  """Chatcompletionimageobject model"""


class ChatcompletionimageobjectResponse(APIResponse):
  """Response model for Chatcompletionimageobject"""

  data: Optional[Chatcompletionimageobject] = None


class ChatcompletionimageobjectListResponse(APIResponse):
  """List response model for Chatcompletionimageobject"""

  data: List[Chatcompletionimageobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
