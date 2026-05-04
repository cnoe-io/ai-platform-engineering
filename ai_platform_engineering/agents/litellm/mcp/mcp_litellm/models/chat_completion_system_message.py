"""Model for Chatcompletionsystemmessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionsystemmessage(BaseModel):
  """Chatcompletionsystemmessage model"""


class ChatcompletionsystemmessageResponse(APIResponse):
  """Response model for Chatcompletionsystemmessage"""

  data: Optional[Chatcompletionsystemmessage] = None


class ChatcompletionsystemmessageListResponse(APIResponse):
  """List response model for Chatcompletionsystemmessage"""

  data: List[Chatcompletionsystemmessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
