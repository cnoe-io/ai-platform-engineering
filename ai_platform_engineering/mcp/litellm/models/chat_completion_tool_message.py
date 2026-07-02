"""Model for Chatcompletiontoolmessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletiontoolmessage(BaseModel):
  """Chatcompletiontoolmessage model"""


class ChatcompletiontoolmessageResponse(APIResponse):
  """Response model for Chatcompletiontoolmessage"""

  data: Optional[Chatcompletiontoolmessage] = None


class ChatcompletiontoolmessageListResponse(APIResponse):
  """List response model for Chatcompletiontoolmessage"""

  data: List[Chatcompletiontoolmessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
