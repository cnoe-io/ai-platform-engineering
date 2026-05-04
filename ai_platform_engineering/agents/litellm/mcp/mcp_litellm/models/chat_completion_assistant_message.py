"""Model for Chatcompletionassistantmessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionassistantmessage(BaseModel):
  """Chatcompletionassistantmessage model"""


class ChatcompletionassistantmessageResponse(APIResponse):
  """Response model for Chatcompletionassistantmessage"""

  data: Optional[Chatcompletionassistantmessage] = None


class ChatcompletionassistantmessageListResponse(APIResponse):
  """List response model for Chatcompletionassistantmessage"""

  data: List[Chatcompletionassistantmessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
