"""Model for Chatcompletionfileobjectfile"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionfileobjectfile(BaseModel):
  """Chatcompletionfileobjectfile model"""


class ChatcompletionfileobjectfileResponse(APIResponse):
  """Response model for Chatcompletionfileobjectfile"""

  data: Optional[Chatcompletionfileobjectfile] = None


class ChatcompletionfileobjectfileListResponse(APIResponse):
  """List response model for Chatcompletionfileobjectfile"""

  data: List[Chatcompletionfileobjectfile] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
