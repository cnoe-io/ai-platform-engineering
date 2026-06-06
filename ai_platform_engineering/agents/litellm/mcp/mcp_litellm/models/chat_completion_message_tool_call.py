"""Model for Chatcompletionmessagetoolcall"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionmessagetoolcall(BaseModel):
  """Chatcompletionmessagetoolcall model"""


class ChatcompletionmessagetoolcallResponse(APIResponse):
  """Response model for Chatcompletionmessagetoolcall"""

  data: Optional[Chatcompletionmessagetoolcall] = None


class ChatcompletionmessagetoolcallListResponse(APIResponse):
  """List response model for Chatcompletionmessagetoolcall"""

  data: List[Chatcompletionmessagetoolcall] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
