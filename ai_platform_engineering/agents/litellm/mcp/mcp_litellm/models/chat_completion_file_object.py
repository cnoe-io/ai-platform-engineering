"""Model for Chatcompletionfileobject"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionfileobject(BaseModel):
  """Chatcompletionfileobject model"""


class ChatcompletionfileobjectResponse(APIResponse):
  """Response model for Chatcompletionfileobject"""

  data: Optional[Chatcompletionfileobject] = None


class ChatcompletionfileobjectListResponse(APIResponse):
  """List response model for Chatcompletionfileobject"""

  data: List[Chatcompletionfileobject] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
