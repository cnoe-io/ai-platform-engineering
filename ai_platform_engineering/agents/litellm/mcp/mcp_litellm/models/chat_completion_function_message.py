"""Model for Chatcompletionfunctionmessage"""

from typing import List, Optional
from pydantic import BaseModel, Field
from .base import APIResponse, PaginationInfo


class Chatcompletionfunctionmessage(BaseModel):
  """Chatcompletionfunctionmessage model"""


class ChatcompletionfunctionmessageResponse(APIResponse):
  """Response model for Chatcompletionfunctionmessage"""

  data: Optional[Chatcompletionfunctionmessage] = None


class ChatcompletionfunctionmessageListResponse(APIResponse):
  """List response model for Chatcompletionfunctionmessage"""

  data: List[Chatcompletionfunctionmessage] = Field(default_factory=list)
  pagination: Optional[PaginationInfo] = None
