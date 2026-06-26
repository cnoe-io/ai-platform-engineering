"""Model for Chatmessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatmessage(BaseModel):
  """Chatmessage model"""


class ChatmessageResponse(APIResponse):
  """Response model for Chatmessage"""

  data: Optional[Chatmessage] = None


class ChatmessageListResponse(APIResponse):
  """List response model for Chatmessage"""

  data: List[Chatmessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
