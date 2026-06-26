"""Model for Chatcompletionusermessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionusermessage(BaseModel):
  """Chatcompletionusermessage model"""


class ChatcompletionusermessageResponse(APIResponse):
  """Response model for Chatcompletionusermessage"""

  data: Optional[Chatcompletionusermessage] = None


class ChatcompletionusermessageListResponse(APIResponse):
  """List response model for Chatcompletionusermessage"""

  data: List[Chatcompletionusermessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
